import type { PropInstance } from '@huddle/shared';
import * as THREE from 'three';
import { geometryCache, type PartList } from '../../geometry/parts.ts';
import { shade, type BuildContext } from '../build-context.ts';

/** Per-seat table items: laptop / notebook / tablet plus a drink, deterministic per prop id. */
export function buildDeskSetup(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const rng = ctx.rng(inst);
  const variant = inst.variant ?? 'laptop';
  if (variant === 'laptop')
    laptop(p, ctx, [rng.range(-0.05, 0.05), 0, -0.05], rng.range(-0.12, 0.12));
  else if (variant === 'tablet') {
    const a = rng.range(-0.3, 0.3);
    p.slab(
      0.25,
      0.175,
      0.007,
      0.012,
      'gloss',
      ctx.color('black', 'black'),
      [0, 0.0035, 0.02],
      0.002,
      [0, a, 0],
    );
    p.castShadow = false;
    p.slab(
      0.23,
      0.155,
      0.001,
      0.008,
      'emissive',
      ctx.emissive('#26324A', '#26324A', 0.9),
      [0, 0.0076, 0.02],
      0.0003,
      [0, a, 0],
    );
    p.castShadow = true;
  } else {
    notebook(
      p,
      ctx,
      [0, 0, 0.03],
      rng.range(-0.25, 0.25),
      rng.pick(['navy', 'black', 'terracotta', 'forest']),
    );
  }
  const side = rng.next() < 0.5 ? -1 : 1;
  if (rng.next() < 0.55)
    cup(p, ctx, [side * 0.26, 0, 0.1], rng.pick(['offWhite', 'charcoal', 'sage']));
  else waterGlass(p, ctx, [side * 0.25, 0, 0.08]);
  if (rng.next() < 0.5) {
    p.slab(
      0.072,
      0.147,
      0.008,
      0.009,
      'gloss',
      ctx.color('black', 'black'),
      [-side * 0.25, 0.004, 0.12],
      0.002,
      [0, rng.range(-0.5, 0.5), 0],
    );
  }
  if (variant !== 'notebook' && rng.next() < 0.6)
    notebook(p, ctx, [-side * 0.3, 0, -0.06], rng.range(-0.3, 0.3), 'offWhite');
}

/** Table centerpieces: conference speakerphone or a water carafe with glasses. */
export function buildTableCenter(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  if (inst.variant === 'phone') {
    const body = ctx.color('graphite', 'graphite');
    p.cylinder(0.125, 0.135, 0.032, 'plastic', body, [0, 0.016, 0], [0, 0, 0], 48);
    p.cylinder(
      0.105,
      0.105,
      0.004,
      'fabric',
      ctx.color('black', 'black'),
      [0, 0.034, 0],
      [0, 0, 0],
      48,
    );
    p.castShadow = false;
    p.torus(
      0.113,
      0.0025,
      'emissive',
      ctx.emissive('#3CD6A0', '#3CD6A0', 1.4),
      [0, 0.033, 0],
      [Math.PI / 2, 0, 0],
    );
    p.castShadow = true;
    p.cylinder(0.025, 0.025, 0.006, 'gloss', body, [0, 0.037, 0], [0, 0, 0], 24);
    p.tube(
      'phone-cable',
      [
        [0, 0.004, -0.13],
        [0.05, 0.003, -0.3],
        [0.0, 0.003, -0.55],
        [0, 0.003, -0.8],
      ],
      0.0035,
      'rubber',
      ctx.color('black', 'black'),
      [0, 0, 0],
      false,
      24,
    );
    return;
  }
  p.slab(0.42, 0.18, 0.012, 0.04, 'wood', ctx.color('oak', 'oak'), [0, 0.006, 0], 0.003);
  p.latheShell(
    'carafe',
    [
      [0.06, 0],
      [0.065, 0.02],
      [0.062, 0.14],
      [0.035, 0.2],
      [0.03, 0.25],
      [0.034, 0.26],
    ],
    0.003,
    'glass',
    ctx.color('white', 'white'),
    [-0.12, 0.012, 0],
  );
  p.lathe(
    'carafe-water',
    [
      [0.001, 0],
      [0.058, 0.004],
      [0.059, 0.12],
      [0.001, 0.12],
    ],
    'glass',
    ctx.color('#BFE3F5', '#BFE3F5'),
    [-0.12, 0.014, 0],
  );
  for (const x of [0.02, 0.1, 0.18]) waterGlass(p, ctx, [x, 0.012, 0.02]);
}

