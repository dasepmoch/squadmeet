import { loadRoom } from '@huddle/content';
import {
  createLogger,
  NET,
  parseServerMessage,
  type ClientMessage,
  type ResolvedRoom,
  type ServerMessage,
} from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Member, Peer } from './member.ts';
import { RoomManager } from './room-manager.ts';
import type { Room } from './room.ts';

class FakePeer implements Peer {
  readonly texts: ServerMessage[] = [];
  buffered = 0;
  sendText(text: string): void {
    const r = parseServerMessage(text);
    if (!r.ok) throw new Error(`server sent an invalid message: ${r.error} (${text})`);
    this.texts.push(r.value);
  }
  sendBinary(): void {}
  close(): void {}
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.texts.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }
}

let resolved: ResolvedRoom;
beforeAll(async () => {
  resolved = (await loadRoom('boardroom')).resolved;
});

type Joined = { peer: FakePeer; room: Room; member: Member; send(m: ClientMessage): void };

function setup(): { manager: RoomManager; clock: { t: number } } {
  const clock = { t: 5_000_000 };
  const manager = new RoomManager({
    map: 'boardroom',
    resolved,
    capacity: 12,
    maxRooms: 4,
    meshCap: 8,
    ice: { urls: [], turnSecret: null, ttlSeconds: 3600 },
    now: () => clock.t,
    log: createLogger(() => undefined, 'test', 'error'),
  });
  return { manager, clock };
}

async function join(manager: RoomManager, room: string, name: string): Promise<Joined> {
  const peer = new FakePeer();
  const r = await manager.join(peer, {
    t: 'hello',
    v: NET.protocolVersion,
    room,
    name,
    avatar: 'AQ',
  });
  if (!r.ok) throw new Error(r.error);
  const { room: joined, member } = r;
  return { peer, room: joined, member, send: (m) => joined.handle(member, m) };
}

/** A throw of `kind` numbered `n`, released where `who` stands (x offset to stand back). */
function throwFrom(who: Joined, kind: 'paper' | 'tomato' | 'plane', n: number): ClientMessage {
  const p = who.member.pose;
  return {
    t: 'throw',
    kind,
    from: { x: p.x, y: 1.4, z: p.z },
    to: { x: 7.6, y: 2.1, z: 3.7 },
    target: null,
    n,
    tilt: kind === 'plane' ? 0.5 : undefined,
  };
}

describe('baskets', () => {
  it('scores 2 up close and 3 from range, once per throw, paper and ducks only', async () => {
    const { manager, clock } = setup();
    const a = await join(manager, 'HOOPS1', 'Ana');
    const b = await join(manager, 'HOOPS1', 'Budi');
    // Ana steps up to the hoop (her spawn is already within the 3-point line).
    a.member.pose.x = 6;
    a.member.pose.z = 3.7;
    a.send(throwFrom(a, 'paper', 1));
    a.send({ t: 'score', n: 1, hoop: 'hoop' });
    a.send({ t: 'score', n: 1, hoop: 'hoop' });
    expect(b.peer.of('score')).toEqual([
      { t: 'score', id: a.member.id, hoop: 'hoop', points: 2, total: 2 },
    ]);
    // The scorer hears it too: everyone's scoreboard updates from the same message.
    expect(a.peer.of('score')).toHaveLength(1);
    a.member.pose.x = 2.5;
    clock.t += 1000;
    a.send(throwFrom(a, 'paper', 2));
    a.send({ t: 'score', n: 2, hoop: 'hoop' });
    expect(b.peer.of('score').at(-1)).toMatchObject({ points: 3, total: 5 });
    // Tomatoes splat, they don't score; unknown hoops and stale throws don't either.
    clock.t += 1000;
    a.send(throwFrom(a, 'tomato', 3));
    a.send({ t: 'score', n: 3, hoop: 'hoop' });
    a.send(throwFrom(a, 'paper', 4));
    a.send({ t: 'score', n: 4, hoop: 'nope' });
    clock.t += 7000;
    a.send({ t: 'score', n: 4, hoop: 'hoop' });
    expect(b.peer.of('score')).toHaveLength(2);
    // Points live on the player: newcomers see them, the host can reset them.
    const c = await join(manager, 'HOOPS1', 'Cici');
    expect(c.peer.of('welcome')[0]?.players.find((p) => p.id === a.member.id)?.points).toBe(5);
    b.send({ t: 'host', cmd: { op: 'resetScores' } });
    expect(b.peer.of('error').at(-1)?.code).toBe('forbidden');
    a.send({ t: 'host', cmd: { op: 'resetScores' } });
    expect(c.peer.of('scoreReset')).toEqual([{ t: 'scoreReset', by: a.member.id }]);
    expect(a.member.points).toBe(0);
  });
});

