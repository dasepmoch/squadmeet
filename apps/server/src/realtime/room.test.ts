import { loadRoom } from '@huddle/content';
import {
  createLogger,
  decodeSnapshot,
  encodeMove,
  NET,
  parseServerMessage,
  type ResolvedRoom,
  type ServerMessage,
  type SnapshotEntry,
} from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Member, Peer } from './member.ts';
import { RoomManager } from './room-manager.ts';
import type { Room } from './room.ts';
import type { IceConfig } from './turn.ts';

/** Records what the server sends; every text frame must pass the protocol schema. */
class FakePeer implements Peer {
  readonly texts: ServerMessage[] = [];
  readonly binaries: Uint8Array[] = [];
  closed: number | null = null;
  buffered = 0;
  sendText(text: string): void {
    const r = parseServerMessage(text);
    if (!r.ok) throw new Error(`server sent an invalid message: ${r.error} (${text})`);
    this.texts.push(r.value);
  }
  sendBinary(data: Uint8Array): void {
    this.binaries.push(data);
  }
  close(code: number): void {
    this.closed = code;
  }
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.texts.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }
}

let resolved: ResolvedRoom;
const silent = createLogger(() => undefined, 'test', 'error');

beforeAll(async () => {
  resolved = (await loadRoom('boardroom')).resolved;
});

function setup(
  capacity = 8,
  media: { meshCap?: number; ice?: IceConfig } = {},
): { manager: RoomManager; clock: { t: number } } {
  const clock = { t: 1_000_000 };
  const manager = new RoomManager({
    map: 'boardroom',
    resolved,
    capacity,
    maxRooms: 10,
    meshCap: media.meshCap ?? 8,
    ice: media.ice ?? { urls: [], turnSecret: null, ttlSeconds: 3600 },
    now: () => clock.t,
    log: silent,
  });
  return { manager, clock };
}

async function join(
  manager: RoomManager,
  room: string | null,
  name = 'Ana',
  extra: { passcode?: string; resume?: { id: string; token: string } } = {},
): Promise<{ peer: FakePeer; room: Room; member: Member }> {
  const peer = new FakePeer();
  const r = await manager.join(peer, {
    t: 'hello',
    v: NET.protocolVersion,
    room,
    name,
    avatar: 'AQ',
    ...extra,
  });
  if (!r.ok) throw new Error(r.error);
  return { peer, room: r.room, member: r.member };
}

/** The seat closest to where people spawn (reachable without walking far). */
function nearestSeat(room: Room): string {
  const p = room.members.values().next().value?.pose ?? { x: 0, z: 0 };
  const sorted = [...resolved.seats].sort(
    (a, b) =>
      Math.hypot(a.position[0] - p.x, a.position[2] - p.z) -
      Math.hypot(b.position[0] - p.x, b.position[2] - p.z),
  );
  return sorted[0]?.id ?? '';
}

