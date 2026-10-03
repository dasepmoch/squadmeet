import {
  createLogger,
  decodeMove,
  encodeMessage,
  encodeSnapshot,
  ManualClock,
  NET,
  parseClientMessage,
  type ClientMessage,
  type PlayerInfo,
  type ServerMessage,
  type SocketLike,
  type WirePose,
} from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { ClockSync } from './clock-sync.ts';
import { PoseBuffer } from './interpolation.ts';
import { RealtimeClient, type ConnectionState } from './realtime-client.ts';

const pose = (x = 0, z = 0, speed = 0): WirePose => ({ x, y: 0, z, yaw: 0, speed, flags: 1 });

describe('clock sync', () => {
  it('estimates the server offset and ignores slow samples', () => {
    const sync = new ClockSync();
    // Server clock runs 5000 ms ahead; one-way delay 20 ms.
    for (let i = 0; i < 6; i++) sync.add(i * 1000, i * 1000 + 5020, i * 1000 + 40);
    // A sample stuck in a queue (300 ms one way back).
    sync.add(9000, 14020, 9320);
    expect(sync.offset).toBeCloseTo(5000, 0);
    expect(sync.rtt).toBeCloseTo(40, 0);
    expect(sync.serverNow(100)).toBeCloseTo(5100, 0);
  });
});

describe('pose interpolation', () => {
  it('interpolates between snapshots and caps extrapolation', () => {
    const b = new PoseBuffer();
    const out = pose();
    b.push(1000, pose(0, 0, 2));
    b.push(1050, pose(0.1, 0, 2));
    b.push(1100, pose(0.2, 0, 2));
    expect(b.sample(1075, out, 250)).toBe(true);
    expect(out.x).toBeCloseTo(0.15, 5);
    b.sample(1150, out, 250);
    expect(out.x).toBeCloseTo(0.3, 5);
    b.sample(5000, out, 250);
    expect(out.x).toBeCloseTo(0.7, 5);
    // A stop (speed 0) is held, not extrapolated.
    b.push(1150, pose(0.25, 0, 0));
    b.sample(5000, out, 250);
    expect(out.x).toBeCloseTo(0.25, 5);
  });

  it('ignores reordered packets', () => {
    const b = new PoseBuffer();
    const out = pose();
    b.push(1000, pose(1));
    b.push(900, pose(-5));
    b.sample(950, out, 250);
    expect(out.x).toBe(1);
  });
});

/** In-memory socket pair: the test plays the server. */
class FakeSocket implements SocketLike {
  isOpen = false;
  readonly sent: (string | Uint8Array)[] = [];
  onOpen: (() => void) | null = null;
  onMessage: ((data: string | Uint8Array) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  closedWith: number | null = null;
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.isOpen = false;
  }
  open(): void {
    this.isOpen = true;
    this.onOpen?.();
  }
  drop(code = 1006): void {
    this.isOpen = false;
    this.onClose?.(code, '');
  }
  serverSends(msg: ServerMessage): void {
    this.onMessage?.(encodeMessage(msg));
  }
  json(): ClientMessage[] {
    return this.sent.flatMap((d) => {
      if (typeof d !== 'string') return [];
      const r = parseClientMessage(d);
      return r.ok ? [r.value] : [];
    });
  }
}

const info = (id: string, slot: number): PlayerInfo => ({
  id,
  slot,
  name: id,
  avatar: 'AQ',
  away: false,
  seat: null,
  hand: null,
  pos: { x: 0, y: 0, z: 0 },
  yaw: 0,
  muted: true,
  deafened: false,
  since: slot,
  held: null,
  shield: false,
  points: 0,
});

function welcome(self: string, slot: number, now: number, resumed = false): ServerMessage {
  return {
    t: 'welcome',
    v: NET.protocolVersion,
    self,
    slot,
    token: 'tok_0123456789abcdef',
    resumed,
    room: {
      code: 'ROOM42',
      map: 'boardroom',
      mode: 'casual',
      throwsLocked: false,
      host: self,
      capacity: 24,
      locked: false,
      voice: 'zones',
      presenter: null,
      meshCap: 8,
    },
    players: [info(self, slot), info('pB', 2)],
    chat: [],
    now,
    ice: [],
  };
}

