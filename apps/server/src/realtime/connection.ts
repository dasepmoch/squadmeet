import {
  binaryOp,
  encodeMessage,
  errorMessage,
  OP_MOVE,
  parseClientMessage,
  type Logger,
  type ServerMessage,
} from '@huddle/shared';
import type { RawData, WebSocket } from 'ws';
import type { Member, Peer } from './member.ts';
import { TokenBucket } from './rate-limit.ts';
import type { RoomManager } from './room-manager.ts';
import type { Room } from './room.ts';

/** Close codes (4000-4999 are application-defined). */
export const CLOSE = {
  /** The client is leaving for good: no resume window. */
  leave: 4000,
  /** The same session connected again from elsewhere. */
  replaced: 4001,
  rejected: 4002,
  kicked: 4003,
  flooding: 4008,
} as const;

const HEARTBEAT_MS = 15_000;
/** Messages past the per-connection budget are dropped; this many drops close the socket. */
const FLOOD_STRIKES = 300;

export interface ConnectionDeps {
  manager: RoomManager;
  log: Logger;
  now: () => number;
}

function bytesOf(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

/**
 * One WebSocket: the hello handshake, then text messages to the room and binary `MOVE` frames
 * to the movement validator. A heartbeat finds dead connections, which become "away".
 */
export function serveConnection(ws: WebSocket, d: ConnectionDeps): void {
  const peer: Peer = {
    sendText: (text) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    sendBinary: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data, { binary: true });
    },
    close: (code, reason) => ws.close(code, reason),
    get buffered() {
      return ws.bufferedAmount;
    },
  };
  const send = (msg: ServerMessage): void => peer.sendText(encodeMessage(msg));
  let joined: { room: Room; member: Member } | null = null;
  let joining = false;
  let alive = true;
  let strikes = 0;
  // Movement (20/s) plus WebRTC negotiation bursts when joining a full room.
  const budget = new TokenBucket(500, 160, d.now());

  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);
  ws.on('pong', () => {
    alive = true;
  });

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    alive = true;
    if (!budget.take(d.now())) {
      if (++strikes > FLOOD_STRIKES) ws.close(CLOSE.flooding, 'flooding');
      return;
    }
    const bytes = bytesOf(raw);
    if (isBinary) {
      if (joined && binaryOp(bytes) === OP_MOVE) joined.room.handleMove(joined.member, bytes);
      return;
    }
    const parsed = parseClientMessage(bytes.toString('utf8'));
    if (!parsed.ok) {
      send({ t: 'error', code: 'invalid', message: 'Malformed message.' });
      return;
    }
    const msg = parsed.value;
    if (msg.t !== 'hello') {
      if (joined) joined.room.handle(joined.member, msg);
      else send({ t: 'error', code: 'notJoined' });
      return;
    }
    if (joined || joining) return;
    joining = true;
    d.manager
      .join(peer, msg)
      .then((r) => {
        joining = false;
        if (!r.ok) {
          send({ t: 'error', code: r.error, message: r.message });
          ws.close(CLOSE.rejected, r.error);
          return;
        }
        // Closed while we were joining: nobody has the resume token, so leave right away.
        if (ws.readyState !== ws.OPEN) r.room.disconnect(r.member, peer, true);
        else joined = { room: r.room, member: r.member };
      })
      .catch((err: unknown) => {
        d.log.error('join failed', errorMessage(err));
        ws.close(1011, 'internal');
      });
  });

  ws.on('close', (code: number) => {
    clearInterval(heartbeat);
    if (joined) joined.room.disconnect(joined.member, peer, code === CLOSE.leave);
    joined = null;
  });
  ws.on('error', (err: Error) => d.log.debug('socket error', errorMessage(err)));
}
