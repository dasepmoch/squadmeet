import { clamp, SIM_DT, wrapAngle, type Vec3 } from '@huddle/shared';

/**
 * Paper-plane flight as a point-mass glider in wind axes. Lift grows with airspeed and carries
 * the weight at the trim speed; drag keeps the glide at about 5:1. Thrown too fast it pitches up
 * and slows, too slow it drops its nose and speeds up again: the gentle oscillation of a real
 * paper plane. A banked release curves the flight.
 */
export const GLIDER = {
  /** Airspeed (m/s) at which lift equals weight. */
  trimSpeed: 4.6,
  /** Lift over drag: a steady glide sinks one meter every five. */
  glideRatio: 5,
  /** Bank angle (rad) of a full release tilt. */
  maxBank: 0.36,
  /** Launch airspeed range (m/s) the planner chooses from. */
  minSpeed: 2.2,
  maxSpeed: 8.2,
  /** Longest flight the planner simulates (s). */
  maxTime: 4.5,
} as const;

const G = 9.81;
const MIN_AIRSPEED = 0.5;
/** Planning resolution; the flight itself runs at the fixed step. */
const PLAN_DT = 1 / 30;
/** Launch climb angles tried in turn: gentle glides first, steep tosses for short throws. */
const CLIMBS = [0.1, -0.05, -0.22, -0.42, -0.65, -0.9];
/** A plan this close (horizontal meters) to the target is good enough. */
const CLOSE_ENOUGH = 0.2;

/** Airspeed, flight-path angle (climbing > 0), heading (engine yaw: 0 faces +Z) and bank. */
export interface GlideState {
  speed: number;
  gamma: number;
  psi: number;
  /** Positive banks right (and turns right). */
  phi: number;
}

/** A planned glide: the launch state plus when and where it comes down to the target height. */
export interface GlidePlan extends GlideState {
  time: number;
  landing: Vec3;
}

export function createGlidePlan(): GlidePlan {
  return { speed: 0, gamma: 0, psi: 0, phi: 0, time: 0, landing: { x: 0, y: 0, z: 0 } };
}

/** Advances the flight by `dt` (semi-implicit: position moves with the updated velocity). */
export function stepGlide(s: GlideState, dt: number): void {
  const v = Math.max(MIN_AIRSPEED, s.speed);
  const k = v / GLIDER.trimSpeed;
  const lift = G * k;
  const drag = (G / GLIDER.glideRatio) * k * k;
  s.speed = Math.max(MIN_AIRSPEED, v - (drag + G * Math.sin(s.gamma)) * dt);
  const climb = (lift * Math.cos(s.phi) - G * Math.cos(s.gamma)) / s.speed;
  s.gamma = clamp(s.gamma + climb * dt, -1.4, 1.4);
  // Increasing yaw turns left (yaw 0 faces +Z, +X is on the left), so a right bank lowers it.
  s.psi -= ((lift * Math.sin(s.phi)) / (s.speed * Math.max(0.2, Math.cos(s.gamma)))) * dt;
}

export function glideVelocity(s: GlideState, out: Vec3): Vec3 {
  const c = Math.cos(s.gamma);
  out.x = s.speed * c * Math.sin(s.psi);
  out.y = s.speed * Math.sin(s.gamma);
  out.z = s.speed * c * Math.cos(s.psi);
  return out;
}

/** Orientation of a plane modeled nose +Z: yaw, then pitch (nose up when climbing), then bank. */
export function glideRotation(
  s: GlideState,
  out: { x: number; y: number; z: number; w: number },
): void {
  const sy = Math.sin(s.psi / 2);
  const cy = Math.cos(s.psi / 2);
  const sx = Math.sin(-s.gamma / 2);
  const cx = Math.cos(-s.gamma / 2);
  const sz = Math.sin(s.phi / 2);
  const cz = Math.cos(s.phi / 2);
  // q = qYaw * qPitch, then * qRoll.
  const ax = cy * sx;
  const ay = sy * cx;
  const az = -sy * sx;
  const aw = cy * cx;
  out.x = ax * cz + ay * sz;
  out.y = ay * cz - ax * sz;
  out.z = aw * sz + az * cz;
  out.w = aw * cz - az * sz;
}

