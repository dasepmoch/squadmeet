import { createRng, DEFAULT_AVATAR, randomAvatar } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { BONES } from '../rig.ts';
import { buildAvatarMeshData } from './character.ts';
import { meshSculpt } from './mesher.ts';
import { Sculpt } from './sdf.ts';

describe('sculpt mesher', () => {
  it('meshes a sphere into a closed, outward-facing surface', () => {
    const s = new Sculpt().add({ t: 'sphere', c: [0, 0, 0], r: 0.1 }, 0, 'hips');
    const m = meshSculpt(s, 0.01);
    expect(m.vertexCount).toBeGreaterThan(200);
    for (let v = 0; v < m.vertexCount; v++) {
      const x = m.positions[v * 3] as number;
      const y = m.positions[v * 3 + 1] as number;
      const z = m.positions[v * 3 + 2] as number;
      expect(Math.abs(Math.hypot(x, y, z) - 0.1)).toBeLessThan(0.002);
      // Normals point away from the center.
      expect(
        x * (m.normals[v * 3] as number) +
          y * (m.normals[v * 3 + 1] as number) +
          z * (m.normals[v * 3 + 2] as number),
      ).toBeGreaterThan(0);
    }
    // Triangle winding agrees with the normals (counter-clockwise from outside).
    const [a, b, c] = [m.indices[0] as number, m.indices[1] as number, m.indices[2] as number];
    const P = (i: number): [number, number, number] => [
      m.positions[i * 3] as number,
      m.positions[i * 3 + 1] as number,
      m.positions[i * 3 + 2] as number,
    ];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    expect(n[0]! * pa[0] + n[1]! * pa[1] + n[2]! * pa[2]).toBeGreaterThan(0);
  });
});

describe('sculpted avatar', () => {
  it('builds the default avatar with sane, normalized skin weights', () => {
    const data = buildAvatarMeshData(DEFAULT_AVATAR);
    expect(data.joints.length).toBe(BONES.length * 3);
    const lod0 = data.lods[0] ?? [];
    const names = lod0.map((p) => p.name);
    for (const n of ['head', 'handL', 'handR', 'top', 'bottom', 'shoes', 'hair'])
      expect(names).toContain(n);
    let verts = 0;
    for (const part of lod0) {
      const count = part.positions.length / 3;
      verts += count;
      for (let v = 0; v < count; v += 17) {
        const sum =
          (part.skinWeight[v * 4] as number) +
          (part.skinWeight[v * 4 + 1] as number) +
          (part.skinWeight[v * 4 + 2] as number) +
          (part.skinWeight[v * 4 + 3] as number);
        expect(sum).toBeCloseTo(1, 4);
      }
      for (let i = 0; i < part.colors.length; i += 31)
        expect(Number.isFinite(part.colors[i])).toBe(true);
    }
    // Detailed but real-time friendly.
    expect(verts).toBeGreaterThan(15000);
    expect(verts).toBeLessThan(90000);
    const lod1 = (data.lods[1] ?? []).reduce((n, p) => n + p.positions.length / 3, 0);
    expect(lod1).toBeLessThan(verts * 0.35);
    // Feet on the floor, head near the spec height.
    const shoes = lod0.find((p) => p.name === 'shoes');
    let minY = Infinity;
    for (let v = 1; v < (shoes?.positions.length ?? 0); v += 3)
      minY = Math.min(minY, shoes?.positions[v] ?? 0);
    expect(minY).toBeGreaterThan(-0.01);
    expect(minY).toBeLessThan(0.01);
    // eslint-disable-next-line no-console
    console.info('avatar build', {
      ms: data.ms,
      verts,
      lod1,
      parts: lod0.map((p) => `${p.name}:${p.positions.length / 3}`),
    });
  }, 30000);

  it('builds a varied crowd without errors', () => {
    const rng = createRng(7);
    for (let i = 0; i < 6; i++) {
      const spec = randomAvatar(() => rng.next());
      const data = buildAvatarMeshData(spec, [2.2]);
      expect(data.lods[0]?.length ?? 0).toBeGreaterThan(4);
    }
  }, 60000);
});
