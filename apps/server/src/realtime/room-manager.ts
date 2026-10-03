import {
  cleanName,
  generateRoomCode,
  NET,
  type ClientMessage,
  type ErrorCode,
  type Logger,
  type ResolvedRoom,
} from '@huddle/shared';
import { randomBytes, randomInt } from 'node:crypto';
import type { Member, Peer } from './member.ts';
import { hashPasscode, verifyPasscode } from './passcode.ts';
import { Room } from './room.ts';
import { iceServersFor, type IceConfig } from './turn.ts';

export interface ManagerDeps {
  /** Map every room uses (one map for now). */
  map: string;
  resolved: ResolvedRoom;
  capacity: number;
  /** Memory guard: new rooms are refused beyond this. */
  maxRooms: number;
  /** People exchanging media per room (WebRTC mesh). */
  meshCap: number;
  ice: IceConfig;
  now: () => number;
  log: Logger;
}

export type JoinResult =
  { ok: true; room: Room; member: Member } | { ok: false; error: ErrorCode; message: string };

type Hello = Extract<ClientMessage, { t: 'hello' }>;

/** Rooms by code: join (creating on first use), resume, ticking and cleanup. */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly d: ManagerDeps;

  constructor(deps: ManagerDeps) {
    this.d = deps;
  }

  async join(peer: Peer, hello: Hello): Promise<JoinResult> {
    if (hello.v !== NET.protocolVersion) {
      return { ok: false, error: 'version', message: 'Please reload: the app was updated.' };
    }
    const code = hello.room ?? this.freshCode();
    let room = this.rooms.get(code);
    if (room && hello.resume) {
      const m = room.resume(peer, hello.resume.id, hello.resume.token);
      if (m) return { ok: true, room, member: m };
    }
    if (!room) {
      if (this.rooms.size >= this.d.maxRooms) {
        return { ok: false, error: 'full', message: 'The server is full right now.' };
      }
      const hash = hello.passcode ? await hashPasscode(hello.passcode) : null;
      // Another hello may have created the room while hashing.
      room = this.rooms.get(code) ?? this.create(code, hash);
    } else if (room.passcodeHash !== null) {
      const ok =
        hello.passcode !== undefined && (await verifyPasscode(hello.passcode, room.passcodeHash));
      if (!ok) return { ok: false, error: 'passcode', message: 'Wrong passcode.' };
    }
    const member = room.admit(peer, cleanName(hello.name, 'Guest'), hello.avatar);
    if (member === 'full') return { ok: false, error: 'full', message: 'This room is full.' };
    return { ok: true, room, member };
  }

  /** Snapshots for every room; rooms nobody is in (or coming back to) are dropped. */
  tick(): void {
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.members.size === 0) {
        this.rooms.delete(code);
        this.d.log.info('room closed', { room: code });
      }
    }
  }

  get stats(): { rooms: number; members: number; connected: number } {
    let members = 0;
    let connected = 0;
    for (const r of this.rooms.values()) {
      members += r.members.size;
      connected += r.connected;
    }
    return { rooms: this.rooms.size, members, connected };
  }

  private create(code: string, passcodeHash: string | null): Room {
    const room = new Room({
      code,
      map: this.d.map,
      resolved: this.d.resolved,
      capacity: this.d.capacity,
      passcodeHash,
      meshCap: this.d.meshCap,
      ice: (id, now) => iceServersFor(this.d.ice, id, now),
      iceTtlMs: this.d.ice.turnSecret ? this.d.ice.ttlSeconds * 1000 : 0,
      now: this.d.now,
      newId: () => `p${randomBytes(6).toString('base64url')}`,
      newToken: () => randomBytes(24).toString('base64url'),
      log: this.d.log,
    });
    this.rooms.set(code, room);
    this.d.log.info('room opened', { room: code, locked: passcodeHash !== null });
    return room;
  }

  private freshCode(): string {
    for (;;) {
      const code = generateRoomCode(() => randomInt(0, 1 << 30) / (1 << 30));
      if (!this.rooms.has(code)) return code;
    }
  }
}
