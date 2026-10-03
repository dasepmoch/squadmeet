import {
  clamp01,
  easeInOutCubic,
  lerpAngle,
  PLAYER,
  v3,
  type ResolvedSeat,
  type Vec3,
} from '@huddle/shared';
import { Character, PathFollow, PlayerIdentity, SeatOccupancy, Transform } from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';
import type { PhysicsWorld } from '../physics/physics-world.ts';
import type { SeatArbiter } from './seat-arbiter.ts';

const SIT_DURATION = 0.7;
const STAND_DURATION = 0.5;
const APPROACH_DISTANCE = 0.62;

export interface SeatTransition {
  from: Vec3;
  fromYaw: number;
  to: Vec3;
  toYaw: number;
  t: number;
}

export type SeatSystemEvent =
  | { type: 'sat'; seatId: string }
  | { type: 'stood'; seatId: string }
  | { type: 'denied'; seatId: string };

/**
 * Sit/stand state machine per player entity:
 * standing -> (claim) -> sittingDown -> seated -> standingUp -> standing.
 */
export class SeatSystem {
  private readonly seats: Map<string, ResolvedSeat>;
  private readonly arbiter: SeatArbiter;
  private readonly physics: PhysicsWorld;
  private readonly results: { seatId: string; playerId: string; granted: boolean }[] = [];
  private readonly pending = new Map<Entity, string>();
  private readonly transitions = new Map<Entity, SeatTransition>();
  private readonly down = v3.vec3(0, -1, 0);
  private readonly probe = v3.vec3();

  constructor(seats: readonly ResolvedSeat[], arbiter: SeatArbiter, physics: PhysicsWorld) {
    this.seats = new Map(seats.map((s) => [s.id, s]));
    this.arbiter = arbiter;
    this.physics = physics;
    arbiter.onResult = (seatId, playerId, granted) =>
      this.results.push({ seatId, playerId, granted });
  }

  seat(id: string): ResolvedSeat | undefined {
    return this.seats.get(id);
  }

  get all(): Iterable<ResolvedSeat> {
    return this.seats.values();
  }

  isFree(id: string, selfId: string): boolean {
    const who = this.arbiter.occupantOf(id);
    return who === null || who === selfId;
  }

  occupantOf(id: string): string | null {
    return this.arbiter.occupantOf(id);
  }

  /** Floor point in front of a seat where the avatar stands before sitting / after standing. */
  approachPoint(seat: ResolvedSeat, out: Vec3 = v3.vec3()): Vec3 {
    if (seat.approach) {
      out.x = seat.approach[0];
      out.z = seat.approach[2];
    } else {
      out.x = seat.position[0] + Math.sin(seat.yaw) * APPROACH_DISTANCE;
      out.z = seat.position[2] + Math.cos(seat.yaw) * APPROACH_DISTANCE;
    }
    this.probe.x = out.x;
    this.probe.y = seat.position[1] + 0.4;
    this.probe.z = out.z;
    const hit = this.physics.raycastStatic(this.probe, this.down, 3);
    out.y = Number.isFinite(hit) ? this.probe.y - hit : 0;
    return out;
  }

  /**
   * Claims a seat when within reach. Returns `far` when the caller should walk to
   * `approachPoint(seat)` first, `invalid` when sitting is not possible right now.
   */
  requestSit(world: World, e: Entity, seatId: string): 'claiming' | 'far' | 'invalid' {
    const seat = this.seats.get(seatId);
    const occ = world.get(e, SeatOccupancy);
    const t = world.get(e, Transform);
    const who = world.get(e, PlayerIdentity);
    if (!seat || !occ || !t || !who || occ.phase !== 'standing' || this.pending.has(e))
      return 'invalid';
    const approach = this.approachPoint(seat);
    const dist = Math.hypot(approach.x - t.position.x, approach.z - t.position.z);
    if (dist > PLAYER.interactRange || Math.abs(approach.y - t.position.y) > 0.45) return 'far';
    this.pending.set(e, seatId);
    this.arbiter.requestSeat(seatId, who.id);
    return 'claiming';
  }

  requestStand(world: World, e: Entity): void {
    const occ = world.get(e, SeatOccupancy);
    const t = world.get(e, Transform);
    const who = world.get(e, PlayerIdentity);
    if (!occ || !t || !who || occ.phase !== 'seated' || !occ.seatId) return;
    const seat = this.seats.get(occ.seatId);
    if (!seat) return;
    this.arbiter.releaseSeat(occ.seatId, who.id);
    this.beginStand(e, seat, occ, t);
  }

