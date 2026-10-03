import type { PropInstance } from '@huddle/shared';
import * as THREE from 'three';
import { geometryCache, type PartList } from '../../geometry/parts.ts';
import { paramNumber, shade, type BuildContext } from '../build-context.ts';
import { cup } from './tabletop.ts';

/** Kitchenette: lacquered cabinets, quartz top and splashback, espresso machine, sink, shelf. */
export function buildCoffeeBar(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 4);
  const d = paramNumber(inst, 'depth', 0.64);
  const h = paramNumber(inst, 'height', 0.92);
  const body = ctx.color(inst.color, 'offWhite');
  const wood = ctx.color(inst.accent, 'oak');
  const quartz = ctx.color('white', 'white');
  const steel = ctx.color('aluminum', 'aluminum');
  const black = ctx.color('black', 'black');
  p.box([w, 0.1, d - 0.08], 'powder', ctx.color('charcoal', 'charcoal'), [0, 0.05, -0.04], 0.003);
  const bodyH = h - 0.1 - 0.03;
  p.box([w, bodyH, d - 0.04], 'powder', body, [0, 0.1 + bodyH / 2, -0.02], 0.003);
  const fronts = Math.round(w / 0.6);
  const fw = w / fronts;
  for (let i = 0; i < fronts; i++) {
    const x = -w / 2 + fw * (i + 0.5);
    const drawers = i === 1;
    if (drawers) {
      for (let k = 0; k < 3; k++) {
        const dh = bodyH / 3;
        p.box(
          [fw - 0.004, dh - 0.004, 0.018],
          'powder',
          body,
          [x, 0.1 + dh * (k + 0.5), d / 2 - 0.02],
          0.002,
        );
      }
    } else {
      p.box(
        [fw - 0.004, bodyH - 0.004, 0.018],
        'powder',
        body,
        [x, 0.1 + bodyH / 2, d / 2 - 0.02],
        0.002,
      );
    }
    p.box([fw * 0.5, 0.01, 0.01], 'metal', steel, [x, 0.1 + bodyH - 0.035, d / 2 - 0.004], 0.003);
  }
  p.slab(w + 0.02, d + 0.02, 0.03, 0.004, 'stone', quartz, [0, h - 0.015, 0], 0.002);
  p.box([w, 0.56, 0.018], 'stone', quartz, [0, h + 0.28, -d / 2 + 0.009], 0.002);
  // Floating oak shelf with cups.
  p.box([w * 0.55, 0.035, 0.26], 'wood', wood, [-w * 0.16, h + 0.9, -d / 2 + 0.13], 0.004);
  for (let i = 0; i < 6; i++)
    cup(
      p,
      ctx,
      [-w * 0.16 - 0.5 + i * 0.2, h + 0.918, -d / 2 + 0.14],
      i % 3 === 0 ? 'sage' : 'offWhite',
    );
  espressoMachine(p, ctx, [-0.75, h, -0.05], steel, black);
  // Grinder.
  p.box([0.16, 0.26, 0.22], 'powder', black, [-0.36, h + 0.13, -0.08], 0.02);
  p.lathe(
    'grinder-hopper',
    [
      [0.03, 0],
      [0.07, 0.12],
      [0.075, 0.16],
    ],
    'glass',
    ctx.color('white', 'white'),
    [-0.36, h + 0.26, -0.08],
  );
  p.cylinder(
    0.05,
    0.035,
    0.07,
    'soil',
    ctx.color('#3B2417', '#3B2417'),
    [-0.36, h + 0.3, -0.08],
    [0, 0, 0],
    16,
  );
  // Undermount sink with a gooseneck tap.
  p.slab(0.48, 0.38, 0.004, 0.03, 'metal', shade(steel, 0.7), [0.45, h + 0.0005, 0.02], 0.001);
  p.tube(
    'tap',
    [
      [0, 0, -0.22],
      [0, 0.3, -0.21],
      [0, 0.34, -0.12],
      [0, 0.27, -0.05],
    ],
    0.012,
    'chrome',
    ctx.color('chrome', 'chrome'),
    [0.45, h, 0],
    false,
    20,
  );
  // Fruit bowl.
  p.lathe(
    'fruit-bowl',
    [
      [0.001, 0],
      [0.06, 0.004],
      [0.15, 0.07],
      [0.155, 0.08],
      [0.145, 0.08],
      [0.058, 0.014],
      [0.001, 0.014],
    ],
    'wood',
    wood,
    [1.0, h, 0.02],
  );
  const fruit = ['#D8342A', '#E8A33D', '#9EBB3E', '#D8342A', '#E8A33D'];
  fruit.forEach((c, i) =>
    p.sphere(
      0.042,
      'gloss',
      ctx.color(c, c),
      [
        1.0 + Math.cos(i * 1.3) * 0.07,
        h + 0.06 + (i === 4 ? 0.05 : 0),
        0.02 + Math.sin(i * 1.3) * 0.07,
      ],
      [1, 0.95, 1],
      14,
    ),
  );
  // Water dispenser tower.
  p.box([0.3, 0.5, 0.34], 'metal', steel, [1.45, h + 0.25, -0.1], 0.02);
  p.box([0.2, 0.16, 0.012], 'gloss', black, [1.45, h + 0.34, 0.075], 0.004);
  p.castShadow = false;
  p.box(
    [0.03, 0.012, 0.002],
    'emissive',
    ctx.emissive('#4FB7FF', '#4FB7FF', 2),
    [1.45, h + 0.4, 0.082],
    0.001,
  );
  p.castShadow = true;
  p.box([0.2, 0.012, 0.12], 'metal', shade(steel, 0.8), [1.45, h + 0.04, 0.08], 0.003);
  p.cylinder(
    0.012,
    0.012,
    0.04,
    'chrome',
    ctx.color('chrome', 'chrome'),
    [1.45, h + 0.24, 0.1],
    [0, 0, 0],
    10,
  );
}

