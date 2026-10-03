import { describe, expect, it } from 'vitest';
import { FixedStepper } from './fixed-stepper.ts';

describe('FixedStepper', () => {
  it('runs whole steps and exposes the interpolation alpha', () => {
    const s = new FixedStepper(1 / 60, 5);
    let calls = 0;
    s.advance(1 / 60 + 0.5 / 60, () => calls++);
    expect(calls).toBe(1);
    expect(s.alpha).toBeCloseTo(0.5, 5);
    s.advance(0.5 / 60, () => calls++);
    expect(calls).toBe(2);
    expect(s.alpha).toBeCloseTo(0, 5);
  });

  it('is independent of frame rate', () => {
    const a = new FixedStepper(1 / 60, 10);
    const b = new FixedStepper(1 / 60, 10);
    let na = 0;
    let nb = 0;
    for (let i = 0; i < 144; i++) a.advance(1 / 144, () => na++);
    for (let i = 0; i < 30; i++) b.advance(1 / 30, () => nb++);
    expect(Math.abs(na - nb)).toBeLessThanOrEqual(1);
    expect(na).toBeGreaterThanOrEqual(59);
  });

  it('drops backlog beyond max substeps (spiral-of-death guard)', () => {
    const s = new FixedStepper(1 / 60, 5);
    let calls = 0;
    s.advance(2, () => calls++);
    expect(calls).toBe(5);
    expect(s.dropped).toBeGreaterThan(1800);
    expect(s.alpha).toBeLessThan(1);
  });
});