describe("don't hit me", () => {
  it('protects people from hits and keeps them from throwing', async () => {
    const { manager } = setup();
    const a = await join(manager, 'SHIELD', 'Ana');
    const b = await join(manager, 'SHIELD', 'Budi');
    b.send({ t: 'shield', on: true });
    expect(a.peer.of('shield')).toEqual([{ t: 'shield', id: b.member.id, on: true }]);
    // Aimed at Budi: the throw still flies (it passes through him), but targets nobody.
    a.send({ ...throwFrom(a, 'tomato', 7), target: b.member.id } as ClientMessage);
    expect(b.peer.of('throw')[0]?.target).toBeNull();
    a.send({ t: 'hit', n: 7, target: b.member.id });
    expect(b.peer.of('hit')).toHaveLength(0);
    // ... and he can't throw while protected.
    b.send(throwFrom(b, 'paper', 1));
    expect(a.peer.of('throw')).toHaveLength(0);
    expect(b.peer.of('error').at(-1)?.code).toBe('forbidden');
    const c = await join(manager, 'SHIELD', 'Cici');
    expect(c.peer.of('welcome')[0]?.players.find((p) => p.id === b.member.id)?.shield).toBe(true);
    // Nobody hits themselves either.
    a.send({ t: 'hit', n: 7, target: a.member.id });
    expect(b.peer.of('hit')).toHaveLength(0);
  });
});

describe('held items, pickups and clean-up', () => {
  it('relays what people hold and who picked up a plane', async () => {
    const { manager } = setup();
    const a = await join(manager, 'ITEMS1', 'Ana');
    const b = await join(manager, 'ITEMS1', 'Budi');
    a.send({ t: 'hold', item: 'mug' });
    a.send({ t: 'hold', item: 'mug' });
    expect(b.peer.of('hold')).toEqual([{ t: 'hold', id: a.member.id, item: 'mug' }]);
    b.send(throwFrom(b, 'plane', 9));
    expect(a.peer.of('throw')[0]).toMatchObject({ kind: 'plane', n: 9, tilt: 0.5 });
    a.send({ t: 'pickup', owner: b.member.id, n: 9 });
    expect(b.peer.of('pickup')).toEqual([
      { t: 'pickup', id: a.member.id, owner: b.member.id, n: 9 },
    ]);
    const c = await join(manager, 'ITEMS1', 'Cici');
    expect(c.peer.of('welcome')[0]?.players.find((p) => p.id === a.member.id)?.held).toBe('plane');
    a.send({ t: 'hold', item: null });
    expect(c.peer.of('hold').at(-1)).toEqual({ t: 'hold', id: a.member.id, item: null });
  });

  it('lets only the host mop up, for everyone', async () => {
    const { manager } = setup();
    const a = await join(manager, 'CLEAN1', 'Ana');
    const b = await join(manager, 'CLEAN1', 'Budi');
    b.send({ t: 'host', cmd: { op: 'clean' } });
    expect(a.peer.of('clean')).toHaveLength(0);
    a.send({ t: 'host', cmd: { op: 'clean' } });
    expect(a.peer.of('clean')).toEqual([{ t: 'clean', by: a.member.id }]);
    expect(b.peer.of('clean')).toEqual([{ t: 'clean', by: a.member.id }]);
  });
});

describe('room modes', () => {
  it('Serious mode relays quiet gestures only', async () => {
    const { manager } = setup();
    const a = await join(manager, 'MODES1', 'Ana');
    const b = await join(manager, 'MODES1', 'Budi');
    a.send({ t: 'host', cmd: { op: 'mode', mode: 'serious' } });
    b.send({ t: 'act', action: 'dance' });
    b.send({ t: 'act', action: 'nod' });
    expect(a.peer.of('act').map((m) => m.action)).toEqual(['nod']);
    a.send({ t: 'host', cmd: { op: 'mode', mode: 'party' } });
    b.send({ t: 'act', action: 'dance' });
    expect(a.peer.of('act').map((m) => m.action)).toEqual(['nod', 'dance']);
  });
});
