import { v3, type HeldItem, type ThrowKind, type Vec3 } from '@huddle/shared';
import { Character, Motion, Remote, SeatOccupancy, Transform } from './components.ts';
import type { Entity, World } from './ecs/world.ts';
import type { EventBus } from './events.ts';
import { PERSON_SHAPE } from './interaction/picking.ts';
import type { ItemSystem } from './items/held-items.ts';
import { isSeatedPose } from './players.ts';
import type { ThrowSystem } from './projectiles/throw-system.ts';
import type { PlayerRoster } from './roster.ts';
import type { SeatSystem } from './seats/seat-system.ts';
import type { SimEvents } from './sim-events.ts';
import { HIT_REACTION, type SocialSystem } from './social.ts';

/** Where the network says a remote player is (already interpolated for this frame). */
export interface RemotePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  grounded: boolean;
}

export interface RemoteDeps {
  world: World;
  roster: PlayerRoster;
  seats: SeatSystem;
  social: SocialSystem;
  throws: ThrowSystem;
  items: ItemSystem;
  events: EventBus<SimEvents>;
}

/**
 * People on other clients. The host feeds their interpolated poses, seats, emotes, hands and
 * throws; they share every other system with local players (avatars, picking, projectile hits
 * on their capsules, the hand queue).
 */
export class RemotePlayers {
  private readonly d: RemoteDeps;

  constructor(deps: RemoteDeps) {
    this.d = deps;
  }

  spawn(id: string, name: string, position: Vec3, yaw: number): Entity {
    const e = this.d.roster.spawn({ id, name, isLocal: false, isBot: false, position, yaw });
    this.d.world.add(e, Remote, { target: { ...position }, yaw, speed: 0, grounded: true });
    const ch = this.d.world.get(e, Character);
    if (ch) ch.body.blocksWalkers = false;
    return e;
  }

  has(id: string): boolean {
    const e = this.d.roster.entityOf(id);
    return e !== undefined && this.d.world.has(e, Remote);
  }

  /** Ids of every remote player. */
  ids(): string[] {
    const out: string[] = [];
    for (const e of this.d.world.query(Remote)) out.push(this.d.roster.idOf(e));
    return out;
  }

  remove(id: string): void {
    const e = this.d.roster.entityOf(id);
    if (e !== undefined && this.d.world.has(e, Remote)) this.d.roster.remove(e);
  }

  setPose(id: string, pose: RemotePose): void {
    const r = this.remote(id);
    if (!r) return;
    v3.set(r.target, pose.x, pose.y, pose.z);
    r.yaw = pose.yaw;
    r.speed = pose.speed;
    r.grounded = pose.grounded;
  }

  /** The server seated (or, with null, stood up) this person. */
  setSeat(id: string, seatId: string | null): void {
    const e = this.entity(id);
    if (e === undefined) return;
    if (seatId) this.d.seats.placeInSeat(this.d.world, e, seatId);
    else this.d.seats.leaveSeat(this.d.world, e);
  }

  act(id: string, actionId: string): void {
    const e = this.entity(id);
    if (e !== undefined) this.d.social.act(e, actionId);
  }

  /** `time` is simulation time (convert the server's timestamp first): it orders the queue. */
  hand(id: string, raised: boolean, time: number): void {
    const e = this.entity(id);
    if (e !== undefined) this.d.social.setHand(e, raised, time);
  }

  /** Someone else's throw: the object flies here too, but only its thrower decides hits. */
  throwFrom(id: string, kind: ThrowKind, from: Vec3, to: Vec3, tilt = 0, seq = 0): void {
    if (this.entity(id) === undefined) return;
    this.d.events.emit('thrown', this.d.throws.launchCosmetic(kind, id, from, to, tilt, seq));
  }

  hold(id: string, item: HeldItem | null): void {
    const e = this.entity(id);
    if (e !== undefined) this.d.items.hold(e, item);
  }

  /** `id` picked up `owner`'s landed plane number `seq`. */
  pickup(id: string, owner: string, seq: number): void {
    const e = this.entity(id);
    if (e !== undefined) this.d.items.pickedUpElsewhere(e, owner, seq);
  }

  setShield(id: string, on: boolean): void {
    const e = this.entity(id);
    if (e !== undefined) this.d.social.setShield(e, on);
  }

  /** A hit decided by the thrower's client: the target flinches and everyone hears about it. */
  hit(throwerId: string, kind: ThrowKind, targetId: string): void {
    const world = this.d.world;
    const target = this.d.roster.entityOf(targetId);
    const t = target === undefined ? undefined : world.get(target, Transform);
    if (target === undefined || !t) return;
    const seated = isSeatedPose(world.get(target, SeatOccupancy));
    const chest = seated ? PERSON_SHAPE.seated.aim : PERSON_SHAPE.standing.aim;
    const point = { x: t.position.x, y: t.position.y + chest, z: t.position.z };
    this.d.social.act(target, HIT_REACTION[kind], true);
    // Hits are reported by throw number only to the server; here it is just a reaction.
    this.d.events.emit('projectile', { type: 'hit', kind, throwerId, targetId, point, seq: -1 });
  }

  private entity(id: string): Entity | undefined {
    return this.d.roster.entityOf(id);
  }

  private remote(id: string): Remote | undefined {
    const e = this.d.roster.entityOf(id);
    return e === undefined ? undefined : this.d.world.get(e, Remote);
  }
}

/**
 * Fixed step of a remote player: follow the network pose (the capsule too, so throws can hit
 * them), unless a seat transition is animating them.
 */
export function stepRemote(world: World, e: Entity, dt: number): null {
  const r = world.get(e, Remote);
  const t = world.get(e, Transform);
  const m = world.get(e, Motion);
  const ch = world.get(e, Character);
  if (!r || !t || !m || !ch) return null;
  v3.copy(t.prevPosition, t.position);
  t.prevYaw = t.yaw;
  const occ = world.get(e, SeatOccupancy);
  if (occ && occ.phase !== 'standing') {
    m.speed = 0;
    return null;
  }
  m.velocity.x = (r.target.x - t.position.x) / dt;
  m.velocity.y = (r.target.y - t.position.y) / dt;
  m.velocity.z = (r.target.z - t.position.z) / dt;
  v3.copy(t.position, r.target);
  t.yaw = r.yaw;
  m.speed = r.speed;
  m.grounded = r.grounded;
  ch.body.teleport(t.position);
  // Remote players never finish a local path.
  return null;
}
