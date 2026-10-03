import {
  createLogger,
  decodeSnapshot,
  encodeMessage,
  encodeMove,
  NET,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type SnapshotEntry,
} from '@huddle/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { createHuddleServer, type HuddleServer } from '../app.ts';
import { runSwarm } from '../bots/swarm.ts';
import { loadConfig } from '../config.ts';

let server: HuddleServer;
let url: string;

beforeAll(async () => {
  const config = loadConfig({
    HUDDLE_PORT: '0',
    HUDDLE_HOST: '127.0.0.1',
    HUDDLE_MAX_CONN_PER_IP: '200',
    HUDDLE_ROOM_CAPACITY: '50',
  });
  server = await createHuddleServer(
    config,
    createLogger(() => undefined, 'test', 'error'),
  );
  url = `ws://127.0.0.1:${await server.listen()}/ws`;
});

afterAll(async () => {
  await server.close();
});

/** A minimal protocol client that records what it receives. */
class Client {
  readonly ws: WebSocket;
  readonly texts: ServerMessage[] = [];
  readonly positions = new Map<number, SnapshotEntry>();
  private readonly entries: SnapshotEntry[] = [];

  constructor() {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw: RawData, isBinary: boolean) => {
      const bytes = raw as Buffer;
      if (isBinary) {
        if (decodeSnapshot(bytes, this.entries) === null) return;
        for (const e of this.entries) this.positions.set(e.slot, { ...e });
        return;
      }
      const r = parseServerMessage(bytes.toString('utf8'));
      if (r.ok) this.texts.push(r.value);
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(m: ClientMessage): void {
    this.ws.send(encodeMessage(m));
  }

  async waitFor<T extends ServerMessage['t']>(
    t: T,
    match: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    for (let i = 0; i < 100; i++) {
      const hit = this.texts.find(
        (m): m is Extract<ServerMessage, { t: T }> =>
          m.t === t && match(m as Extract<ServerMessage, { t: T }>),
      );
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${t}`);
  }
}

async function joinAll(room: string, names: string[]): Promise<Client[]> {
  const clients = names.map(() => new Client());
  await Promise.all(clients.map((c) => c.opened()));
  for (const [i, c] of clients.entries()) {
    c.send({ t: 'hello', v: NET.protocolVersion, room, name: names[i] ?? 'x', avatar: 'AQ' });
    await c.waitFor('welcome');
  }
  return clients;
}

describe('realtime server over WebSocket', () => {
  it('three clients see each other move, chat and emote', async () => {
    const [a, b, c] = await joinAll('TRIO01', ['Ana', 'Budi', 'Cici']);
    if (!a || !b || !c) throw new Error('clients missing');
    const welcome = await a.waitFor('welcome');
    const spawn = welcome.players.find((p) => p.id === welcome.self)?.pos ?? { x: 0, y: 0, z: 0 };
    a.ws.send(encodeMove(1, { ...spawn, x: spawn.x + 0.4, yaw: 1, speed: 2, flags: 1 }));
    a.send({ t: 'chat', text: 'Halo!' });
    a.send({ t: 'act', action: 'wave' });
    await new Promise((r) => setTimeout(r, 200));
    for (const other of [b, c]) {
      expect(other.positions.get(welcome.slot)?.x).toBeCloseTo(spawn.x + 0.4, 3);
      expect((await other.waitFor('chat')).line).toMatchObject({ text: 'Halo!', name: 'Ana' });
      expect((await other.waitFor('act')).action).toBe('wave');
    }
    // Ana does not get her own emote back, but she does get the chat line.
    expect(a.texts.some((m) => m.t === 'act')).toBe(false);
    expect((await a.waitFor('chat')).line.text).toBe('Halo!');
    c.ws.close(4000, 'leave');
    expect((await a.waitFor('left')).reason).toBe('leave');
    a.ws.close();
    b.ws.close();
  });

  it('rejects other origins and malformed frames', async () => {
    const foreign = new WebSocket(url, { headers: { origin: 'https://evil.example' } });
    const status = await new Promise<number>((resolve) => {
      foreign.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      foreign.on('error', () => resolve(-1));
    });
    expect(status).toBe(403);
    const [a] = await joinAll('JUNK01', ['Ana']);
    if (!a) throw new Error('client missing');
    a.ws.send('{"t":"chat","text":');
    expect((await a.waitFor('error')).code).toBe('invalid');
    a.ws.close();
  });

  it('bot swarm: 50 clients share a room smoothly', async () => {
    const stats = await runSwarm({
      url,
      room: 'SWARM1',
      count: 50,
      durationMs: 2500,
      area: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
    });
    expect(stats.errors).toEqual([]);
    expect(stats.joined).toBe(50);
    expect(stats.minSeen).toBe(49);
    expect(stats.snapshots).toBeGreaterThan(50 * 30);
    expect(stats.rttMs).toBeLessThan(250);
  }, 30_000);
});