const scratch: GlideState = { speed: 0, gamma: 0, psi: 0, phi: 0 };

/**
 * Flies `s` from `from` until it sinks through `floorY` or runs out of time; writes the touchdown
 * into `end` and returns the flight time. `visit` sees every step (for drawing the path).
 */
export function simulateGlide(
  from: Vec3,
  s: GlideState,
  floorY: number,
  end: Vec3,
  dt = PLAN_DT,
  visit?: (x: number, y: number, z: number, t: number) => void,
): number {
  const st = scratch;
  st.speed = s.speed;
  st.gamma = s.gamma;
  st.psi = s.psi;
  st.phi = s.phi;
  let x = from.x;
  let y = from.y;
  let z = from.z;
  let t = 0;
  visit?.(x, y, z, 0);
  while (t < GLIDER.maxTime) {
    stepGlide(st, dt);
    const c = Math.cos(st.gamma) * st.speed;
    const nx = x + c * Math.sin(st.psi) * dt;
    const ny = y + st.speed * Math.sin(st.gamma) * dt;
    const nz = z + c * Math.cos(st.psi) * dt;
    if (ny <= floorY) {
      const f = y - ny > 1e-9 ? (y - floorY) / (y - ny) : 1;
      x += (nx - x) * f;
      z += (nz - z) * f;
      y = floorY;
      t += dt * f;
      visit?.(x, y, z, t);
      break;
    }
    x = nx;
    y = ny;
    z = nz;
    t += dt;
    visit?.(x, y, z, t);
  }
  end.x = x;
  end.y = y;
  end.z = z;
  return t;
}

const probe: GlideState = { speed: 0, gamma: 0, psi: 0, phi: 0 };
const landing = { x: 0, y: 0, z: 0 };

/**
 * Plans a paper-plane throw from `from` that comes down on `to`: the release tilt fixes the bank,
 * a launch climb angle is chosen (gentle glides first), the airspeed is bisected to match the
 * distance and the heading is turned so the curving path still ends on the target. Unreachable
 * targets get the closest plan found. Deterministic, so every client replays the same flight.
 */
export function planGlide(from: Vec3, to: Vec3, tilt: number, out: GlidePlan): GlidePlan {
  const phi = clamp(tilt, -1, 1) * GLIDER.maxBank;
  // Planes are aimed down or level, never up at a shelf: the path must start above its target.
  const floorY = Math.min(to.y, from.y - 0.05);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const bearing = Math.atan2(dx, dz);
  let bestErr = Number.POSITIVE_INFINITY;
  probe.phi = phi;
  for (const gamma of CLIMBS) {
    probe.gamma = gamma;
    probe.psi = bearing;
    for (let pass = 0; pass < 3; pass++) {
      let lo: number = GLIDER.minSpeed;
      let hi: number = GLIDER.maxSpeed;
      for (let i = 0; i < 10; i++) {
        probe.speed = (lo + hi) / 2;
        simulateGlide(from, probe, floorY, landing);
        if (Math.hypot(landing.x - from.x, landing.z - from.z) < d) lo = probe.speed;
        else hi = probe.speed;
      }
      probe.speed = (lo + hi) / 2;
      simulateGlide(from, probe, floorY, landing);
      // Turn the launch so the curve ends on the target's bearing.
      const miss = wrapAngle(Math.atan2(landing.x - from.x, landing.z - from.z) - bearing);
      if (phi === 0 || d < 0.3) break;
      probe.psi = wrapAngle(probe.psi - miss);
    }
    const time = simulateGlide(from, probe, floorY, landing, SIM_DT);
    const err = Math.hypot(landing.x - to.x, landing.z - to.z);
    if (err < bestErr) {
      bestErr = err;
      out.speed = probe.speed;
      out.gamma = probe.gamma;
      out.psi = probe.psi;
      out.phi = phi;
      out.time = time;
      out.landing.x = landing.x;
      out.landing.y = landing.y;
      out.landing.z = landing.z;
    }
    if (err < CLOSE_ENOUGH) break;
  }
  return out;
}
