import type { PropInstance, Rng } from '@huddle/shared';
import * as THREE from 'three';
import type { PartList } from '../../geometry/parts.ts';
import { leafGeometry } from '../../geometry/shapes.ts';
import { paramNumber, shade, type BuildContext } from '../build-context.ts';

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/**
 * Places a leaf whose stem sits at `at`, pointing outward along `yaw` and raised `elevation`
 * radians above horizontal, with its face towards the sky (so droop curls downward).
 */
function placeLeaf(
  p: PartList,
  geo: THREE.BufferGeometry,
  color: THREE.Color,
  at: THREE.Vector3,
  yaw: number,
  elevation: number,
  roll: number,
  scale = 1,
): void {
  const pitch = Math.PI / 2 - elevation;
  tmpE.set(-pitch, yaw + Math.PI, roll, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  p.addMatrix(
    geo,
    'leaf',
    color,
    new THREE.Matrix4().compose(at, tmpQ, new THREE.Vector3(scale, scale, scale)),
  );
}

function leafTint(rng: Rng): THREE.Color {
  const k = 0.82 + rng.next() * 0.3;
  return new THREE.Color(k, k * (0.97 + rng.next() * 0.06), k * 0.95);
}

function planter(
  p: PartList,
  ctx: BuildContext,
  radius: number,
  height: number,
  material: 'powder' | 'stone',
  color: string,
): number {
  const c = ctx.color(color, 'charcoal');
  p.lathe(
    `planter:${radius}:${height}`,
    [
      [0.001, 0],
      [radius * 0.82, 0],
      [radius * 0.86, 0.02],
      [radius, height * 0.96],
      [radius * 0.97, height],
      [radius * 0.88, height],
      [radius * 0.88, height * 0.94],
      [0.001, height * 0.94],
    ],
    material,
    c,
    [0, 0, 0],
    [1, 1, 1],
    40,
  );
  p.cylinder(
    radius * 0.87,
    radius * 0.87,
    0.012,
    'soil',
    ctx.color('#3A2A1E', '#3A2A1E'),
    [0, height * 0.93, 0],
    [0, 0, 0],
    32,
  );
  return height * 0.93;
}

/** Tall statement plants in floor planters: fiddle-leaf fig or bird of paradise. */
export function buildTallPlant(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const rng = ctx.rng(inst);
  const bark = ctx.color('#5B4636', '#5B4636');
  if (inst.variant === 'bird') {
    const soil = planter(p, ctx, 0.26, 0.5, 'powder', 'charcoal');
    const stems = 11;
    for (let i = 0; i < stems; i++) {
      const yaw = (i / stems) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const lean = rng.range(0.08, 0.32);
      const height = rng.range(0.85, 1.45);
      const bx = Math.sin(yaw) * 0.05;
      const bz = Math.cos(yaw) * 0.05;
      const tx = bx + Math.sin(yaw) * height * lean;
      const tz = bz + Math.cos(yaw) * height * lean;
      p.tube(
        `bop-stem-${inst.id}-${i}`,
        [
          [bx, soil, bz],
          [(bx + tx) / 2, soil + height * 0.55, (bz + tz) / 2],
          [tx, soil + height, tz],
        ],
        0.009,
        'wood',
        ctx.color('#5E7A45', '#5E7A45'),
        [0, 0, 0],
        false,
        12,
      );
      const len = rng.range(0.5, 0.72);
      const geo = leafGeometry(1, len, len * 0.42, rng.range(0.25, 0.6), rng.range(0.1, 0.25));
      placeLeaf(
        p,
        geo,
        leafTint(rng),
        new THREE.Vector3(tx, soil + height, tz),
        yaw,
        Math.PI / 2 - lean * 1.6 - 0.1,
        rng.range(-0.4, 0.4),
      );
    }
    return;
  }
  const soil = planter(p, ctx, 0.24, 0.52, 'stone', 'greige');
  const trunk: [number, number, number][] = [
    [0, soil, 0],
    [0.03, soil + 0.45, 0.01],
    [-0.02, soil + 0.9, 0.03],
    [0.02, soil + 1.28, -0.01],
  ];
  p.tube(`fig-trunk-${inst.id}`, trunk, 0.02, 'wood', bark, [0, 0, 0], false, 24);
  const curve = new THREE.CatmullRomCurve3(trunk.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const leaves = 30;
  for (let i = 0; i < leaves; i++) {
    const t = 0.35 + (i / leaves) * 0.65;
    const at = curve.getPoint(t);
    const yaw = i * 2.39996 + rng.range(-0.2, 0.2);
    const len = rng.range(0.22, 0.32) * (1.1 - t * 0.25);
    const geo = leafGeometry(0, len, len * 0.8, rng.range(0.5, 1.1), rng.range(0.15, 0.3));
    placeLeaf(
      p,
      geo,
      leafTint(rng),
      at,
      yaw,
      rng.range(0.15, 0.75) + t * 0.3,
      rng.range(-0.5, 0.5),
    );
  }
}

/** Snake plant in a low planter. */
export function buildMediumPlant(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const rng = ctx.rng(inst);
  const soil = planter(p, ctx, 0.2, 0.36, 'powder', 'offWhite');
  swordLeaves(p, rng, soil, 14, 0.45, 0.88, 0.06);
}

function swordLeaves(
  p: PartList,
  rng: Rng,
  soil: number,
  count: number,
  minLen: number,
  maxLen: number,
  spread: number,
): void {
  for (let i = 0; i < count; i++) {
    const yaw = rng.range(0, Math.PI * 2);
    const r = rng.range(0, spread);
    const len = rng.range(minLen, maxLen);
    const geo = leafGeometry(2, len, len * 0.16, rng.range(0.05, 0.25), 0.3);
    placeLeaf(
      p,
      geo,
      leafTint(rng),
      new THREE.Vector3(Math.sin(yaw) * r, soil - 0.01, Math.cos(yaw) * r),
      yaw,
      rng.range(1.25, 1.52),
      rng.range(-0.8, 0.8),
    );
  }
}

/** Small potted plant for shelves: trailing pothos or a mini snake plant. */
export function potPlant(
  p: PartList,
  ctx: BuildContext,
  rng: Rng,
  at: readonly [number, number, number],
  scale: number,
  trailing: boolean,
): void {
  const r = 0.1 * scale;
  const h = 0.16 * scale;
  const [x, y, z] = at;
  p.lathe(
    `pot:${r.toFixed(3)}`,
    [
      [0.001, 0],
      [r * 0.8, 0],
      [r, h],
      [r * 0.9, h],
      [0.001, h * 0.9],
    ],
    'gloss',
    ctx.color(rng.pick(['offWhite', 'terracotta', 'charcoal']), 'offWhite'),
    [x, y, z],
  );
  if (!trailing) {
    for (let i = 0; i < 7; i++) {
      const yaw = rng.range(0, Math.PI * 2);
      const len = rng.range(0.18, 0.34) * scale * 1.6;
      placeLeaf(
        p,
        leafGeometry(2, len, len * 0.18, 0.1, 0.3),
        leafTint(rng),
        new THREE.Vector3(x + Math.sin(yaw) * 0.02, y + h * 0.9, z + Math.cos(yaw) * 0.02),
        yaw,
        rng.range(1.2, 1.5),
        rng.range(-0.6, 0.6),
      );
    }
    return;
  }
  const origin = new THREE.Vector3(x, y, z);
  for (let v = 0; v < 4; v++) {
    const yaw = Math.round(rng.range(-1.2, 1.2) * 10) / 10;
    const drop = Math.round(rng.range(0.15, 0.35) * 20) / 20;
    // Vine points are local to the pot so the cached tube can be reused at any position.
    const pts: [number, number, number][] = [
      [0, h, 0],
      [Math.sin(yaw) * 0.1, h + 0.02, Math.cos(yaw) * 0.12],
      [Math.sin(yaw) * 0.14, h - drop, Math.cos(yaw) * 0.18],
    ];
    p.tube(
      `vine:${h.toFixed(3)}:${yaw}:${drop}`,
      pts,
      0.003,
      'wood',
      ctx.color('#5E7A45', '#5E7A45'),
      [x, y, z],
      false,
      10,
    );
    const curve = new THREE.CatmullRomCurve3(pts.map(([a, b, c]) => new THREE.Vector3(a, b, c)));
    for (let k = 0; k < 5; k++) {
      const t = 0.2 + k * 0.18;
      const len = 0.07 * scale * 1.5;
      const at = curve.getPoint(t).add(origin);
      placeLeaf(
        p,
        leafGeometry(3, len, len * 0.85, 0.4, 0.2),
        leafTint(rng),
        at,
        yaw + rng.range(-1.2, 1.2),
        rng.range(-0.2, 0.5),
        rng.range(-0.5, 0.5),
      );
    }
  }
}

/** Floor lamp: stone base, slim stem and a glowing linen drum shade. */
export function buildFloorLamp(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const metal = ctx.color(inst.color, 'black');
  p.cylinder(
    0.16,
    0.165,
    0.025,
    'stone',
    ctx.color('offWhite', 'offWhite'),
    [0, 0.0125, 0],
    [0, 0, 0],
    40,
  );
  p.cylinder(0.011, 0.011, 1.42, 'powder', metal, [0, 0.735, 0], [0, 0, 0], 10);
  p.castShadow = false;
  p.latheShell(
    'floorlamp-shade',
    [
      [0.21, 1.3],
      [0.19, 1.62],
    ],
    0.004,
    'lamp',
    ctx.emissive(inst.accent, 'linen', 0.95),
    [0, 0, 0],
    ctx.emissive('warmWhite', 'warmWhite', 2.4),
  );
  p.plane(
    0.36,
    0.36,
    'lamp',
    ctx.emissive('warmWhite', 'warmWhite', 1.6),
    [0, 1.302, 0],
    [Math.PI / 2, 0, 0],
  );
  p.castShadow = true;
  p.torus(0.19, 0.003, 'powder', metal, [0, 1.62, 0], [Math.PI / 2, 0, 0]);
}

/** Flat-woven area rug with a bound border. */
export function buildRug(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 2.4);
  const d = paramNumber(inst, 'depth', 3.2);
  const field = ctx.color(inst.color, 'greige');
  const border = ctx.color(inst.accent, 'linen');
  p.castShadow = false;
  p.slab(w - 0.16, d - 0.16, 0.012, 0.01, 'carpet', field, [0, 0.006, 0], 0.003);
  for (const [bw, bd, x, z] of [
    [w, 0.08, 0, d / 2 - 0.04],
    [w, 0.08, 0, -d / 2 + 0.04],
    [0.08, d - 0.16, w / 2 - 0.04, 0],
    [0.08, d - 0.16, -w / 2 + 0.04, 0],
  ] as const) {
    p.box([bw, 0.013, bd], 'fabric', shade(border, 0.95), [x, 0.0065, z], 0.003);
  }
  p.castShadow = true;
}
