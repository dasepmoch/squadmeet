import { clamp, v3, type ThrowKind, type Vec3 } from '@huddle/shared';
import type { ProjectileBodyDef } from '../physics/physics-world.ts';

// The kinds are part of the wire protocol, so they live in `shared`.
export { isThrowKind, THROW_KINDS, type ThrowKind } from '@huddle/shared';

/** What happens when a projectile touches something. */
export type ImpactBehavior =
  /** Bounces around and comes to rest (paper balls, rubber ducks). */
  | 'bounce'
  /** Splats on first contact, leaving a decal (tomatoes). */
  | 'splat'
  /** Bursts into particles on first contact or after `burstAfter` seconds (confetti, hearts). */
  | 'burst'
  /** Glides until the first contact, then tumbles like a bouncing object (paper planes). */
  | 'glide';

export interface ThrowableDef {
  kind: ThrowKind;
  body: ProjectileBodyDef;
  impact: ImpactBehavior;
  /** Seconds a resting projectile stays before fading away. */
  life: number;
  burstAfter?: number;
  /** Flight time for a throw of `d` meters (seconds): short hops, lazy lobs. */
  flightTime: (d: number) => number;
  /** Launch spin (rad/s, random axis). */
  spin: number;
  /** Seconds between two throws of this kind by one player. */
  cooldown: number;
}

const ball = (
  radius: number,
  density: number,
  restitution: number,
  friction: number,
  gravityScale = 1,
  linearDamping = 0.05,
): ProjectileBodyDef => ({
  shape: 'ball',
  radius,
  density,
  restitution,
  friction,
  gravityScale,
  linearDamping,
  angularDamping: 0.4,
});

export const THROWABLES: Record<ThrowKind, ThrowableDef> = {
  paper: {
    kind: 'paper',
    body: ball(0.045, 120, 0.35, 0.7),
    impact: 'bounce',
    life: 22,
    flightTime: (d) => clamp(0.42 + d * 0.07, 0.45, 1.2),
    spin: 9,
    cooldown: 0.35,
  },
  plane: {
    kind: 'plane',
    // The glider model (glider.ts) flies it: no gravity or damping from the physics engine
    // until it touches something and tumbles down.
    body: {
      shape: 'box',
      radius: 0.05,
      half: [0.06, 0.012, 0.11],
      density: 60,
      restitution: 0.15,
      friction: 0.8,
      gravityScale: 0,
      linearDamping: 0,
      angularDamping: 2,
    },
    impact: 'glide',
    life: 30,
    // A rough estimate (leading a walking target); the glider plan has the exact time.
    flightTime: (d) => clamp(0.4 + d * 0.22, 0.6, 3),
    spin: 0,
    cooldown: 0.5,
  },
  tomato: {
    kind: 'tomato',
    body: ball(0.042, 900, 0.1, 0.9),
    impact: 'splat',
    life: 0,
    flightTime: (d) => clamp(0.4 + d * 0.07, 0.45, 1.25),
    spin: 5,
    cooldown: 0.45,
  },
  duck: {
    kind: 'duck',
    body: ball(0.055, 180, 0.72, 0.45),
    impact: 'bounce',
    life: 30,
    flightTime: (d) => clamp(0.45 + d * 0.075, 0.5, 1.3),
    spin: 7,
    cooldown: 0.45,
  },
  confetti: {
    kind: 'confetti',
    body: ball(0.035, 400, 0.2, 0.8),
    impact: 'burst',
    life: 0,
    burstAfter: 0.62,
    flightTime: (d) => clamp(0.5 + d * 0.06, 0.55, 1.1),
    spin: 12,
    cooldown: 0.6,
  },
  heart: {
    kind: 'heart',
    body: ball(0.055, 60, 0.3, 0.5, 0.12, 0.8),
    impact: 'burst',
    life: 0,
    burstAfter: 4,
    flightTime: (d) => clamp(0.9 + d * 0.14, 1, 2.6),
    spin: 1.5,
    cooldown: 0.5,
  },
};

/** Farthest anyone can throw (meters). */
export const MAX_THROW_RANGE = 14;
const GRAVITY = 9.81;

/**
 * Launch velocity that lands a body with the given gravity scale and linear damping on `to`
 * after `time` seconds. Solves the damped ballistic equation per axis (the undamped limit is the
 * classic `d / T` and `dy / T + g T / 2`).
 */
export function launchVelocity(
  from: Vec3,
  to: Vec3,
  time: number,
  gravityScale: number,
  damping: number,
  out: Vec3 = v3.vec3(),
): Vec3 {
  const g = GRAVITY * gravityScale;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  if (damping < 1e-3) {
    out.x = dx / time;
    out.z = dz / time;
    out.y = dy / time + (g * time) / 2;
    return out;
  }
  // x(T) = v0 (1 - e^-cT) / c  ;  y(T) = (v0 + g/c)(1 - e^-cT)/c - g T / c
  const c = damping;
  const f = (1 - Math.exp(-c * time)) / c;
  out.x = dx / f;
  out.z = dz / f;
  out.y = (dy + (g * time) / c) / f - g / c;
  return out;
}

/** Clamps a target point to the maximum throw range from `from`. */
export function clampThrowTarget(from: Vec3, to: Vec3, out: Vec3 = v3.vec3()): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dy, dz);
  const k = d > MAX_THROW_RANGE ? MAX_THROW_RANGE / d : 1;
  out.x = from.x + dx * k;
  out.y = from.y + dy * k;
  out.z = from.z + dz * k;
  return out;
}
