import {
  binaryOp,
  createRng,
  decodeSnapshot,
  encodeMessage,
  encodeMove,
  NET,
  OP_SNAPSHOT,
  parseServerMessage,
  PLAYER,
  type ClientMessage,
  type Rng,
  type SnapshotEntry,
  type WirePose,
} from '@huddle/shared';
import WebSocket, { type RawData } from 'ws';

export interface SwarmOptions {
  /** WebSocket endpoint, e.g. `ws://localhost:8787/ws`. */
  url: string;
  room: string;
  count: number;
  durationMs: number;
  /** Walkable area the bots wander in (x/z). */
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
  seed?: number;
  /** Chance per second that a bot says something or emotes. */
  chattiness?: number;
}

export interface SwarmStats {
  joined: number;
  errors: string[];
  snapshots: number;
  /** Most other people any bot saw in one snapshot. */
  maxSeen: number;
  /** Fewest other people a bot ever saw (after its first keyframe). */
  minSeen: number;
  chatReceived: number;
  bytesReceived: number;
  /** Median ping round trip (ms). */
  rttMs: number;
}

const EMOTES = ['wave', 'nod', 'laugh', 'clap', 'thumbsUp'] as const;
const LINES = ['Halo semua!', 'Good morning', 'Can you see my screen?', 'Brb, coffee', '+1'];

interface Bot {
  ws: WebSocket;
  rng: Rng;
  pose: WirePose;
  goal: { x: number; z: number };
  seq: number;
  slot: number;
  joined: boolean;
  /** Slots of other people this bot received positions for. */
  seen: Set<number>;
}

/**
 * Spawns `count` fake clients that join one room, wander at walking speed, emote and chat now
 * and then, and measure what they receive. Used by `pnpm bots` and the swarm test.
 */
export async function runSwarm(o: SwarmOptions): Promise<SwarmStats> {
  const stats: SwarmStats = {
    joined: 0,
    errors: [],
    snapshots: 0,
    maxSeen: 0,
    minSeen: Number.POSITIVE_INFINITY,
    chatReceived: 0,
    bytesReceived: 0,
    rttMs: 0,
  };
  const rtts: number[] = [];
  const entries: SnapshotEntry[] = [];
  const bots: Bot[] = [];
  const pick = (rng: Rng): { x: number; z: number } => ({
    x: rng.range(o.area.minX, o.area.maxX),
    z: rng.range(o.area.minZ, o.area.maxZ),
  });
  const send = (b: Bot, m: ClientMessage): void => {
    if (b.ws.readyState === WebSocket.OPEN) b.ws.send(encodeMessage(m));
  };

  const opened = Array.from({ length: o.count }, (_, i) => {
    const rng = createRng((o.seed ?? 7) * 1000 + i);
    const start = pick(rng);
    const b: Bot = {
      ws: new WebSocket(o.url),
      rng,
      pose: { x: start.x, y: 0, z: start.z, yaw: 0, speed: 0, flags: 1 },
      goal: pick(rng),
      seq: 0,
      slot: -1,
      joined: false,
      seen: new Set(),
    };
    bots.push(b);
    b.ws.on('message', (raw: RawData, isBinary: boolean) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      stats.bytesReceived += bytes.byteLength;
      if (isBinary) {
        if (binaryOp(bytes) !== OP_SNAPSHOT || decodeSnapshot(bytes, entries) === null) return;
        stats.snapshots++;
        for (const e of entries) if (e.slot !== b.slot) b.seen.add(e.slot);
        return;
      }
      const r = parseServerMessage(bytes.toString('utf8'));
      if (!r.ok) {
        stats.errors.push(`invalid server message: ${r.error}`);
        return;
      }
      const m = r.value;
      if (m.t === 'welcome') {
        b.joined = true;
        b.slot = m.slot;
        stats.joined++;
      } else if (m.t === 'chat') stats.chatReceived++;
      else if (m.t === 'pong') rtts.push(Date.now() - m.c);
      else if (m.t === 'error' && m.code !== 'rate')
        stats.errors.push(`${m.code}: ${m.message ?? ''}`);
    });
    b.ws.on('error', (err: Error) => stats.errors.push(`socket: ${err.message}`));
    return new Promise<void>((resolve) => {
      b.ws.once('open', () => {
        send(b, {
          t: 'hello',
          v: NET.protocolVersion,
          room: o.room,
          name: `Bot ${i + 1}`,
          avatar: 'AQ',
        });
        resolve();
      });
      b.ws.once('error', () => resolve());
    });
  });
  await Promise.all(opened);

  const dt = 1 / NET.moveHz;
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const b of bots) {
        if (!b.joined) continue;
        const dx = b.goal.x - b.pose.x;
        const dz = b.goal.z - b.pose.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) b.goal = pick(b.rng);
        const step = Math.min(d, PLAYER.walkSpeed * dt);
        b.pose.x += (dx / (d || 1)) * step;
        b.pose.z += (dz / (d || 1)) * step;
        b.pose.yaw = Math.atan2(dx, dz);
        b.pose.speed = step / dt;
        if (b.ws.readyState === WebSocket.OPEN) b.ws.send(encodeMove(b.seq++, b.pose));
        const chatty = (o.chattiness ?? 0.05) * dt;
        if (b.rng.next() < chatty) send(b, { t: 'act', action: b.rng.pick(EMOTES) });
        if (b.rng.next() < chatty * 0.3) send(b, { t: 'chat', text: b.rng.pick(LINES) });
        if (b.rng.next() < dt * 0.5) send(b, { t: 'ping', c: now });
      }
      if (now - started >= o.durationMs) {
        clearInterval(timer);
        resolve();
      }
    }, 1000 * dt);
  });

  for (const b of bots) b.ws.close(4000, 'leave');
  rtts.sort((a, z) => a - z);
  stats.rttMs = rtts[Math.floor(rtts.length / 2)] ?? 0;
  const seen = bots.map((b) => b.seen.size);
  stats.maxSeen = Math.max(0, ...seen);
  stats.minSeen = Math.min(...seen);
  if (!Number.isFinite(stats.minSeen)) stats.minSeen = 0;
  return stats;
}
