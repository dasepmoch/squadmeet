import {
  decodeMove,
  encodeMessage,
  encodeSnapshot,
  mediaPeers,
  NET,
  type ChatLine,
  type ClientMessage,
  type Logger,
  type IceServer,
  type ResolvedRoom,
  type RoomInfo,
  type RoomMode,
  type ServerMessage,
  type SnapshotEntry,
  type VoiceMode,
  type WirePose,
} from '@huddle/shared';
import { timingSafeEqual } from 'node:crypto';
import { applyMove, createMember, memberInfo, type Member, type Peer } from './member.ts';
import { handleMessage } from './room-handlers.ts';

export interface RoomDeps {
  code: string;
  map: string;
  resolved: ResolvedRoom;
  capacity: number;
  passcodeHash: string | null;
  /** People exchanging media in the mesh (see `mediaPeers`). */
  meshCap: number;
  /** ICE servers (with fresh TURN credentials) for one person. */
  ice: (memberId: string, now: number) => IceServer[];
  /** TURN credential lifetime; refreshed at half-life. 0 = nothing to refresh. */
  iceTtlMs: number;
  now: () => number;
  newId: () => string;
  newToken: () => string;
  log: Logger;
}

/** Above this many queued bytes a peer skips snapshots until it catches up. */
const BACKPRESSURE_BYTES = 256 * 1024;
/** Every n-th snapshot carries everyone, not just people who moved (late joiners, losses). */
const KEYFRAME_EVERY = 20;

/**
 * One live room: members (connected or inside the resume window), server-arbitrated seats, the
 * hand queue, chat history and room settings. Transport-agnostic: talks to `Peer`s.
 */
