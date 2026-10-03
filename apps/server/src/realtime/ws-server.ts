import { errorMessage, NET, type Logger } from '@huddle/shared';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { isOriginAllowed } from '../http/security.ts';
import { serveConnection } from './connection.ts';
import type { RoomManager } from './room-manager.ts';

export interface RealtimeOptions {
  path: string;
  allowedOrigins: string[];
  /** Concurrent sockets per client IP. */
  maxPerIp: number;
  /** Read the client IP from `X-Forwarded-For` (only behind a trusted proxy). */
  trustProxy: boolean;
  manager: RoomManager;
  log: Logger;
  now: () => number;
}

export interface Realtime {
  readonly wss: WebSocketServer;
  close(): void;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return (trustProxy && first) || req.socket.remoteAddress || 'unknown';
}

function reject(socket: Duplex, status: number): void {
  socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** WebSocket endpoint on the HTTP server (`/ws`), plus the room tick at the snapshot rate. */
export function attachRealtime(server: Server, o: RealtimeOptions): Realtime {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: NET.maxMessageBytes,
    perMessageDeflate: false,
  });
  const perIp = new Map<string, number>();
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', (err) => o.log.debug('upgrade socket error', errorMessage(err)));
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== o.path) {
      reject(socket, 404);
      return;
    }
    if (!isOriginAllowed(req, o.allowedOrigins)) {
      reject(socket, 403);
      return;
    }
    const ip = clientIp(req, o.trustProxy);
    if ((perIp.get(ip) ?? 0) >= o.maxPerIp) {
      reject(socket, 429);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      ws.once('close', () => {
        const left = (perIp.get(ip) ?? 1) - 1;
        if (left > 0) perIp.set(ip, left);
        else perIp.delete(ip);
      });
      serveConnection(ws, { manager: o.manager, log: o.log, now: o.now });
    });
  });
  const ticker = setInterval(() => o.manager.tick(), 1000 / NET.snapshotHz);
  return {
    wss,
    close: () => {
      clearInterval(ticker);
      for (const ws of wss.clients) ws.close(1001, 'server shutting down');
      wss.close();
    },
  };
}
