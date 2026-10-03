import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DecalLayer, growCurve } from './decals.ts';

const ATLAS = new THREE.DataTexture(new Uint8Array(4), 1, 1);
const INK = new THREE.Color('#C8231A');
/** How long tomato splats stay before fading (seconds), as `ThrowFx` uses them. */
const LIFE = 60;

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('DecalLayer', () => {
  it('lands a splat small and lets it spread out a little past full size', () => {
    expect(growCurve(0)).toBeCloseTo(0.35);
    expect(growCurve(1)).toBe(1);
    const peak = Math.max(...Array.from({ length: 60 }, (_, i) => growCurve(i / 60)));
    expect(peak).toBeGreaterThan(1.03);
    expect(peak).toBeLessThan(1.1);
  });

  it('keeps a splat for its life, then fades it out', () => {
    const layer = new DecalLayer(ATLAS);
    layer.add([0, 1, 0], [0, 0, 1], 0.3, 0, INK, 3, 0, LIFE);
    layer.update(LIFE - 1);
    expect(layer.liveDynamic(LIFE - 1)).toBe(1);
    layer.update(LIFE + 1);
    expect(layer.activeDynamic).toBe(1);
    layer.update(LIFE + 3);
    expect(layer.activeDynamic).toBe(0);
    expect(layer.mesh.count).toBe(0);
    layer.dispose();
  });

  it('stays within budget through a 30-minute splat storm, then mops up clean', () => {
    const layer = new DecalLayer(ATLAS);
    const budget = 150;
    layer.setBudget(budget);
    // Room decals are permanent and survive everything.
    layer.add([0, 0.001, 0], [0, 1, 0], 0.4, 0, INK, 1, 0, 0);
    layer.add([2, 0.001, 1], [0, 1, 0], 0.3, 1, INK, 2, 0, 0);
    const rand = seeded(7);
    const dt = 1 / 30;
    let t = 0;
    let added = 0;
    let peakShown = 0;
    for (let step = 0; t < 30 * 60; step++) {
      t += dt;
      // About three tomatoes a second, and a party storm of forty once a minute.
      const n = step % 1800 === 900 ? 40 : rand() < 0.1 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const p: [number, number, number] = [rand() * 16 - 8, rand() * 3, rand() * 12 - 6];
        layer.add(p, [0, 1, 0], 0.24 + rand() * 0.18, rand() * 6.3, INK, step + k, t, LIFE);
        layer.enforceBudget(t);
        added++;
      }
      layer.update(t);
      if (step % 15 !== 0) continue;
      expect(layer.liveDynamic(t)).toBeLessThanOrEqual(budget);
      // Fading ones overflow the budget only by what landed during one fade.
      expect(layer.activeDynamic).toBeLessThanOrEqual(budget + 60);
      expect(layer.mesh.count).toBeLessThanOrEqual(520);
      expect(layer.permanentCount).toBe(2);
      peakShown = Math.max(peakShown, layer.activeDynamic);
    }
    expect(added).toBeGreaterThan(5000);
    expect(peakShown).toBeGreaterThan(budget - 10);
    layer.sweep(t, { x: 0, y: 0, z: 0 });
    for (let k = 0; k < 60; k++) layer.update((t += dt));
    expect(layer.activeDynamic).toBe(0);
    expect(layer.permanentCount).toBe(2);
    expect(layer.mesh.count).toBe(2);
    layer.dispose();
  });

  it('sweeps outward from the mop: near splats go first', () => {
    const layer = new DecalLayer(ATLAS);
    layer.add([0.5, 0, 0], [0, 1, 0], 0.3, 0, INK, 0, 0, LIFE);
    layer.add([7, 0, 0], [0, 1, 0], 0.3, 0, INK, 1, 0, LIFE);
    layer.sweep(1, { x: 0, y: 0, z: 0 });
    layer.update(1.6);
    expect(layer.activeDynamic).toBe(1);
    layer.update(3);
    expect(layer.activeDynamic).toBe(0);
    layer.dispose();
  });
});