export class Room {
  readonly code: string;
  readonly map: string;
  readonly capacity: number;
  readonly resolved: ResolvedRoom;
  readonly passcodeHash: string | null;
  readonly members = new Map<string, Member>();
  /** Seat id → member id. */
  readonly seats = new Map<string, string>();
  readonly chat: ChatLine[] = [];
  mode: RoomMode = 'casual';
  throwsLocked = false;
  hostId: string | null = null;
  voice: VoiceMode = 'zones';
  /** Who holds the big screen. */
  presenterId: string | null = null;
  chatSeq = 0;
  readonly d: RoomDeps;
  private readonly usedSlots = new Set<number>();
  private nextSlot = 1;
  private ticks = 0;
  private readonly entries: SnapshotEntry[] = [];
  private readonly incoming: WirePose = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 };

  constructor(d: RoomDeps) {
    this.d = d;
    this.code = d.code;
    this.map = d.map;
    this.capacity = d.capacity;
    this.resolved = d.resolved;
    this.passcodeHash = d.passcodeHash;
  }

  get now(): number {
    return this.d.now();
  }

  /** Members with an open connection. */
  get connected(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.peer) n++;
    return n;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      map: this.map,
      mode: this.mode,
      throwsLocked: this.throwsLocked,
      host: this.hostId,
      capacity: this.capacity,
      locked: this.passcodeHash !== null,
      voice: this.voice,
      presenter: this.presenterId,
      meshCap: this.d.meshCap,
    };
  }

  /** Tells everyone about a settings change (mode, host, presenter, voice). */
  announce(): void {
    this.broadcast({ t: 'room', room: this.info() });
  }

  /** Adds a new member (the hello was validated by the manager). */
  admit(peer: Peer, name: string, avatar: string): Member | 'full' {
    if (this.members.size >= this.capacity) return 'full';
    const spawn = this.resolved.data.spawns[0];
    const [x, y, z] = spawn?.position ?? [0, 0, 0];
    const m = createMember({
      id: this.d.newId(),
      slot: this.allocateSlot(),
      token: this.d.newToken(),
      name,
      avatar,
      pose: { x, y, z, yaw: spawn?.yaw ?? 0, speed: 0, flags: 1 },
      peer,
      now: this.now,
    });
    this.members.set(m.id, m);
    this.hostId ??= m.id;
    this.welcome(m, false);
    this.broadcast({ t: 'joined', player: memberInfo(m) }, m);
    this.d.log.info('joined', { room: this.code, id: m.id, size: this.members.size });
    return m;
  }

  /** Re-attaches a dropped session inside the grace window (same id, seat and hand). */
  resume(peer: Peer, id: string, token: string): Member | null {
    const m = this.members.get(id);
    if (!m || !sameSecret(m.token, token)) return null;
    if (m.peer && m.peer !== peer) m.peer.close(4001, 'replaced');
    m.peer = peer;
    m.awaySince = null;
    m.lastMoveAt = this.now;
    this.welcome(m, true);
    this.broadcast({ t: 'away', id: m.id, away: false }, m);
    this.d.log.info('resumed', { room: this.code, id: m.id });
    return m;
  }

  /** The socket closed. A goodbye removes the member now; a drop keeps them for the grace window. */
  disconnect(m: Member, peer: Peer, leaving: boolean): void {
    if (m.peer !== peer || this.members.get(m.id) !== m) return;
    m.peer = null;
    if (leaving) {
      this.remove(m, 'leave');
      return;
    }
    m.awaySince = this.now;
    this.broadcast({ t: 'away', id: m.id, away: true });
  }

  remove(m: Member, reason: 'leave' | 'timeout' | 'kick'): void {
    if (!this.members.delete(m.id)) return;
    m.peer = null;
    this.usedSlots.delete(m.slot);
    if (m.seat) this.setSeat(m.seat, null);
    let changed = false;
    if (this.presenterId === m.id) {
      this.presenterId = null;
      changed = true;
    }
    if (this.hostId === m.id) {
      this.hostId = this.pickHost();
      changed = true;
    }
    this.broadcast({ t: 'left', id: m.id, reason });
    if (changed) this.announce();
    this.d.log.info('left', { room: this.code, id: m.id, reason, size: this.members.size });
  }

  /** Ids of the people who exchange voice and screen in the mesh. */
  mediaPeerIds(): Set<string> {
    const people = [...this.members.values()].map((m) => ({ id: m.id, since: m.joinedAt }));
    return mediaPeers(people, this.d.meshCap);
  }

  handle(m: Member, msg: ClientMessage): void {
    handleMessage(this, m, msg);
  }

  /** A binary `MOVE` frame from `m`. */
  handleMove(m: Member, data: Uint8Array): void {
    if (decodeMove(data, this.incoming) === null) return;
    if (!m.limits.move.take(this.now)) return;
    if (m.seat) {
      // Seated people stay where the seat is; only the facing may change.
      m.pose.yaw = this.incoming.yaw;
      return;
    }
    if (!applyMove(m, this.incoming, this.resolved.bounds, this.now) && m.violations % 50 === 1) {
      this.d.log.warn('move clamped', { room: this.code, id: m.id, count: m.violations });
    }
  }

  /** Assigns (or frees, with null) a seat and tells everyone. */
  setSeat(seatId: string, memberId: string | null): void {
    const prev = this.seats.get(seatId);
    if (prev !== undefined) {
      const owner = this.members.get(prev);
      if (owner && owner.seat === seatId) owner.seat = null;
      this.seats.delete(seatId);
    }
    if (memberId !== null) {
      const m = this.members.get(memberId);
      if (!m) return;
      if (m.seat && m.seat !== seatId) this.setSeat(m.seat, null);
      m.seat = seatId;
      this.seats.set(seatId, memberId);
      const seat = this.resolved.seats.find((s) => s.id === seatId);
      if (seat) {
        m.pose.x = seat.position[0];
        m.pose.y = seat.position[1];
        m.pose.z = seat.position[2];
        m.pose.yaw = seat.yaw;
        m.pose.speed = 0;
        m.dirty = true;
      }
    }
    this.broadcast({ t: 'seat', seat: seatId, id: memberId });
  }

  /** Fixed-rate work: position snapshots, expiring dropped sessions, refreshing TURN credentials. */
  tick(): void {
    const now = this.now;
    for (const m of [...this.members.values()]) {
      if (m.awaySince !== null && now - m.awaySince > NET.resumeGraceMs) this.remove(m, 'timeout');
      else if (m.peer && this.d.iceTtlMs > 0 && now - m.iceAt > this.d.iceTtlMs / 2) {
        m.iceAt = now;
        this.send(m, { t: 'ice', servers: this.d.ice(m.id, now) });
      }
    }
    const keyframe = this.ticks++ % KEYFRAME_EVERY === 0;
    const entries = this.entries;
    entries.length = 0;
    for (const m of this.members.values()) {
      if (!keyframe && !m.dirty) continue;
      m.dirty = false;
      entries.push({ slot: m.slot, ...m.pose });
    }
    if (entries.length === 0) return;
    const frame = encodeSnapshot(now, entries);
    for (const m of this.members.values()) {
      if (m.peer && m.peer.buffered < BACKPRESSURE_BYTES) m.peer.sendBinary(frame);
    }
  }

  send(m: Member, msg: ServerMessage): void {
    m.peer?.sendText(encodeMessage(msg));
  }

  broadcast(msg: ServerMessage, except?: Member): void {
    const text = encodeMessage(msg);
    for (const m of this.members.values()) if (m !== except) m.peer?.sendText(text);
  }

  private welcome(m: Member, resumed: boolean): void {
    const now = this.now;
    m.iceAt = now;
    this.send(m, {
      t: 'welcome',
      v: NET.protocolVersion,
      self: m.id,
      slot: m.slot,
      token: m.token,
      resumed,
      room: this.info(),
      players: [...this.members.values()].map(memberInfo),
      chat: this.chat,
      now,
      ice: this.d.ice(m.id, now),
    });
  }

  /** The longest-present connected member becomes host (else anyone, else nobody). */
  private pickHost(): string | null {
    let best: Member | null = null;
    for (const m of this.members.values()) {
      if (!best) best = m;
      else if ((m.peer !== null) !== (best.peer !== null)) {
        if (m.peer !== null) best = m;
      } else if (m.joinedAt < best.joinedAt) best = m;
    }
    return best?.id ?? null;
  }

  private allocateSlot(): number {
    while (this.usedSlots.has(this.nextSlot) || this.nextSlot === 0) {
      this.nextSlot = (this.nextSlot + 1) % 65536;
    }
    const slot = this.nextSlot;
    this.usedSlots.add(slot);
    this.nextSlot = (this.nextSlot + 1) % 65536;
    return slot;
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
