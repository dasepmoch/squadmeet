import { v3 } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { sampleArc } from './launch.ts';
import {
  clampThrowTarget,
  launchVelocity,
  MAX_THROW_RANGE,
  THROW_KINDS,
  THROWABLES,
} from './throwables.ts';

describe('throwables', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('the aiming arc starts at the hand and ends on the target for every kind', () => {
    const from = v3.vec3(1, 1.4, 2);
    const to = v3.vec3(-3, 0.8, -4);
    const pts = Array.from({ length: 24 }, () => v3.vec3());
    for (const kind of THROW_KINDS) {
      const n = sampleArc(kind, from, to, 24, pts);
      expect(n).toBe(24);
      expect(v3.distance(pts[0]!, from)).toBeLessThan(1e-9);
      // Ballistic arcs land exactly; a paper plane glides there (within a hand's width).
      const tolerance = kind === 'plane' ? 0.3 : 1e-6;
      expect(v3.distance(pts[23]!, to)).toBeLessThan(tolerance);
    }
  });

  it('clamps far targets to the throw range', () => {
    const from = v3.vec3(0, 1, 0);
    const out = clampThrowTarget(from, v3.vec3(40, 1, 0));
    expect(out.x).toBeCloseTo(MAX_THROW_RANGE, 6);
    const near = clampThrowTarget(from, v3.vec3(3, 0, 1));
    expect(near).toEqual({ x: 3, y: 0, z: 1 });
  });

  it('the damped launch velocity lands a real Rapier body on the target', async () => {
    const physics = await PhysicsWorld.create();
    const from = v3.vec3(0, 1.4, 0);
    const to = v3.vec3(5, 1.1, -3);
    for (const kind of ['paper', 'duck', 'heart'] as const) {
      const def = THROWABLES[kind];
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      const time = def.flightTime(d);
      const vel = launchVelocity(from, to, time, def.body.gravityScale, def.body.linearDamping);
      const p = physics.createProjectile(def.body, from, vel, v3.vec3());
      const steps = Math.round(time * 60);
      for (let i = 0; i < steps; i++) physics.step(1 / 60);
      const t = p.body.translation();
      // Discrete integration drifts a little from the analytic flight; a few cm is invisible.
      expect(Math.hypot(t.x - to.x, t.y - to.y, t.z - to.z)).toBeLessThan(0.12);
      physics.removeProjectile(p);
    }
    physics.dispose();
  });
});
