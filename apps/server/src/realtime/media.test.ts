import { loadRoom } from '@huddle/content';
import {
  createLogger,
  NET,
  parseServerMessage,
  type ResolvedRoom,
  type ServerMessage,
} from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Member, Peer } from './member.ts';
import { RoomManager } from './room-manager.ts';
import type { Room } from './room.ts';
import { iceServersFor, turnCredentials, type IceConfig } from './turn.ts';

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

function setup(meshCap = 8, ice?: IceConfig): { manager: RoomManager; clock: { t: number } } {
  const clock = { t: 1_700_000_000_000 };
  const manager = new RoomManager({
    map: 'boardroom',
    resolved,
    capacity: 12,
    maxRooms: 4,
    meshCap,
    ice: ice ?? { urls: [], turnSecret: null, ttlSeconds: 3600 },
    now: () => clock.t,
    log: createLogger(() => undefined, 'test', 'error'),
  });
  return { manager, clock };
}

type Joined = { peer: FakePeer; room: Room; member: Member };

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
  return { peer, room: r.room, member: r.member };
}

const offer = { description: { type: 'offer' as const, sdp: 'v=0\r\n' } };

describe('TURN credentials', () => {
  it('follow the coturn use-auth-secret scheme', () => {
    // Reference: printf '1700003600:alice' | openssl dgst -sha1 -hmac north-secret -binary | base64
    expect(turnCredentials('north-secret', 'alice', 3600, 1_700_000_000_000)).toEqual({
      username: '1700003600:alice',
      credential: 'Ji4axghh2/aljHmsPgH9mtDGVLw=',
    });
  });

  it('hand out STUN as is and TURN only with a secret', () => {
    const urls = [
      'stun:stun.example.com:3478',
      'turn:turn.example.com:3478',
      'turns:turn.example.com:5349',
    ];
    expect(iceServersFor({ urls, turnSecret: null, ttlSeconds: 60 }, 'p1', 0)).toEqual([
      { urls: ['stun:stun.example.com:3478'] },
    ]);
    const withTurn = iceServersFor({ urls, turnSecret: 's3cret', ttlSeconds: 60 }, 'p1', 0);
    expect(withTurn[1]).toMatchObject({ urls: urls.slice(1), username: '60:p1' });
  });
});

describe('media signaling and presenting', () => {
  it('relays signals between media peers only', async () => {
    const { manager, clock } = setup(2);
    const a = await join(manager, 'MEDIA1', 'Ana');
    clock.t += 10;
    const b = await join(manager, 'MEDIA1', 'Budi');
    clock.t += 10;
    const c = await join(manager, 'MEDIA1', 'Cici');
    a.room.handle(a.member, { t: 'signal', to: b.member.id, data: offer });
    expect(b.peer.of('signal')).toEqual([{ t: 'signal', from: a.member.id, data: offer }]);
    // Cici is beyond the mesh cap of 2: no media with her (either way), none with oneself.
    a.room.handle(a.member, { t: 'signal', to: c.member.id, data: offer });
    c.room.handle(c.member, { t: 'signal', to: a.member.id, data: offer });
    a.room.handle(a.member, { t: 'signal', to: a.member.id, data: offer });
    expect(c.peer.of('signal')).toHaveLength(0);
    expect(a.peer.of('signal')).toHaveLength(0);
    // When Budi leaves, Cici moves up into the mesh.
    b.room.disconnect(b.member, b.peer, true);
    a.room.handle(a.member, { t: 'signal', to: c.member.id, data: offer });
    expect(c.peer.of('signal')).toHaveLength(1);
  });

  it('shares mute state and hands TURN credentials to each person', async () => {
    const { manager } = setup(8, {
      urls: ['turn:turn.example.com:3478'],
      turnSecret: 's3cret',
      ttlSeconds: 600,
    });
    const a = await join(manager, 'VOICE1', 'Ana');
    const b = await join(manager, 'VOICE1', 'Budi');
    const ice = a.peer.of('welcome')[0]?.ice[0];
    expect(ice?.username).toMatch(new RegExp(`:${a.member.id}$`));
    expect(b.peer.of('welcome')[0]?.players.every((p) => p.muted)).toBe(true);
    a.room.handle(a.member, { t: 'voice', muted: false, deafened: false });
    expect(b.peer.of('voice')).toEqual([
      { t: 'voice', id: a.member.id, muted: false, deafened: false },
    ]);
    expect(a.peer.of('voice')).toHaveLength(0);
  });

  it('refreshes TURN credentials at half their lifetime', async () => {
    const { manager, clock } = setup(8, {
      urls: ['turn:turn.example.com:3478'],
      turnSecret: 's3cret',
      ttlSeconds: 600,
    });
    const a = await join(manager, 'VOICE2', 'Ana');
    clock.t += 200_000;
    manager.tick();
    expect(a.peer.of('ice')).toHaveLength(0);
    clock.t += 200_000;
    manager.tick();
    expect(a.peer.of('ice')).toHaveLength(1);
  });

  it('keeps one presenter: free slot, handoff request, host takeover, leaving frees it', async () => {
    const { manager } = setup();
    const host = await join(manager, 'SHARE1', 'Ana');
    const b = await join(manager, 'SHARE1', 'Budi');
    const c = await join(manager, 'SHARE1', 'Cici');
    const presenter = (j: Joined) => j.peer.of('room').at(-1)?.room.presenter;
    b.room.handle(b.member, { t: 'present', on: true });
    expect(presenter(c)).toBe(b.member.id);
    // Cici asks while Budi presents: she hears "busy", Budi gets a handoff request.
    c.room.handle(c.member, { t: 'present', on: true });
    expect(c.peer.of('error').at(-1)?.code).toBe('busy');
    expect(b.peer.of('presentRequest')).toEqual([{ t: 'presentRequest', from: c.member.id }]);
    expect(presenter(c)).toBe(b.member.id);
    // Only the presenter can stop their own share; the host can take over.
    c.room.handle(c.member, { t: 'present', on: false });
    expect(presenter(c)).toBe(b.member.id);
    host.room.handle(host.member, { t: 'present', on: true });
    expect(presenter(b)).toBe(host.member.id);
    host.room.handle(host.member, { t: 'host', cmd: { op: 'stopShare' } });
    expect(presenter(b)).toBeNull();
    // A presenter who leaves frees the screen.
    c.room.handle(c.member, { t: 'present', on: true });
    expect(presenter(b)).toBe(c.member.id);
    c.room.disconnect(c.member, c.peer, true);
    expect(presenter(b)).toBeNull();
  });

  it('lets the host set the voice mode and ask everyone to mute', async () => {
    const { manager } = setup();
    const host = await join(manager, 'HOSTV1', 'Ana');
    const b = await join(manager, 'HOSTV1', 'Budi');
    expect(b.peer.of('welcome')[0]?.room.voice).toBe('zones');
    host.room.handle(host.member, { t: 'host', cmd: { op: 'voiceMode', mode: 'proximity' } });
    expect(b.peer.of('room').at(-1)?.room.voice).toBe('proximity');
    host.room.handle(host.member, { t: 'host', cmd: { op: 'muteAll' } });
    expect(b.peer.of('muteRequest')).toEqual([{ t: 'muteRequest', by: host.member.id }]);
    expect(host.peer.of('muteRequest')).toHaveLength(0);
    b.room.handle(b.member, { t: 'host', cmd: { op: 'muteAll' } });
    expect(b.peer.of('error').at(-1)?.code).toBe('forbidden');
  });
});