describe('rooms', () => {
  it('creates a room for the first person (host) and welcomes the next', async () => {
    const { manager } = setup();
    const a = await join(manager, null, 'Ana');
    const code = a.room.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const b = await join(manager, code, '  Budi\u202e ');
    expect(b.room).toBe(a.room);
    const welcome = b.peer.of('welcome')[0];
    expect(welcome?.players.map((p) => p.name)).toEqual(['Ana', 'Budi']);
    expect(welcome?.room.host).toBe(a.member.id);
    expect(a.peer.of('joined')[0]?.player.id).toBe(b.member.id);
  });

  it('enforces capacity and passcodes', async () => {
    const { manager } = setup(2);
    const a = await join(manager, 'TEAM42', 'Ana', { passcode: 'sesame' });
    await expect(join(manager, 'TEAM42', 'Budi')).rejects.toThrow('passcode');
    await join(manager, 'TEAM42', 'Budi', { passcode: 'sesame' });
    await expect(join(manager, 'TEAM42', 'Cici', { passcode: 'sesame' })).rejects.toThrow('full');
    expect(a.room.info().locked).toBe(true);
  });

  it('arbitrates seats: first come first served, freed on stand', async () => {
    const { manager } = setup();
    const a = await join(manager, 'SEATS1', 'Ana');
    const b = await join(manager, 'SEATS1', 'Budi');
    const seat = nearestSeat(a.room);
    a.room.handle(a.member, { t: 'sit', seat });
    b.room.handle(b.member, { t: 'sit', seat });
    expect(b.peer.of('seatDenied')).toEqual([{ t: 'seatDenied', seat }]);
    expect(b.peer.of('seat').at(-1)).toEqual({ t: 'seat', seat, id: a.member.id });
    a.room.handle(a.member, { t: 'stand' });
    expect(b.peer.of('seat').at(-1)).toEqual({ t: 'seat', seat, id: null });
    b.room.handle(b.member, { t: 'sit', seat: 'no-such-seat' });
    expect(b.peer.of('seatDenied')).toHaveLength(2);
  });

  it('sanitizes and rate-limits chat, keeping a short history', async () => {
    const { manager } = setup();
    const a = await join(manager, 'CHAT01');
    for (let i = 0; i < 8; i++) a.room.handle(a.member, { t: 'chat', text: ` hi\u0007 ${i} ` });
    const lines = a.peer.of('chat').map((m) => m.line.text);
    expect(lines).toEqual(['hi 0', 'hi 1', 'hi 2', 'hi 3', 'hi 4']);
    expect(a.peer.of('error').some((e) => e.code === 'rate')).toBe(true);
    const late = await join(manager, 'CHAT01', 'Budi');
    expect(late.peer.of('welcome')[0]?.chat).toHaveLength(5);
  });

  it('clamps impossible moves and broadcasts snapshots', async () => {
    const { manager, clock } = setup();
    const a = await join(manager, 'MOVE01');
    const b = await join(manager, 'MOVE01', 'Budi');
    const start = { ...a.member.pose };
    clock.t += 50;
    a.room.handleMove(a.member, encodeMove(1, { ...start, x: start.x + 0.2, speed: 2.7 }));
    expect(a.member.pose.x).toBeCloseTo(start.x + 0.2, 4);
    clock.t += 50;
    a.room.handleMove(a.member, encodeMove(2, { ...start, x: start.x + 40 }));
    expect(a.member.pose.x - start.x).toBeLessThan(3);
    manager.tick();
    const entries: SnapshotEntry[] = [];
    const frame = b.peer.binaries.at(-1);
    expect(frame && decodeSnapshot(frame, entries)).toBe(clock.t);
    expect(entries.find((e) => e.slot === a.member.slot)?.x).toBeCloseTo(a.member.pose.x, 4);
  });

  it('keeps a dropped session (seat included) for the grace window, then lets it go', async () => {
    const { manager, clock } = setup();
    const a = await join(manager, 'RESUME', 'Ana');
    const b = await join(manager, 'RESUME', 'Budi');
    const seat = nearestSeat(a.room);
    a.room.handle(a.member, { t: 'sit', seat });
    a.room.disconnect(a.member, a.peer, false);
    expect(b.peer.of('away').at(-1)).toEqual({ t: 'away', id: a.member.id, away: true });
    clock.t += 5000;
    const back = await join(manager, 'RESUME', 'Ana', {
      resume: { id: a.member.id, token: a.member.token },
    });
    expect(back.member).toBe(a.member);
    const welcome = back.peer.of('welcome')[0];
    expect(welcome?.resumed).toBe(true);
    expect(welcome?.players.find((p) => p.id === a.member.id)?.seat).toBe(seat);
    back.room.disconnect(back.member, back.peer, false);
    clock.t += NET.resumeGraceMs + 1;
    manager.tick();
    expect(b.peer.of('left').at(-1)).toEqual({ t: 'left', id: a.member.id, reason: 'timeout' });
    expect(b.room.seats.has(seat)).toBe(false);
    // A wrong token joins as somebody new instead of hijacking the session.
    const imposter = await join(manager, 'RESUME', 'Eve', {
      resume: { id: b.member.id, token: 'x'.repeat(32) },
    });
    expect(imposter.member.id).not.toBe(b.member.id);
  });

  it('reserves host commands for the host and enforces throw rules', async () => {
    const { manager } = setup();
    const a = await join(manager, 'HOST01', 'Ana');
    const b = await join(manager, 'HOST01', 'Budi');
    b.room.handle(b.member, { t: 'host', cmd: { op: 'lockThrows', locked: true } });
    expect(b.peer.of('error').at(-1)?.code).toBe('forbidden');
    const from = { x: b.member.pose.x, y: 1.4, z: b.member.pose.z };
    b.room.handle(b.member, { t: 'hit', n: 1, target: a.member.id });
    expect(a.peer.of('hit')).toHaveLength(0);
    b.room.handle(b.member, {
      t: 'throw',
      kind: 'tomato',
      from,
      to: { x: 0, y: 1, z: 0 },
      target: a.member.id,
      n: 1,
    });
    expect(a.peer.of('throw')).toHaveLength(1);
    b.room.handle(b.member, { t: 'hit', n: 1, target: a.member.id });
    b.room.handle(b.member, { t: 'hit', n: 1, target: a.member.id });
    expect(a.peer.of('hit')).toEqual([
      { t: 'hit', id: b.member.id, kind: 'tomato', target: a.member.id },
    ]);
    a.room.handle(a.member, { t: 'host', cmd: { op: 'mode', mode: 'serious' } });
    b.room.handle(b.member, {
      t: 'throw',
      kind: 'paper',
      from,
      to: { x: 0, y: 1, z: 0 },
      target: null,
      n: 2,
    });
    expect(a.peer.of('throw')).toHaveLength(1);
    a.room.handle(a.member, { t: 'host', cmd: { op: 'kick', target: b.member.id } });
    expect(b.peer.of('error').at(-1)?.code).toBe('kicked');
    expect(b.peer.closed).toBe(4003);
    expect(a.peer.of('left').at(-1)).toEqual({ t: 'left', id: b.member.id, reason: 'kick' });
  });

  it('passes the host role on when the host leaves', async () => {
    const { manager } = setup();
    const a = await join(manager, 'HOST02', 'Ana');
    const b = await join(manager, 'HOST02', 'Budi');
    a.room.disconnect(a.member, a.peer, true);
    expect(b.peer.of('room').at(-1)?.room.host).toBe(b.member.id);
  });
});