  /** Seats someone the server already placed (remote players): no arbiter round trip. */
  placeInSeat(world: World, e: Entity, seatId: string): void {
    const seat = this.seats.get(seatId);
    const occ = world.get(e, SeatOccupancy);
    if (!seat || !occ || occ.seatId === seatId) return;
    if (occ.phase !== 'standing') this.reset(world, e);
    this.pending.delete(e);
    this.beginSit(world, e, seat);
  }

  /** Stands up someone the server freed (remote players). */
  leaveSeat(world: World, e: Entity): void {
    const occ = world.get(e, SeatOccupancy);
    const t = world.get(e, Transform);
    const seat = occ?.seatId ? this.seats.get(occ.seatId) : undefined;
    if (!occ || !t || !seat || occ.phase === 'standingUp') return;
    this.beginStand(e, seat, occ, t);
  }

  private beginSit(world: World, e: Entity, seat: ResolvedSeat): void {
    const occ = world.get(e, SeatOccupancy);
    const t = world.get(e, Transform);
    const ch = world.get(e, Character);
    if (!occ || !t || !ch) return;
    world.remove(e, PathFollow);
    ch.body.setEnabled(false);
    v3.copy(occ.standPosition, t.position);
    occ.standYaw = t.yaw;
    occ.seatId = seat.id;
    occ.posture = seat.posture;
    occ.phase = 'sittingDown';
    this.transitions.set(e, {
      from: { ...t.position },
      fromYaw: t.yaw,
      to: v3.fromTuple(seat.position),
      toYaw: seat.yaw,
      t: 0,
    });
  }

  private beginStand(e: Entity, seat: ResolvedSeat, occ: SeatOccupancy, t: Transform): void {
    const to = this.approachPoint(seat);
    occ.phase = 'standingUp';
    this.transitions.set(e, { from: { ...t.position }, fromYaw: t.yaw, to, toYaw: seat.yaw, t: 0 });
  }

  /** Fixed-step update of one player. Returns lifecycle events for the simulation to publish. */
  step(world: World, e: Entity, dt: number, out: SeatSystemEvent[]): void {
    const occ = world.get(e, SeatOccupancy);
    const t = world.get(e, Transform);
    const ch = world.get(e, Character);
    const who = world.get(e, PlayerIdentity);
    if (!occ || !t || !ch || !who) return;

    const pendingSeat = this.pending.get(e);
    if (pendingSeat !== undefined) {
      const i = this.results.findIndex((r) => r.playerId === who.id && r.seatId === pendingSeat);
      const r = i >= 0 ? this.results.splice(i, 1)[0] : undefined;
      if (r) {
        this.pending.delete(e);
        const seat = this.seats.get(r.seatId);
        if (!r.granted || !seat || occ.phase !== 'standing') {
          out.push({ type: 'denied', seatId: r.seatId });
        } else {
          this.beginSit(world, e, seat);
        }
      }
    }

    const tr = this.transitions.get(e);
    if (!tr) return;
    const sitting = occ.phase === 'sittingDown';
    tr.t = clamp01(tr.t + dt / (sitting ? SIT_DURATION : STAND_DURATION));
    const k = easeInOutCubic(tr.t);
    v3.lerpVec(t.position, tr.from, tr.to, k);
    t.position.y += Math.sin(Math.PI * k) * (sitting ? 0.12 : 0.08);
    t.yaw = lerpAngle(tr.fromYaw, tr.toYaw, Math.min(1, k * 1.4));
    occ.blend = sitting ? k : 1 - k;
    if (tr.t < 1) return;

    this.transitions.delete(e);
    if (sitting) {
      occ.phase = 'seated';
      occ.blend = 1;
      out.push({ type: 'sat', seatId: occ.seatId ?? '' });
    } else {
      const seatId = occ.seatId ?? '';
      occ.phase = 'standing';
      occ.blend = 0;
      occ.seatId = null;
      occ.posture = null;
      ch.body.teleport(tr.to);
      ch.body.setEnabled(true);
      v3.copy(t.position, tr.to);
      out.push({ type: 'stood', seatId });
    }
  }

  /** Drops arbiter results nobody is waiting for (players that left meanwhile). */
  endStep(): void {
    if (this.results.length > 0 && this.pending.size === 0) this.results.length = 0;
  }

  /** Forces an immediate stand (e.g. teleport, kick, room change, despawn). */
  reset(world: World, e: Entity): void {
    const occ = world.get(e, SeatOccupancy);
    const ch = world.get(e, Character);
    const who = world.get(e, PlayerIdentity);
    if (occ?.seatId && who) this.arbiter.releaseSeat(occ.seatId, who.id);
    this.transitions.delete(e);
    this.pending.delete(e);
    if (occ) {
      occ.phase = 'standing';
      occ.blend = 0;
      occ.seatId = null;
      occ.posture = null;
    }
    ch?.body.setEnabled(true);
  }
}
