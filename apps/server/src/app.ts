import { DEFAULT_ROOM_ID, loadRoom } from '@huddle/content';
import { errorMessage, NET, type Logger } from '@huddle/shared';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientRuntimeConfig, ServerConfig } from './config.ts';
import { applyCors, createSecurityHeaders } from './http/security.ts';
import { createStaticHandler } from './http/static.ts';
import { RoomManager } from './realtime/room-manager.ts';
import { attachRealtime, type Realtime } from './realtime/ws-server.ts';

export interface HuddleServer {
  readonly http: Server;
  readonly manager: RoomManager;
  /** Starts listening; resolves with the bound port (handy with port 0 in tests). */
  listen(): Promise<number>;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** HTTP (health, runtime config, static client) and the realtime WebSocket endpoint. */
export async function createHuddleServer(config: ServerConfig, log: Logger): Promise<HuddleServer> {
  const room = await loadRoom(DEFAULT_ROOM_ID);
  const now = (): number => Date.now();
  const iceUrls = config.HUDDLE_ICE_URLS;
  if (iceUrls.some((u) => /^turns?:/i.test(u)) && !config.HUDDLE_TURN_SECRET) {
    log.warn('TURN URLs are configured without HUDDLE_TURN_SECRET; they are not handed out');
  }
  const manager = new RoomManager({
    map: DEFAULT_ROOM_ID,
    resolved: room.resolved,
    capacity: config.HUDDLE_ROOM_CAPACITY,
    maxRooms: config.HUDDLE_MAX_ROOMS,
    meshCap: config.HUDDLE_MESH_CAP,
    ice: {
      urls: iceUrls,
      turnSecret: config.HUDDLE_TURN_SECRET ?? null,
      ttlSeconds: config.HUDDLE_TURN_TTL_SECONDS,
    },
    now,
    log: log.child('rooms'),
  });
  const runtimeConfig: ClientRuntimeConfig = {
    protocolVersion: NET.protocolVersion,
    mediaTransport: config.HUDDLE_MEDIA_TRANSPORT,
    meshCap: config.HUDDLE_MESH_CAP,
    roomCapacity: config.HUDDLE_ROOM_CAPACITY,
    features: { throwables: true, webcam: true, jukebox: true },
  };
  const security = createSecurityHeaders({
    extraConnectSrc: config.HUDDLE_LIVEKIT_URL ? [config.HUDDLE_LIVEKIT_URL] : [],
    allowedOrigins: config.HUDDLE_ALLOWED_ORIGINS,
  });
  const serveStatic = config.HUDDLE_STATIC_DIR
    ? createStaticHandler(config.HUDDLE_STATIC_DIR)
    : null;

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    applyCors(req, res, config.HUDDLE_ALLOWED_ORIGINS);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, ...manager.stats });
      return;
    }
    if (url.pathname === '/config.json') {
      sendJson(res, 200, runtimeConfig);
      return;
    }
    if (serveStatic && (await serveStatic(req, res))) return;
    sendJson(res, 404, { error: 'not_found' });
  }

  const http = createServer((req, res) => {
    security(req, res, (err) => {
      if (err) {
        log.error('security middleware failed', errorMessage(err));
        sendJson(res, 500, { error: 'internal' });
        return;
      }
      route(req, res).catch((routeErr: unknown) => {
        log.error('request failed', { url: req.url, error: errorMessage(routeErr) });
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
        else res.destroy();
      });
    });
  });
  const realtime: Realtime = attachRealtime(http, {
    path: '/ws',
    allowedOrigins: config.HUDDLE_ALLOWED_ORIGINS,
    maxPerIp: config.HUDDLE_MAX_CONN_PER_IP,
    trustProxy: config.HUDDLE_TRUST_PROXY,
    manager,
    log: log.child('ws'),
    now,
  });

  return {
    http,
    manager,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.HUDDLE_PORT, config.HUDDLE_HOST, () => {
          http.off('error', reject);
          resolve((http.address() as AddressInfo).port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        realtime.close();
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
