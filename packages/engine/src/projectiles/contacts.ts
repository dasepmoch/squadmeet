import { clamp, v3, type Vec3 } from '@huddle/shared';
import type { PhysicsWorld, ProjectileBody } from '../physics/physics-world.ts';
import type { GlideState } from './glider.ts';
import type { ProjectileEvent, ProjectileView } from './projectile-system.ts';
import type { ThrowableDef } from './throwables.ts';

/**
 * Someone a projectile can touch. `position` is the feet when standing and the seat surface when
 * seated. Solid people have an enabled capsule and are handled by Rapier contacts; seated people
 * (capsule disabled) and protected people (capsule ignores projectiles) are tested against a
 * simple body volume instead.
 */
export interface HitTarget {
  id: string;
  position: Vec3;
  seated: boolean;
  solid: boolean;
  /** "Don't hit me": things pass through them with a ghost shimmer. */
  shield: boolean;
}

/** One live projectile with its physics body and bookkeeping. */
export interface Live {
  view: ProjectileView;
  def: ThrowableDef;
  phys: ProjectileBody;
  /** Someone else's throw replayed locally: looks and sounds the same, but its thrower decides hits. */
  cosmetic: boolean;
  /** People already touched (each person reacts once per object). */
  hit: Set<string>;
  restTime: number;
  done: boolean;
  /** Flight state while a paper plane is still gliding. */
  glide: GlideState | null;
  /** Position before the last step (baskets are detected between the two). */
  prev: Vec3;
  /** Release point (three-pointers are measured from here). */
  origin: Vec3;
  scored: boolean;
}

/** Slower touches (a duck rolling against a shoe) do not count as hits. */
const HIT_SPEED = 1.4;
/** A throw cannot hit its own thrower right after release. */
const SELF_GRACE = 0.5;
const BODY_RADIUS = 0.24;
const BODY_BOUNCE = 0.35;

