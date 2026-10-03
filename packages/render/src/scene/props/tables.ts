import type { PropInstance } from '@huddle/shared';
import type { PartList } from '../../geometry/parts.ts';
import { paramNumber, shade, type BuildContext } from '../build-context.ts';
import { cup } from './tabletop.ts';

/** Boardroom table: walnut top on two powder-coated panel pedestals with flush cable ports. */
export function buildConferenceTable(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 1.6);
  const d = paramNumber(inst, 'depth', 6.4);
  const h = paramNumber(inst, 'height', 0.74);
  const wood = ctx.color(inst.color, 'walnut');
  const base = ctx.color(inst.accent, 'charcoal');
  const top = 0.045;
  p.slab(w, d, top, Math.min(0.5, w * 0.32), 'woodGloss', wood, [0, h - top / 2, 0], 0.008);
  // Recessed apron keeps a crisp shadow gap under the top.
  p.slab(w - 0.36, d - 0.6, 0.05, 0.25, 'powder', shade(base, 0.8), [0, h - top - 0.025, 0], 0.004);
  const pedestalZ = d / 2 - 1.05;
  for (const z of [-pedestalZ, pedestalZ]) {
    p.box(
      [w * 0.52, h - top - 0.07, 0.07],
      'powder',
      base,
      [0, (h - top - 0.07) / 2 + 0.02, z],
      0.012,
    );
    p.box([w * 0.6, 0.02, 0.36], 'powder', base, [0, 0.01, z], 0.006);
  }
  p.box([0.22, 0.12, pedestalZ * 2], 'powder', base, [0, h - top - 0.11, 0], 0.01);
  const alu = ctx.color('aluminum', 'aluminum');
  for (const z of [-d * 0.27, d * 0.27]) {
    p.slab(0.14, 0.36, 0.004, 0.02, 'metal', alu, [0, h + 0.001, z], 0.001);
    p.slab(
      0.1,
      0.3,
      0.002,
      0.012,
      'plastic',
      ctx.color('black', 'black'),
      [0, h + 0.003, z],
      0.0005,
    );
  }
}

/** Round lounge coffee table with splayed legs and a few magazines, a vase and a tray. */
export function buildCoffeeTable(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const topColor = ctx.color(inst.color, 'oak');
  const leg = ctx.color(inst.accent, 'black');
  const h = 0.42;
  p.cylinder(0.52, 0.52, 0.032, 'wood', topColor, [0, h - 0.016, 0], [0, 0, 0], 56);
  p.cylinder(0.5, 0.47, 0.018, 'wood', shade(topColor, 0.85), [0, h - 0.041, 0], [0, 0, 0], 56);
  p.eulerOrder = 'YXZ';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    p.cylinder(
      0.013,
      0.02,
      0.4,
      'powder',
      leg,
      [Math.sin(a) * 0.33, 0.19, Math.cos(a) * 0.33],
      [-0.12, a, 0],
      12,
    );
  }
  p.eulerOrder = 'XYZ';
  const rng = ctx.rng(inst);
  const mags = ['cream', 'navy', 'terracotta', 'offWhite'];
  for (let i = 0; i < 3; i++) {
    p.box(
      [0.23, 0.008, 0.3],
      'paper',
      ctx.color(mags[i % mags.length], 'cream'),
      [-0.18, h + 0.004 + i * 0.008, 0.05],
      0.002,
      [0, 0.2 + rng.range(-0.15, 0.15), 0],
    );
  }
  p.lathe(
    'vase-bud',
    [
      [0.001, 0],
      [0.05, 0.005],
      [0.06, 0.06],
      [0.03, 0.14],
      [0.022, 0.19],
      [0.028, 0.2],
    ],
    'gloss',
    ctx.color('sage', 'sage'),
    [0.22, h, -0.12],
  );
  p.slab(
    0.3,
    0.2,
    0.015,
    0.03,
    'wood',
    ctx.color('walnut', 'walnut'),
    [0.12, h + 0.0075, 0.2],
    0.003,
    [0, -0.3, 0],
  );
  for (const [x, z] of [
    [0.06, 0.2],
    [0.18, 0.18],
  ] as const)
    cup(p, ctx, [x, h + 0.015, z], 'offWhite');
}

/** Standing-height bistro table with a quartz top. */
export function buildBarTable(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const topColor = ctx.color(inst.color, 'white');
  const metal = ctx.color(inst.accent, 'black');
  p.cylinder(0.36, 0.36, 0.03, 'stone', topColor, [0, 1.045, 0], [0, 0, 0], 56);
  p.cylinder(0.09, 0.09, 0.02, 'powder', metal, [0, 1.02, 0], [0, 0, 0], 20);
  p.cylinder(0.032, 0.032, 1.0, 'powder', metal, [0, 0.52, 0], [0, 0, 0], 16);
  p.lathe(
    'bar-base',
    [
      [0.001, 0],
      [0.25, 0],
      [0.25, 0.012],
      [0.2, 0.03],
      [0.04, 0.04],
      [0.001, 0.04],
    ],
    'powder',
    metal,
    [0, 0, 0],
    [1, 1, 1],
    40,
  );
  p.lathe(
    'bud-glass',
    [
      [0.001, 0],
      [0.03, 0],
      [0.034, 0.08],
      [0.02, 0.12],
      [0.018, 0.13],
    ],
    'glass',
    ctx.color('white', 'white'),
    [0.12, 1.06, -0.06],
  );
  p.tube(
    'bar-stem',
    [
      [0.12, 1.07, -0.06],
      [0.125, 1.2, -0.055],
      [0.14, 1.31, -0.04],
    ],
    0.003,
    'rubber',
    ctx.color('forest', 'forest'),
    [0, 0, 0],
    false,
    12,
  );
  p.sphere(0.022, 'fabric', ctx.color('mustard', 'mustard'), [0.14, 1.32, -0.04], [1, 0.8, 1], 12);
}

/** Low cabinet: veneered carcass, doors with shadow reveals, slim handles and an inset plinth. */
export function buildCredenza(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 2);
  const d = paramNumber(inst, 'depth', 0.45);
  const h = paramNumber(inst, 'height', 0.7);
  const wood = ctx.color(inst.color, 'walnut');
  const dark = ctx.color(inst.accent, 'charcoal');
  const plinth = 0.07;
  p.box([w - 0.08, plinth, d - 0.08], 'powder', dark, [0, plinth / 2, -0.02], 0.004);
  const bodyH = h - plinth - 0.028;
  p.box([w, bodyH, d - 0.02], 'wood', wood, [0, plinth + bodyH / 2, -0.01], 0.004);
  p.slab(w + 0.012, d + 0.008, 0.028, 0.006, 'woodGloss', wood, [0, h - 0.014, 0], 0.003);
  const doors = Math.max(2, Math.round(w / 0.55));
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    p.box(
      [dw - 0.006, bodyH - 0.012, 0.018],
      'wood',
      shade(wood, 0.96 + (i % 2) * 0.06),
      [x, plinth + bodyH / 2, d / 2 - 0.01],
      0.002,
    );
    const hx = x + (i % 2 === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05);
    p.box(
      [0.012, 0.16, 0.012],
      'metal',
      ctx.color('brass', 'brass'),
      [hx, plinth + bodyH - 0.12, d / 2 + 0.006],
      0.004,
    );
  }
  for (let i = 1; i < doors; i++) {
    p.box(
      [0.004, bodyH - 0.01, 0.004],
      'powder',
      ctx.color('black', 'black'),
      [-w / 2 + dw * i, plinth + bodyH / 2, d / 2 - 0.018],
      0.001,
    );
  }
}
