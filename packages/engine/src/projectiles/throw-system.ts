import { v3, type Vec3 } from '@huddle/shared';
import {
  Character,
  Expression,
  Motion,
  PlayerIdentity,
  SeatOccupancy,
  Transform,
} from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';
import { PERSON_SHAPE } from '../interaction/picking.ts';
import type { PhysicsWorld } from '../physics/physics-world.ts';
import { isSeatedPose } from '../players.ts';
import { OPEN_SKY, type ThrowRoom } from './launch.ts';
import { ProjectileSystem, type HitTarget, type ProjectileEvent } from './projectile-system.ts';
import { THROWABLES, type ThrowKind } from './throwables.ts';

/** Seconds from a throw request to the release, in sync with the avatar's throwing swing. */
export const THROW_RELEASE_DELAY = 0.26;
/** Things one person may have in the air at once. */
export const MAX_FLYING = 4;
const HAND_FORWARD = 0.42;
const HAND_SIDE = 0.12;
const RELEASE_HEIGHT = { standing: 1.42, seated: 0.66 } as const;

/** A throw that just left someone's hand (what a network layer would broadcast). */
export interface ThrowLaunch {
  kind: ThrowKind;
  throwerId: string;
  targetId: string | null;
  from: Vec3;
  to: Vec3;
  projectileId: number;
  /** The thrower's throw number (wraps at 65536). */
  seq: number;
  /** Paper-plane release tilt, -1..1 (0 for everything else). */
  tilt: number;
}

/** Why a throw request was refused (for the HUD). */
export type ThrowRefusal = 'pose' | 'cooldown' | 'busy' | 'flying' | 'shield';

interface PendingThrow {
  e: Entity;
  kind: ThrowKind;
  to: Vec3;
  targetId: string | null;
  at: number;
  tilt: number;
}

/**
 * Release point of a throw toward `to` by someone at `at` (feet, or seat surface when seated):
 * the right hand, far enough forward to clear the thrower's own capsule.
 */
export function throwOrigin(at: Vec3, seated: boolean, to: Vec3, out: Vec3): Vec3 {
  let fx = to.x - at.x;
  let fz = to.z - at.z;
  const d = Math.hypot(fx, fz);
  if (d < 1e-4) {
    fx = 0;
    fz = 1;
  } else {
    fx /= d;
    fz /= d;
  }
  // Right of facing (fx, fz) is (-fz, fx) with yaw 0 facing +Z.
  out.x = at.x + fx * HAND_FORWARD - fz * HAND_SIDE;
  out.y = at.y + (seated ? RELEASE_HEIGHT.seated : RELEASE_HEIGHT.standing);
  out.z = at.z + fz * HAND_FORWARD + fx * HAND_SIDE;
  return out;
}

/** Where to aim at a person: chest when standing, shoulders when seated (see PERSON_SHAPE). */
export function aimPoint(at: Vec3, seated: boolean, out: Vec3): Vec3 {
  out.x = at.x;
  out.y = at.y + (seated ? PERSON_SHAPE.seated.aim : PERSON_SHAPE.standing.aim);
  out.z = at.z;
  return out;
}

/**
 * Throw intents to projectiles: cooldowns and caps (safety valves), a release timed to the
 * throwing swing, aim points on people (who may have moved meanwhile), throw numbers, and a
 * release point that never starts inside a wall. Protected people neither throw nor get aimed at.
 */
export class ThrowSystem {
  readonly projectiles: ProjectileSystem;
  /** Why the last `request` was refused, or null. */
  refusal: ThrowRefusal | null = null;
  private readonly world: World;
  private readonly physics: PhysicsWorld;
  private readonly entityOf: (playerId: string) => Entity | undefined;
  private readonly cooldowns = new Map<string, number>();
  private readonly seqs = new Map<string, number>();
  private readonly pending: PendingThrow[] = [];
  private readonly targets: HitTarget[] = [];
  private readonly from = v3.vec3();
  private readonly to = v3.vec3();
  private readonly chest = v3.vec3();
  private readonly dir = v3.vec3();

  constructor(
    world: World,
    physics: PhysicsWorld,
    entityOf: (playerId: string) => Entity | undefined,
    room: ThrowRoom = OPEN_SKY,
  ) {
    this.world = world;
    this.physics = physics;
    this.entityOf = entityOf;
    this.projectiles = new ProjectileSystem(physics, room);
  }

  /** Seconds until `playerId` may throw again. */
  cooldownLeft(playerId: string, time: number): number {
    return Math.max(0, (this.cooldowns.get(playerId) ?? 0) - time);
  }

  /**
   * Queues a throw by `e` at `to` (at the chest of `targetId` when given). Checks pose, the
   * "Don't hit me" protection, cooldown and the in-flight cap, and turns a standing thrower
   * toward the target. Returns false when refused (`refusal` says why).
   */
  request(
    e: Entity,
    kind: ThrowKind,
    to: Vec3,
    targetId: string | null,
    time: number,
    tilt = 0,
  ): boolean {
    this.refusal = this.refuse(e, time);
    if (this.refusal) return false;
    const who = this.world.req(e, PlayerIdentity);
    const t = this.world.req(e, Transform);
    this.cooldowns.set(
      who.id,
      time + Math.max(THROWABLES[kind].cooldown, THROW_RELEASE_DELAY + 0.05),
    );
    // A protected target is no target: the throw goes to the point and passes through them.
    const te = targetId === null ? undefined : this.entityOf(targetId);
    const target = te !== undefined && this.world.get(te, Expression)?.shield ? null : targetId;
    const aim = this.resolveTarget(to, target, this.to);
    if (this.world.get(e, SeatOccupancy)?.phase === 'standing') {
      const dx = aim.x - t.position.x;
      const dz = aim.z - t.position.z;
      if (Math.hypot(dx, dz) > 0.05) t.yaw = Math.atan2(dx, dz);
    }
    this.pending.push({
      e,
      kind,
      to: { ...aim },
      targetId: target,
      at: time + THROW_RELEASE_DELAY,
      tilt: kind === 'plane' ? tilt : 0,
    });
    return true;
  }

