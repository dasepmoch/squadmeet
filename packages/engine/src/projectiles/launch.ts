import { canScore, SIM_DT, type ResolvedGoal, type ResolvedRoom, type Vec3 } from '@huddle/shared';
import {
  createGlidePlan,
  glideVelocity,
  planGlide,
  simulateGlide,
  type GlidePlan,
} from './glider.ts';
import { clampThrowTarget, launchVelocity, THROWABLES, type ThrowKind } from './throwables.ts';

/** What a throw needs to know about the room: hoops (aim assist) and the ceiling (lob height). */
export interface ThrowRoom {
  goals: readonly ResolvedGoal[];
  ceiling: number;
}

export const OPEN_SKY: ThrowRoom = { goals: [], ceiling: 50 };

export function throwRoomOf(room: ResolvedRoom): ThrowRoom {
  return { goals: room.goals, ceiling: room.bounds.max[1] };
}

/** How a throw leaves the hand. Planned the same way on every client from the throw message. */
export interface ThrowPlan {
  /** Aim point after range clamping and hoop assist. */
  target: Vec3;
  velocity: Vec3;
  /** Seconds to the target. */
  time: number;
  /** True for paper planes: `glide` holds the launch state of their glider model. */
  gliding: boolean;
  glide: GlidePlan;
  /** The hoop this shot was helped toward, or null. */
  goal: ResolvedGoal | null;
}

export function createThrowPlan(): ThrowPlan {
  return {
    target: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    time: 0,
    gliding: false,
    glide: createGlidePlan(),
    goal: null,
  };
}

/** Within this distance (meters) of a rim, a ball throw counts as a shot at the hoop. */
const HOOP_REACH = 0.55;
/** How much of the way the aim is pulled toward the rim center. */
const HOOP_PULL = 0.65;
/** Aim this far below the rim plane, so the ball passes through it on the way down. */
const RIM_DROP = 0.05;
/** tan of the entry angle a lob aims for (about 42 degrees). */
const LOB_ENTRY = 0.9;
/** Lobs peak at least this far below the ceiling. */
const CEILING_GAP = 0.3;

function nearestGoal(goals: readonly ResolvedGoal[], p: Vec3): ResolvedGoal | null {
  let best: ResolvedGoal | null = null;
  let bestD = HOOP_REACH;
  for (const g of goals) {
    const d = Math.hypot(p.x - g.position[0], p.y - g.position[1], p.z - g.position[2]);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/**
 * Flight time of a lob from `from` to `to`: steep enough to come down through a rim, but never
 * longer than the time whose arc would touch the ceiling. Never shorter than the usual `base`.
 */
function lobTime(from: Vec3, to: Vec3, base: number, apex: number, gravityScale: number): number {
  const g = 9.81 * gravityScale;
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const dy = to.y - from.y;
  const steep = Math.sqrt(Math.max(0, (2 * (LOB_ENTRY * d + dy)) / g));
  const vyMax = Math.sqrt(2 * g * Math.max(0.1, apex - from.y));
  const disc = vyMax * vyMax - 2 * g * dy;
  const cap = disc > 0 ? (vyMax + Math.sqrt(disc)) / g : base;
  return Math.max(base, Math.min(steep, cap));
}

/**
 * Plans a throw of `kind` from `from` toward `to`. Paper planes fly their glider model (`tilt`
 * banks them); everything else follows a damped ballistic arc. Balls aimed close to a hoop are
 * pulled toward the rim and lobbed, so a shot at the hoop drops in from above.
 */
export function planThrow(
  kind: ThrowKind,
  from: Vec3,
  to: Vec3,
  tilt: number,
  room: ThrowRoom,
  out: ThrowPlan,
): ThrowPlan {
  const def = THROWABLES[kind];
  const target = clampThrowTarget(from, to, out.target);
  out.goal = null;
  out.gliding = def.impact === 'glide';
  if (out.gliding) {
    planGlide(from, target, tilt, out.glide);
    glideVelocity(out.glide, out.velocity);
    out.time = out.glide.time;
    return out;
  }
  let time = def.flightTime(Math.hypot(target.x - from.x, target.z - from.z));
  const goal = canScore(kind) ? nearestGoal(room.goals, target) : null;
  if (goal) {
    target.x += (goal.position[0] - target.x) * HOOP_PULL;
    target.y += (goal.position[1] - RIM_DROP - target.y) * HOOP_PULL;
    target.z += (goal.position[2] - target.z) * HOOP_PULL;
    time = lobTime(from, target, time, room.ceiling - CEILING_GAP, def.body.gravityScale);
    out.goal = goal;
  }
  launchVelocity(from, target, time, def.body.gravityScale, def.body.linearDamping, out.velocity);
  out.time = time;
  return out;
}

const arcPlan = createThrowPlan();

/**
 * Samples the flight of a throw for the aiming arc (`count` world points into `out`). Uses the
 * same plan as the real launch, so the preview matches the flight; the last point is where it
 * comes down (for planes that can differ from the pointer).
 */
export function sampleArc(
  kind: ThrowKind,
  from: Vec3,
  to: Vec3,
  count: number,
  out: Vec3[],
  tilt = 0,
  room: ThrowRoom = OPEN_SKY,
): number {
  const plan = planThrow(kind, from, to, tilt, room, arcPlan);
  const n = Math.min(count, out.length);
  if (plan.gliding) return sampleGlidePath(from, plan, n, out);
  const def = THROWABLES[kind];
  const v = plan.velocity;
  const g = 9.81 * def.body.gravityScale;
  const c = def.body.linearDamping;
  for (let i = 0; i < n; i++) {
    const t = (i / Math.max(1, n - 1)) * plan.time;
    const p = out[i] as Vec3;
    if (c < 1e-3) {
      p.x = from.x + v.x * t;
      p.y = from.y + v.y * t - 0.5 * g * t * t;
      p.z = from.z + v.z * t;
    } else {
      const f = (1 - Math.exp(-c * t)) / c;
      p.x = from.x + v.x * f;
      p.y = from.y + (v.y + g / c) * f - (g * t) / c;
      p.z = from.z + v.z * f;
    }
  }
  return n;
}

const pathEnd = { x: 0, y: 0, z: 0 };

/** Evenly timed points along a planned glide (simulated at the real fixed step). */
function sampleGlidePath(from: Vec3, plan: ThrowPlan, n: number, out: Vec3[]): number {
  const total = Math.max(1e-3, plan.time);
  let next = 0;
  const floor = Math.min(plan.target.y, from.y - 0.05);
  simulateGlide(from, plan.glide, floor, pathEnd, SIM_DT, (x, y, z, t) => {
    while (next < n && t >= (next / Math.max(1, n - 1)) * total - 1e-9) {
      const p = out[next] as Vec3;
      p.x = x;
      p.y = y;
      p.z = z;
      next++;
    }
  });
  for (let i = next; i < n; i++) {
    const p = out[i] as Vec3;
    p.x = pathEnd.x;
    p.y = pathEnd.y;
    p.z = pathEnd.z;
  }
  return n;
}