function espressoMachine(
  p: PartList,
  ctx: BuildContext,
  at: readonly [number, number, number],
  steel: THREE.Color,
  black: THREE.Color,
): void {
  const [x, y, z] = at;
  p.box([0.38, 0.4, 0.42], 'metal', steel, [x, y + 0.2, z], 0.025);
  p.box([0.36, 0.02, 0.28], 'metal', shade(steel, 0.8), [x, y + 0.41, z - 0.04], 0.004);
  for (const dx of [-0.08, 0.08]) cup(p, ctx, [x + dx, y + 0.42, z - 0.04], 'white');
  p.box([0.34, 0.03, 0.14], 'metal', shade(steel, 0.75), [x, y + 0.03, z + 0.22], 0.006);
  p.cylinder(
    0.04,
    0.04,
    0.05,
    'chrome',
    ctx.color('chrome', 'chrome'),
    [x, y + 0.26, z + 0.23],
    [0, 0, 0],
    20,
  );
  p.box([0.03, 0.025, 0.16], 'plastic', black, [x, y + 0.23, z + 0.32], 0.01);
  p.box([0.2, 0.06, 0.004], 'gloss', black, [x, y + 0.34, z + 0.211], 0.003);
  p.castShadow = false;
  p.box(
    [0.05, 0.02, 0.001],
    'emissive',
    ctx.emissive('#E9F1FF', '#E9F1FF', 1.6),
    [x - 0.05, y + 0.345, z + 0.214],
    0.0004,
  );
  p.castShadow = true;
  cup(p, ctx, [x, y + 0.045, z + 0.22], 'offWhite');
}

/** Waste bin: hollow powder-coated shell with a crumpled paper ball inside. */
export function buildTrashBin(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const c = ctx.color(inst.color, 'graphite');
  p.latheShell(
    'bin',
    [
      [0.14, 0],
      [0.165, 0.38],
    ],
    0.006,
    'powder',
    c,
    [0, 0, 0],
    shade(c, 0.6),
  );
  p.cylinder(0.14, 0.14, 0.008, 'powder', shade(c, 0.6), [0, 0.004, 0], [0, 0, 0], 32);
  p.torus(0.162, 0.006, 'powder', c, [0, 0.38, 0], [Math.PI / 2, 0, 0]);
  const ball = geometryCache.get('paper-ball', () => new THREE.IcosahedronGeometry(0.05, 1));
  p.add(
    ball,
    'paper',
    ctx.color('paper', 'white'),
    [0.03, 0.055, -0.02],
    [0.4, 0.8, 0.1],
    [1, 0.85, 1.1],
  );
}
