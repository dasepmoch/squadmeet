import { describe, expect, it } from 'vitest';
import { angleDelta, clamp, damp, springDamp, wrapAngle } from './scalar.ts';
import { forwardFromYaw, rotateY, vec3, yawFromDirection } from './vec3.ts';

describe('scalar math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('wraps angles into (-PI, PI]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
  });

  it('damps frame-rate independently', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 1, 5, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
  });

  it('spring converges without overshoot', () => {
    const state = { v: 0 };
    let x = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      x = springDamp(x, 1, state, 0.25, 1 / 60);
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(1, 3);
    expect(max).toBeLessThanOrEqual(1.0001);
  });
});

describe('yaw convention', () => {
  it('yaw 0 faces +Z and yaw PI/2 faces +X', () => {
    const f = forwardFromYaw(vec3(), 0);
    expect(f.z).toBeCloseTo(1);
    const r = forwardFromYaw(vec3(), Math.PI / 2);
    expect(r.x).toBeCloseTo(1);
    expect(yawFromDirection(r.x, r.z)).toBeCloseTo(Math.PI / 2);
  });

  it('rotateY matches forwardFromYaw', () => {
    const out = rotateY(vec3(), vec3(0, 0, 1), 0.7);
    const f = forwardFromYaw(vec3(), 0.7);
    expect(out.x).toBeCloseTo(f.x);
    expect(out.z).toBeCloseTo(f.z);
  });
});
