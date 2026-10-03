import { v3 } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import {
  createGlidePlan,
  GLIDER,
  planGlide,
  simulateGlide,
  stepGlide,
  type GlideState,
} from './glider.ts';

describe('paper-plane glider', () => {
  it('glides about five meters for every meter it sinks', () => {
    const s: GlideState = { speed: GLIDER.trimSpeed, gamma: -Math.atan(1 / 5), psi: 0, phi: 0 };
    const end = v3.vec3();
    simulateGlide(v3.vec3(0, 3, 0), s, 0, end, 1 / 60);
    expect(end.z / 3).toBeGreaterThan(4.6);
    expect(end.z / 3).toBeLessThan(5.6);
  });

  it('thrown fast it pitches up, slows down, drops its nose and settles into the glide', () => {
    const s: GlideState = { speed: GLIDER.trimSpeed * 1.4, gamma: 0, psi: 0, phi: 0 };
    const gammas: number[] = [];
    for (let i = 0; i < 6 * 60; i++) {
      stepGlide(s, 1 / 60);
      gammas.push(s.gamma);
    }
    const peak = Math.max(...gammas.slice(0, 60));
    const dive = Math.min(...gammas.slice(30, 150));
    expect(peak).toBeGreaterThan(0.1);
    expect(dive).toBeLessThan(-0.3);
    // Damped: it ends near the steady glide slope.
    expect(gammas.at(-1)).toBeCloseTo(-Math.atan(1 / 5), 1);
  });

  it('a tilted release curves the flight, mirrored for the other wing', () => {
    const from = v3.vec3(0, 1.42, 0);
    const end = v3.vec3();
    const right: GlideState = { speed: 4, gamma: 0.05, psi: 0, phi: GLIDER.maxBank };
    simulateGlide(from, right, 0, end);
    // Facing +Z, the right-hand side is -X.
    expect(end.x).toBeLessThan(-0.3);
    const xRight = end.x;
    simulateGlide(from, { ...right, phi: -GLIDER.maxBank }, 0, end);
    expect(end.x).toBeCloseTo(-xRight, 6);
  });

  it('plans throws that come down on the target, curved or straight', () => {
    const from = v3.vec3(1, 1.42, 2);
    for (const tilt of [-1, -0.5, 0, 0.5, 1]) {
      for (const d of [2, 3.5, 5, 7, 9]) {
        const to = v3.vec3(1 + d * 0.6, 0, 2 - d * 0.8);
        const plan = planGlide(from, to, tilt, createGlidePlan());
        const miss = Math.hypot(plan.landing.x - to.x, plan.landing.z - to.z);
        expect(miss, `tilt ${tilt}, ${d} m`).toBeLessThan(0.3);
        expect(plan.time).toBeGreaterThan(0.3);
        expect(plan.speed).toBeGreaterThanOrEqual(GLIDER.minSpeed);
        expect(plan.speed).toBeLessThanOrEqual(GLIDER.maxSpeed);
      }
    }
  });
});