function laptop(
  p: PartList,
  ctx: BuildContext,
  at: readonly [number, number, number],
  yaw: number,
): void {
  const alu = ctx.color('aluminum', 'aluminum');
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  const local: [
    string,
    THREE.BufferGeometry,
    'metal' | 'plastic' | 'emissive',
    THREE.Color,
    THREE.Matrix4,
  ][] = [];
  const slabGeo = (key: string, w: number, d: number, t: number): THREE.BufferGeometry =>
    geometryCache.get(`lap:${key}`, () => new THREE.BoxGeometry(w, t, d));
  const tilt = 0.28;
  const hingeZ = -0.1;
  const lid = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.012 + Math.cos(tilt) * 0.105, hingeZ - Math.sin(tilt) * 0.105),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  local.push([
    'base',
    slabGeo('base', 0.31, 0.215, 0.012),
    'metal',
    alu,
    new THREE.Matrix4().makeTranslation(0, 0.006, 0.0075),
  ]);
  local.push([
    'keys',
    slabGeo('keys', 0.27, 0.1, 0.002),
    'plastic',
    ctx.color('black', 'black'),
    new THREE.Matrix4().makeTranslation(0, 0.0125, -0.02),
  ]);
  local.push([
    'pad',
    slabGeo('pad', 0.1, 0.065, 0.001),
    'metal',
    shade(alu, 0.9),
    new THREE.Matrix4().makeTranslation(0, 0.0125, 0.07),
  ]);
  local.push(['lid', slabGeo('lid', 0.31, 0.006, 0.21), 'metal', alu, lid]);
  const screen = lid.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0035));
  local.push([
    'screen',
    slabGeo('screen', 0.285, 0.001, 0.18),
    'emissive',
    ctx.emissive('#2A3650', '#2A3650', 1.0),
    screen,
  ]);
  for (const [, geo, mat, color, mm] of local) {
    if (mat === 'emissive') p.castShadow = false;
    p.addMatrix(geo, mat, color, m.clone().multiply(mm));
    p.castShadow = true;
  }
}

function notebook(
  p: PartList,
  ctx: BuildContext,
  at: readonly [number, number, number],
  yaw: number,
  cover: string,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  p.slab(
    0.15,
    0.21,
    0.012,
    0.008,
    'leather',
    ctx.color(cover, 'navy'),
    [at[0], at[1] + 0.006, at[2]],
    0.002,
    [0, yaw, 0],
  );
  // Elastic band along the cover, then a pen lying beside the notebook.
  p.box(
    [0.004, 0.002, 0.212],
    'rubber',
    ctx.color('black', 'black'),
    [at[0] + c * 0.05, at[1] + 0.0125, at[2] - s * 0.05],
    0.0005,
    [0, yaw, 0],
  );
  p.eulerOrder = 'YXZ';
  p.cylinder(
    0.0045,
    0.0045,
    0.14,
    'metal',
    ctx.color('charcoal', 'charcoal'),
    [at[0] + c * 0.105, at[1] + 0.0045, at[2] - s * 0.105],
    [Math.PI / 2, yaw + 0.25, 0],
    10,
  );
  p.eulerOrder = 'XYZ';
}

export function cup(
  p: PartList,
  ctx: BuildContext,
  at: readonly [number, number, number],
  color: string,
): void {
  const c = ctx.color(color, 'offWhite');
  p.latheShell(
    'cup',
    [
      [0.032, 0],
      [0.038, 0.01],
      [0.042, 0.085],
      [0.043, 0.09],
    ],
    0.003,
    'gloss',
    c,
    [at[0], at[1], at[2]],
  );
  p.cylinder(0.031, 0.031, 0.004, 'gloss', c, [at[0], at[1] + 0.002, at[2]], [0, 0, 0], 24);
  p.torus(0.02, 0.005, 'gloss', c, [at[0] + 0.048, at[1] + 0.05, at[2]], [0, 0, 0]);
  p.cylinder(
    0.038,
    0.038,
    0.002,
    'paint',
    ctx.color('#3B2417', '#3B2417'),
    [at[0], at[1] + 0.07, at[2]],
    [0, 0, 0],
    24,
  );
}

export function waterGlass(
  p: PartList,
  ctx: BuildContext,
  at: readonly [number, number, number],
): void {
  p.latheShell(
    'glass-tumbler',
    [
      [0.03, 0],
      [0.034, 0.11],
    ],
    0.002,
    'glass',
    ctx.color('white', 'white'),
    [at[0], at[1], at[2]],
  );
  p.cylinder(
    0.029,
    0.03,
    0.004,
    'glass',
    ctx.color('white', 'white'),
    [at[0], at[1] + 0.002, at[2]],
    [0, 0, 0],
    24,
  );
  p.cylinder(
    0.03,
    0.031,
    0.06,
    'glass',
    ctx.color('#CFE9F6', '#CFE9F6'),
    [at[0], at[1] + 0.035, at[2]],
    [0, 0, 0],
    24,
  );
}
