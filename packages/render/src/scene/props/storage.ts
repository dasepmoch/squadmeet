import type { PropInstance, Rng } from '@huddle/shared';
import type { PartList } from '../../geometry/parts.ts';
import { paramNumber, shade, type BuildContext } from '../build-context.ts';
import { potPlant } from './plants.ts';
import { cup } from './tabletop.ts';

const BOOK_COLORS = [
  'cream',
  'navy',
  'burgundy',
  'forest',
  'mustard',
  'slate',
  'black',
  'offWhite',
  'terracotta',
  'sage',
  'greige',
  '#2F3A4C',
  '#7A5C3E',
];

function bookRow(
  p: PartList,
  ctx: BuildContext,
  rng: Rng,
  x0: number,
  x1: number,
  y: number,
  maxH: number,
  depth: number,
): void {
  let x = x0;
  while (x < x1 - 0.02) {
    const bw = 0.018 + rng.next() * 0.035;
    if (x + bw > x1) break;
    const bh = Math.min(maxH, 0.17 + rng.next() * 0.12);
    const bd = depth * (0.72 + rng.next() * 0.2);
    const color = ctx.color(rng.pick(BOOK_COLORS), 'cream');
    p.box(
      [bw, bh, bd],
      'paper',
      shade(color, 0.9 + rng.next() * 0.15),
      [x + bw / 2, y + bh / 2, -depth / 2 + bd / 2 + 0.02],
      0.003,
    );
    x += bw + 0.002;
  }
}

/** Walnut shelving with books, box files, ceramics and a trailing plant. */
export function buildBookshelf(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const W = paramNumber(inst, 'width', 2.4);
  const D = paramNumber(inst, 'depth', 0.38);
  const H = paramNumber(inst, 'height', 2.05);
  const wood = ctx.color(inst.color, 'walnut');
  const rng = ctx.rng(inst);
  const t = 0.025;
  const bays = 3;
  const bw = (W - t) / bays;
  p.box([W, H, 0.012], 'wood', shade(wood, 0.7), [0, H / 2, -D / 2 + 0.006], 0.002);
  for (let i = 0; i <= bays; i++)
    p.box([t, H, D], 'wood', wood, [-W / 2 + t / 2 + i * bw, H / 2, 0], 0.003);
  const shelves = 5;
  const sh = (H - t) / shelves;
  for (let s = 0; s <= shelves; s++) p.box([W, t, D], 'wood', wood, [0, t / 2 + s * sh, 0], 0.003);
  p.box(
    [W - 0.04, 0.06, 0.02],
    'powder',
    ctx.color('black', 'black'),
    [0, 0.03, D / 2 - 0.02],
    0.002,
  );
  for (let s = 0; s < shelves; s++) {
    const y = t + s * sh;
    for (let b = 0; b < bays; b++) {
      const x0 = -W / 2 + t + b * bw + 0.02;
      const x1 = x0 + bw - t - 0.04;
      const roll = rng.next();
      if (s === 0 || roll < 0.45) {
        bookRow(p, ctx, rng, x0, roll < 0.2 ? (x0 + x1) / 2 : x1, y, sh - 0.04, D);
        if (roll < 0.2) decor(p, ctx, rng, (x0 + x1) / 2 + 0.12, y, D);
      } else if (roll < 0.62) {
        for (let k = 0; k < 4; k++) {
          const c = ctx.color(k % 2 === 0 ? 'cream' : 'greige', 'cream');
          p.box(
            [bw * 0.7, 0.032, D * 0.8],
            'paper',
            shade(c, 0.95 + k * 0.03),
            [(x0 + x1) / 2, y + 0.016 + k * 0.033, 0],
            0.003,
            [0, rng.range(-0.08, 0.08), 0],
          );
        }
        decor(p, ctx, rng, (x0 + x1) / 2, y + 0.135, D);
      } else if (roll < 0.78) {
        for (let k = 0; k < 3; k++) {
          p.box(
            [0.08, sh * 0.72, D * 0.82],
            'paper',
            ctx.color('offWhite', 'offWhite'),
            [x0 + 0.06 + k * 0.09, y + sh * 0.36, 0],
            0.004,
          );
          p.box(
            [0.05, 0.03, 0.002],
            'paper',
            ctx.color('charcoal', 'charcoal'),
            [x0 + 0.06 + k * 0.09, y + sh * 0.5, D * 0.41 + 0.001],
            0.001,
          );
        }
        decor(p, ctx, rng, x1 - 0.12, y, D);
      } else {
        potPlant(p, ctx, rng, [(x0 + x1) / 2, y, 0.02], 0.55, true);
      }
    }
  }
}