function setup(): {
  client: RealtimeClient;
  clock: ManualClock;
  sockets: FakeSocket[];
  states: ConnectionState[];
} {
  const clock = new ManualClock();
  const sockets: FakeSocket[] = [];
  const client = new RealtimeClient({
    url: 'ws://test/ws',
    sockets: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    clock,
    logger: createLogger(() => undefined, 'test', 'error'),
    random: () => 0.5,
  });
  const states: ConnectionState[] = [];
  client.events.on('state', (e) => states.push(e.state));
  return { client, clock, sockets, states };
}

describe('realtime client', () => {
  it('joins, throttles movement and interpolates remote players', () => {
    const { client, clock, sockets } = setup();
    client.connect({ room: 'ROOM42', name: 'Ana', avatar: 'AQ' });
    const s = sockets[0] as FakeSocket;
    s.open();
    expect(s.json()[0]).toMatchObject({ t: 'hello', room: 'ROOM42', name: 'Ana' });
    s.serverSends(welcome('pA', 1, 10_000));
    expect(client.state).toBe('joined');
    // Ten frames in 50 ms: one move (rate limit); then nothing new while still.
    for (let i = 0; i < 10; i++) {
      client.sendMove(pose(1, 1, 2));
      clock.advance(5);
    }
    clock.advance(100);
    client.sendMove(pose(1, 1, 2));
    const moves = s.sent.filter((d): d is Uint8Array => typeof d !== 'string');
    expect(moves).toHaveLength(1);
    // Coming to rest is always sent.
    client.sendMove(pose(1, 1, 0));
    const last = pose();
    const sentMoves = s.sent.filter((d): d is Uint8Array => typeof d !== 'string');
    expect(sentMoves).toHaveLength(2);
    expect(decodeMove(sentMoves[1] as Uint8Array, last)).toBe(1);
    expect(last.speed).toBe(0);
    // Snapshots for pB (slot 2) at server times 10 100 and 10 150.
    s.onMessage?.(encodeSnapshot(10_100, [{ slot: 2, ...pose(1, 0, 2) }]));
    s.onMessage?.(encodeSnapshot(10_150, [{ slot: 2, ...pose(2, 0, 2) }]));
    const out = pose();
    client.sync.add(clock.now(), 10_125 + NET.interpolationDelayMs, clock.now());
    expect(client.poseOf('pB', out)).toBe(true);
    expect(out.x).toBeCloseTo(1.5, 1);
  });

  it('reconnects with backoff and resumes the session', () => {
    const { client, clock, sockets, states } = setup();
    client.connect({ room: 'ROOM42', name: 'Ana', avatar: 'AQ' });
    (sockets[0] as FakeSocket).open();
    (sockets[0] as FakeSocket).serverSends(welcome('pA', 1, 10_000));
    (sockets[0] as FakeSocket).drop();
    expect(client.state).toBe('reconnecting');
    clock.advance(400);
    expect(sockets).toHaveLength(1);
    clock.advance(200);
    expect(sockets).toHaveLength(2);
    // The second attempt fails too: the next wait doubles.
    (sockets[1] as FakeSocket).drop();
    clock.advance(900);
    expect(sockets).toHaveLength(2);
    clock.advance(200);
    const s = sockets[2] as FakeSocket;
    s.open();
    expect(s.json()[0]).toMatchObject({ t: 'hello', resume: { id: 'pA' } });
    s.serverSends(welcome('pA', 1, 20_000, true));
    expect(client.state).toBe('joined');
    expect(states).toEqual(['connecting', 'joined', 'reconnecting', 'joined']);
  });

  it('gives up on fatal errors and leaves cleanly', () => {
    const { client, sockets } = setup();
    client.connect({ room: 'FULL01', name: 'Ana', avatar: 'AQ' });
    const s = sockets[0] as FakeSocket;
    s.open();
    s.serverSends({ t: 'error', code: 'full', message: 'This room is full.' });
    s.drop(4002);
    expect(client.state).toBe('failed');
    const { client: c2, sockets: s2 } = setup();
    c2.connect({ room: 'ROOM42', name: 'Ana', avatar: 'AQ' });
    (s2[0] as FakeSocket).open();
    (s2[0] as FakeSocket).serverSends(welcome('pA', 1, 1));
    c2.leave();
    expect((s2[0] as FakeSocket).closedWith).toBe(4000);
    expect(c2.state).toBe('closed');
  });
});