  /** Launches throws whose swing reached the release point. Call before the physics step. */
  release(time: number, out: ThrowLaunch[]): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i] as PendingThrow;
      if (time < p.at) continue;
      this.pending.splice(i, 1);
      const who = this.world.get(p.e, PlayerIdentity);
      const t = this.world.get(p.e, Transform);
      if (!who || !t) continue;
      const to = this.resolveTarget(p.to, p.targetId, this.to);
      const from = this.releasePoint(
        t.position,
        isSeatedPose(this.world.get(p.e, SeatOccupancy)),
        to,
      );
      if (p.targetId !== null) this.lead(p.targetId, p.kind, from, to);
      const seq = ((this.seqs.get(who.id) ?? 0) + 1) % 65536;
      this.seqs.set(who.id, seq);
      const view = this.projectiles.launch(p.kind, who.id, from, to, { tilt: p.tilt, seq });
      out.push({
        kind: p.kind,
        throwerId: who.id,
        targetId: p.targetId,
        from: { ...from },
        to: { ...to },
        projectileId: view.id,
        seq,
        tilt: p.tilt,
      });
    }
  }

  /** Replays someone else's throw (from the network): it flies and lands, but reports no hits. */
  launchCosmetic(
    kind: ThrowKind,
    throwerId: string,
    from: Vec3,
    to: Vec3,
    tilt = 0,
    seq = 0,
  ): ThrowLaunch {
    const view = this.projectiles.launch(kind, throwerId, from, to, { cosmetic: true, tilt, seq });
    return {
      kind,
      throwerId,
      targetId: null,
      from: { ...from },
      to: { ...to },
      projectileId: view.id,
      seq,
      tilt,
    };
  }

  /** Paper planes fly their glider model. Call right before the physics step. */
  steer(dt: number): void {
    this.projectiles.steer(dt);
  }

  /** Turns contacts into events and updates projectile views. Call after the physics step. */
  collide(dt: number, out: ProjectileEvent[]): void {
    let n = 0;
    for (const e of this.world.query(PlayerIdentity, Transform, SeatOccupancy, Character)) {
      const target = (this.targets[n] ??= {
        id: '',
        position: v3.vec3(),
        seated: false,
        solid: true,
        shield: false,
      });
      const occ = this.world.req(e, SeatOccupancy);
      target.id = this.world.req(e, PlayerIdentity).id;
      v3.copy(target.position, this.world.req(e, Transform).position);
      target.seated = occ.phase === 'seated' || occ.phase === 'sittingDown';
      target.solid = this.world.req(e, Character).body.isEnabled();
      target.shield = this.world.get(e, Expression)?.shield ?? false;
      n++;
    }
    this.targets.length = n;
    this.projectiles.step(dt, out, this.targets);
  }

  /** Drops queued throws of a player who left. */
  cancel(e: Entity): void {
    for (let i = this.pending.length - 1; i >= 0; i--)
      if (this.pending[i]?.e === e) this.pending.splice(i, 1);
  }

  clear(): void {
    this.pending.length = 0;
    this.projectiles.clear();
  }

  private refuse(e: Entity, time: number): ThrowRefusal | null {
    const who = this.world.get(e, PlayerIdentity);
    const occ = this.world.get(e, SeatOccupancy);
    if (!who || !this.world.has(e, Transform) || !occ) return 'pose';
    if (occ.phase === 'sittingDown' || occ.phase === 'standingUp') return 'pose';
    if (this.world.get(e, Expression)?.shield) return 'shield';
    if (time < (this.cooldowns.get(who.id) ?? 0)) return 'cooldown';
    if (this.pending.some((p) => p.e === e)) return 'busy';
    if (this.projectiles.flying(who.id) >= MAX_FLYING) return 'flying';
    return null;
  }

  /** The target's current chest when aiming at a person, else the given point. */
  private resolveTarget(to: Vec3, targetId: string | null, out: Vec3): Vec3 {
    const te = targetId === null ? undefined : this.entityOf(targetId);
    const tt = te === undefined ? undefined : this.world.get(te, Transform);
    if (te !== undefined && tt)
      return aimPoint(tt.position, isSeatedPose(this.world.get(te, SeatOccupancy)), out);
    return v3.copy(out, to);
  }

  /** Aims where a walking target will be when the throw arrives, not where they are now. */
  private lead(targetId: string, kind: ThrowKind, from: Vec3, to: Vec3): void {
    const te = this.entityOf(targetId);
    const m = te === undefined ? undefined : this.world.get(te, Motion);
    if (!m) return;
    const flight = THROWABLES[kind].flightTime(Math.hypot(to.x - from.x, to.z - from.z));
    to.x += m.velocity.x * flight;
    to.z += m.velocity.z * flight;
  }

  /** Hand position, pulled back when the thrower stands right at a wall. */
  private releasePoint(at: Vec3, seated: boolean, to: Vec3): Vec3 {
    const from = throwOrigin(at, seated, to, this.from);
    const chest = v3.set(this.chest, at.x, from.y, at.z);
    const dx = from.x - chest.x;
    const dz = from.z - chest.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return from;
    const dir = v3.set(this.dir, dx / len, 0, dz / len);
    const hit = this.physics.raycastStatic(chest, dir, len + 0.08);
    if (Number.isFinite(hit)) v3.addScaled(from, chest, dir, Math.max(0, hit - 0.08));
    return from;
  }
}