function decor(
  p: PartList,
  ctx: BuildContext,
  rng: Rng,
  x: number,
  y: number,
  depth: number,
): void {
  const kind = rng.int(0, 4);
  const z = depth * 0.05;
  if (kind === 0) {
    p.lathe(
      'vase-tall',
      [
        [0.001, 0],
        [0.05, 0.004],
        [0.065, 0.08],
        [0.045, 0.2],
        [0.03, 0.25],
        [0.034, 0.26],
      ],
      'gloss',
      ctx.color(rng.pick(['offWhite', 'sage', 'terracotta', 'charcoal']), 'offWhite'),
      [x, y, z],
    );
  } else if (kind === 1) {
    p.lathe(
      'bowl',
      [
        [0.001, 0],
        [0.05, 0.002],
        [0.1, 0.05],
        [0.105, 0.06],
        [0.095, 0.06],
        [0.045, 0.012],
        [0.001, 0.012],
      ],
      'gloss',
      ctx.color(rng.pick(['cream', 'greige', 'black']), 'cream'),
      [x, y, z],
    );
  } else if (kind === 2) {
    p.box(
      [0.14, 0.18, 0.012],
      'wood',
      ctx.color('black', 'black'),
      [x, y + 0.09, z - 0.02],
      0.002,
      [-0.12, rng.range(-0.3, 0.3), 0],
    );
    p.box(
      [0.11, 0.14, 0.002],
      'paper',
      ctx.color(rng.pick(['sky', 'blush', 'sage']), 'sky'),
      [x, y + 0.09, z - 0.012],
      0.0005,
      [-0.12, 0, 0],
    );
  } else {
    p.sphere(
      0.06,
      'gloss',
      ctx.color(rng.pick(['brass', 'terracotta', 'offWhite']), 'brass'),
      [x, y + 0.06, z],
      [1, 1, 1],
      20,
    );
  }
}

/** Objects styled along the top of a credenza: lamp, books, ceramics, a small plant. */
export function buildShelfDecor(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 3);
  const rng = ctx.rng(inst);
  // Table lamp (warm glow).
  const lx = -w / 2 + 0.3;
  p.lathe(
    'tlamp-base',
    [
      [0.001, 0],
      [0.09, 0],
      [0.1, 0.02],
      [0.06, 0.22],
      [0.02, 0.3],
      [0.001, 0.3],
    ],
    'gloss',
    ctx.color('greige', 'greige'),
    [lx, 0, 0],
  );
  p.cylinder(0.006, 0.006, 0.12, 'metal', ctx.color('brass', 'brass'), [lx, 0.35, 0], [0, 0, 0], 8);
  p.castShadow = false;
  p.latheShell(
    'tlamp-shade',
    [
      [0.17, 0.36],
      [0.12, 0.56],
    ],
    0.003,
    'lamp',
    ctx.emissive('warmWhite', 'warmWhite', 0.95),
    [lx, 0, 0],
    ctx.emissive('warmWhite', 'warmWhite', 2.2),
  );
  p.castShadow = true;
  bookRowFlat(p, ctx, rng, w * -0.05, 0.02);
  p.lathe(
    'vase-tall',
    [
      [0.001, 0],
      [0.05, 0.004],
      [0.065, 0.08],
      [0.045, 0.2],
      [0.03, 0.25],
      [0.034, 0.26],
    ],
    'gloss',
    ctx.color('terracotta', 'terracotta'),
    [w * 0.12, 0, 0.02],
  );
  const twig = ctx.color('#6A4B34', '#6A4B34');
  p.tube(
    'branch-a',
    [
      [0, 0.24, 0.02],
      [0.03, 0.45, 0.0],
      [0.1, 0.7, -0.02],
    ],
    0.004,
    'wood',
    twig,
    [w * 0.12, 0, 0],
    false,
    12,
  );
  p.tube(
    'branch-b',
    [
      [0, 0.24, 0.02],
      [-0.04, 0.5, 0.03],
      [-0.12, 0.64, 0.02],
    ],
    0.004,
    'wood',
    twig,
    [w * 0.12, 0, 0],
    false,
    12,
  );
  potPlant(p, ctx, rng, [w / 2 - 0.35, 0, 0.02], 0.5, false);
  cup(p, ctx, [w * 0.28, 0, 0.08], 'charcoal');
}

function bookRowFlat(p: PartList, ctx: BuildContext, rng: Rng, x: number, z: number): void {
  for (let k = 0; k < 4; k++) {
    const c = ctx.color(rng.pick(BOOK_COLORS), 'cream');
    p.box(
      [0.26 - k * 0.02, 0.035, 0.19 - k * 0.01],
      'paper',
      c,
      [x + rng.range(-0.01, 0.01), 0.018 + k * 0.035, z],
      0.003,
      [0, rng.range(-0.1, 0.1), 0],
    );
  }
  p.sphere(0.035, 'metal', ctx.color('brass', 'brass'), [x, 0.175, z], [1, 1, 1], 16);
}