/** Turns Rapier contacts and body-volume overlaps into projectile events. */
export class ContactRules {
  private readonly physics: PhysicsWorld;
  private readonly center = v3.vec3();
  private readonly dir = v3.vec3();

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
  }

  /** A Rapier contact between a projectile and another collider. */
  onContact(l: Live, other: number, out: ProjectileEvent[]): void {
    if (l.done) return;
    const character = this.physics.characterOf(other);
    if (character) {
      this.touchPerson(l, character.ownerId, character.center(this.center), false, out);
      return;
    }
    const v = l.view;
    const wasLanded = v.landed;
    v.landed = true;
    switch (l.def.impact) {
      case 'splat':
        out.push({
          type: 'splat',
          kind: v.kind,
          throwerId: v.throwerId,
          point: { ...v.position },
          normal: this.surfaceNormal(l),
          targetId: null,
        });
        l.done = true;
        break;
      case 'burst':
        out.push({ type: 'burst', kind: v.kind, throwerId: v.throwerId, point: { ...v.position } });
        l.done = true;
        break;
      case 'glide':
        if (!wasLanded) startFalling(l);
        break;
      case 'bounce': {
        const s = Math.hypot(v.velocity.x, v.velocity.y, v.velocity.z);
        if (s > 1.1) out.push({ type: 'bounce', kind: v.kind, point: { ...v.position }, speed: s });
        break;
      }
    }
  }

  /**
   * Seated people have no active capsule and protected people ignore projectiles: test their
   * body volume directly. Protected people let things pass through (a ghost event, once each).
   */
  touchVolumes(l: Live, people: readonly HitTarget[], out: ProjectileEvent[]): void {
    const p = l.view.position;
    const r = l.def.body.radius + BODY_RADIUS;
    for (const who of people) {
      if (who.solid && !who.shield) continue;
      const y0 = who.position.y + 0.05;
      const y1 = who.position.y + (who.seated ? 0.8 : 1.45);
      const cy = clamp(p.y, y0, y1);
      const dx = p.x - who.position.x;
      const dy = p.y - cy;
      const dz = p.z - who.position.z;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      if (who.shield) {
        if (l.hit.has(who.id) || (who.id === l.view.throwerId && l.view.age < SELF_GRACE)) continue;
        l.hit.add(who.id);
        out.push({
          type: 'ghost',
          kind: l.view.kind,
          throwerId: l.view.throwerId,
          targetId: who.id,
          point: { ...p },
        });
        continue;
      }
      v3.set(this.center, who.position.x, cy, who.position.z);
      this.touchPerson(l, who.id, this.center, true, out);
      if (l.done) return;
    }
  }

  /** A projectile touched a person (capsule contact, or the body volume with `reflect`). */
  private touchPerson(
    l: Live,
    id: string,
    center: Vec3,
    reflect: boolean,
    out: ProjectileEvent[],
  ): void {
    const v = l.view;
    if (id === v.throwerId && v.age < SELF_GRACE) return;
    const speed = Math.hypot(v.velocity.x, v.velocity.y, v.velocity.z);
    if (speed < HIT_SPEED || l.hit.has(id)) return;
    l.hit.add(id);
    if (!l.cosmetic) {
      out.push({
        type: 'hit',
        kind: v.kind,
        throwerId: v.throwerId,
        targetId: id,
        point: { ...v.position },
        seq: v.seq,
      });
    }
    const wasLanded = v.landed;
    v.landed = true;
    switch (l.def.impact) {
      case 'splat': {
        const nx = v.position.x - center.x;
        const nz = v.position.z - center.z;
        const len = Math.hypot(nx, nz) || 1;
        out.push({
          type: 'splat',
          kind: v.kind,
          throwerId: v.throwerId,
          point: { ...v.position },
          normal: { x: nx / len, y: 0, z: nz / len },
          targetId: id,
        });
        l.done = true;
        return;
      }
      case 'burst':
        out.push({ type: 'burst', kind: v.kind, throwerId: v.throwerId, point: { ...v.position } });
        l.done = true;
        return;
      case 'glide':
        if (!wasLanded) startFalling(l);
        break;
      case 'bounce':
        out.push({ type: 'bounce', kind: v.kind, point: { ...v.position }, speed });
        break;
    }
    if (reflect) bounceOff(l, center);
  }

  /** Normal of the static surface a splat hit: a short raycast along the flight direction. */
  private surfaceNormal(l: Live): Vec3 {
    const p = l.view.position;
    const vel = l.view.velocity;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed > 1e-3) {
      const d = v3.set(this.dir, vel.x / speed, vel.y / speed, vel.z / speed);
      const from = { x: p.x - d.x * 0.2, y: p.y - d.y * 0.2, z: p.z - d.z * 0.2 };
      const hit = this.physics.raycastStaticWithNormal(from, d, 0.6);
      if (hit) {
        p.x = from.x + d.x * hit.distance;
        p.y = from.y + d.y * hit.distance;
        p.z = from.z + d.z * hit.distance;
        return hit.normal;
      }
    }
    return { x: 0, y: 1, z: 0 };
  }
}

/** A gliding plane that touched something stops flying and tumbles down. */
export function startFalling(l: Live): void {
  l.glide = null;
  l.phys.body.setGravityScale(1, true);
  l.phys.body.setLinearDamping(0.5);
  l.phys.body.setAngularDamping(0.5);
}

/** Bounces a projectile off a (non-physical) body volume. */
function bounceOff(l: Live, center: Vec3): void {
  const p = l.view.position;
  const vel = l.view.velocity;
  let nx = p.x - center.x;
  let ny = p.y - center.y;
  let nz = p.z - center.z;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vn >= 0) return;
  const k = (1 + BODY_BOUNCE) * vn;
  vel.x = (vel.x - k * nx) * 0.7;
  vel.y = (vel.y - k * ny) * 0.7;
  vel.z = (vel.z - k * nz) * 0.7;
  l.phys.body.setLinvel(vel, true);
}
