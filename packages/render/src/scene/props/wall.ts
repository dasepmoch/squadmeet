import type { PropInstance } from '@huddle/shared';
import * as THREE from 'three';
import { geometryCache, type PartList } from '../../geometry/parts.ts';
import {
  paramNumber,
  paramString,
  propMatrix,
  shade,
  tint,
  WHITE,
  type BuildContext,
} from '../build-context.ts';

/** Acoustic wall: vertical walnut slats over black felt, floor to ceiling. */
export function buildSlatWall(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 6);
  const h = paramNumber(inst, 'height', 3);
  const wood = ctx.color(inst.color, 'walnut');
  const felt = ctx.color(inst.accent, 'charcoal');
  p.box([w, h, 0.012], 'felt', shade(felt, 0.7), [0, h / 2, 0.006], 0.001);
  const pitch = 0.064;
  const n = Math.floor(w / pitch);
  const x0 = -((n - 1) * pitch) / 2;
  const rng = ctx.rng(inst);
  for (let i = 0; i < n; i++) {
    p.box(
      [0.028, h - 0.004, 0.022],
      'wood',
      shade(wood, 0.94 + rng.next() * 0.12),
      [x0 + i * pitch, h / 2, 0.023],
      0.001,
    );
  }
}

/** Felt acoustic tiles: honeycomb or staggered vertical stripes in two or three colors. */
export function buildFeltPanels(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 2.4);
  const h = paramNumber(inst, 'height', 1.2);
  const cy = paramNumber(inst, 'y', 1.6);
  const a = ctx.color(inst.color, 'slate');
  const b = ctx.color(inst.accent, 'sage');
  const colors = [a, b, tint(a, WHITE, 0.35)];
  const rng = ctx.rng(inst);
  if (paramString(inst, 'pattern', 'hex') === 'hex') {
    const r = 0.15;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);
    const cols = Math.floor(w / dx);
    const rows = Math.floor(h / dy);
    for (let c = 0; c < cols; c++) {
      for (let row = 0; row < rows; row++) {
        const x = -((cols - 1) * dx) / 2 + c * dx;
        const y = cy - ((rows - 1) * dy) / 2 + row * dy + (c % 2 === 1 ? dy / 2 : 0);
        if (rng.next() < 0.12 || Math.abs(y - cy) > h / 2) continue;
        const depth = 0.028 + (rng.next() < 0.25 ? 0.02 : 0);
        p.cylinder(
          r * 0.97,
          r * 0.97,
          depth,
          'felt',
          rng.pick(colors),
          [x, y, depth / 2],
          [Math.PI / 2, 0, 0],
          6,
        );
      }
    }
    return;
  }
  const n = Math.round(w / 0.3);
  for (let i = 0; i < n; i++) {
    const ph = h * (0.72 + rng.next() * 0.28);
    const x = -w / 2 + (i + 0.5) * (w / n);
    p.box(
      [w / n - 0.03, ph, 0.03],
      'felt',
      colors[i % 3] ?? a,
      [x, cy - h / 2 + ph / 2 + (i % 2) * h * 0.04, 0.015],
      0.012,
    );
  }
}

const ART_COLORS = [
  'terracotta',
  'mustard',
  'navy',
  'sage',
  'blush',
  'charcoal',
  'teal',
  'cream',
  'forest',
];

/** Framed abstract print, composed from flat shapes (deterministic from `seed`). */
export function buildArtFrame(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 1);
  const h = paramNumber(inst, 'height', 1.3);
  const y = paramNumber(inst, 'y', 1.6);
  const rng = ctx.rng(inst);
  const frame = ctx.color(rng.next() < 0.5 ? 'black' : 'oak', 'black');
  const f = 0.025;
  for (const [bw, bh, x, yy] of [
    [w, f, 0, y + h / 2 - f / 2],
    [w, f, 0, y - h / 2 + f / 2],
    [f, h, -w / 2 + f / 2, y],
    [f, h, w / 2 - f / 2, y],
  ] as const) {
    p.box([bw, bh, 0.035], rng.seed % 2 === 0 ? 'powder' : 'wood', frame, [x, yy, 0.0175], 0.003);
  }
  p.plane(w - 2 * f, h - 2 * f, 'paper', ctx.color('offWhite', 'offWhite'), [0, y, 0.012]);
  const aw = w - 0.24;
  const ah = h - 0.24;
  p.plane(aw, ah, 'paper', ctx.color(rng.pick(['cream', 'linen', 'offWhite']), 'cream'), [
    0,
    y,
    0.0125,
  ]);
  p.castShadow = false;
  const shapes = 4 + rng.int(0, 3);
  for (let i = 0; i < shapes; i++) {
    const color = ctx.color(rng.pick(ART_COLORS), 'terracotta');
    const z = 0.013 + i * 0.0004;
    const sx = rng.range(-aw * 0.28, aw * 0.28);
    const sy = y + rng.range(-ah * 0.3, ah * 0.3);
    const kind = rng.int(0, 3);
    const size = Math.min(aw, ah) * rng.range(0.22, 0.5);
    if (kind === 0) {
      const g = geometryCache.get(
        `art-circle:${size.toFixed(3)}`,
        () => new THREE.CircleGeometry(size / 2, 48),
      );
      p.add(g, 'paper', color, [sx, sy, z]);
    } else if (kind === 1) {
      const g = geometryCache.get(
        `art-half:${size.toFixed(3)}`,
        () => new THREE.CircleGeometry(size / 2, 32, 0, Math.PI),
      );
      p.add(g, 'paper', color, [sx, sy, z], [0, 0, rng.int(0, 4) * (Math.PI / 2)]);
    } else {
      p.plane(
        Math.min(aw, size * rng.range(0.5, 1.4)),
        Math.min(ah, size * rng.range(0.4, 1.2)),
        'paper',
        color,
        [sx * 0.6, sy, z],
      );
    }
  }
  p.castShadow = true;
}

/** Round wall clock whose hands follow real wall-clock time. */
export function buildWallClock(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const y = paramNumber(inst, 'y', 2.1);
  const r = 0.19;
  p.torus(r, 0.012, 'powder', ctx.color('black', 'black'), [0, y, 0.03]);
  p.cylinder(
    r - 0.004,
    r - 0.004,
    0.012,
    'paper',
    ctx.color('offWhite', 'offWhite'),
    [0, y, 0.022],
    [Math.PI / 2, 0, 0],
    48,
  );
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const long = i % 3 === 0;
    p.box(
      [long ? 0.008 : 0.004, long ? 0.03 : 0.018, 0.002],
      'powder',
      ctx.color('black', 'black'),
      [Math.sin(a) * 0.155, y + Math.cos(a) * 0.155, 0.029],
      0.0005,
      [0, 0, -a],
    );
  }
  const hands = new THREE.Group();
  hands.name = `clock:${inst.id}`;
  const black = new THREE.MeshStandardMaterial({
    color: ctx.color('black', 'black'),
    roughness: 0.5,
  });
  const red = new THREE.MeshStandardMaterial({
    color: ctx.color('tomato', 'tomato'),
    roughness: 0.4,
  });
  const hand = (len: number, width: number, material: THREE.Material, z: number): THREE.Mesh => {
    const g = new THREE.BoxGeometry(width, len, 0.003);
    g.translate(0, len / 2 - 0.02, 0);
    const m = new THREE.Mesh(g, material);
    m.position.set(0, y, z);
    m.castShadow = true;
    hands.add(m);
    return m;
  };
  const hour = hand(0.1, 0.009, black, 0.031);
  const minute = hand(0.145, 0.006, black, 0.034);
  const second = hand(0.16, 0.0025, red, 0.037);
  hands.applyMatrix4(propMatrix(inst));
  ctx.addDynamic(hands, (_t, wallMs) => {
    const d = new Date(wallMs);
    const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const m = d.getMinutes() + s / 60;
    const hh = (d.getHours() % 12) + m / 60;
    second.rotation.z = -(s / 60) * Math.PI * 2;
    minute.rotation.z = -(m / 60) * Math.PI * 2;
    hour.rotation.z = -(hh / 12) * Math.PI * 2;
  });
}

/** Aluminium whiteboard frame and marker tray (the writable surface is a live canvas). */
export function buildWhiteboard(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 2.4);
  const h = paramNumber(inst, 'height', 1.2);
  const y = paramNumber(inst, 'y', 1.45);
  const alu = ctx.color('aluminum', 'aluminum');
  p.box([w, h, 0.03], 'paint', ctx.color('white', 'white'), [0, y, 0.015], 0.002);
  const f = 0.022;
  for (const [bw, bh, x, yy] of [
    [w + 2 * f, f, 0, y + h / 2 + f / 2],
    [w + 2 * f, f, 0, y - h / 2 - f / 2],
    [f, h, -w / 2 - f / 2, y],
    [f, h, w / 2 + f / 2, y],
  ] as const) {
    p.box([bw, bh, 0.05], 'metal', alu, [x, yy, 0.025], 0.006);
  }
  const trayY = y - h / 2 - f - 0.012;
  p.box([w * 0.55, 0.02, 0.07], 'metal', alu, [0, trayY, 0.035], 0.005);
  const markers = ['black', 'navy', 'tomato', 'forest'];
  markers.forEach((c, i) => {
    const x = -0.3 + i * 0.07;
    p.cylinder(
      0.009,
      0.009,
      0.12,
      'plastic',
      ctx.color('offWhite', 'offWhite'),
      [x, trayY + 0.019, 0.04],
      [0, 0, Math.PI / 2],
      12,
    );
    p.cylinder(
      0.0095,
      0.0095,
      0.03,
      'plastic',
      ctx.color(c, 'black'),
      [x + 0.06, trayY + 0.019, 0.04],
      [0, 0, Math.PI / 2],
      12,
    );
  });
  p.box([0.13, 0.03, 0.05], 'wood', ctx.color('oak', 'oak'), [0.25, trayY + 0.025, 0.04], 0.006);
  p.box(
    [0.13, 0.012, 0.05],
    'felt',
    ctx.color('charcoal', 'charcoal'),
    [0.25, trayY + 0.005, 0.04],
    0.003,
  );
}

/** Wall switch plate plus a smart scene keypad with glowing buttons. */
export function buildLightSwitch(_inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const white = ctx.color('offWhite', 'offWhite');
  p.box([0.086, 0.12, 0.008], 'plastic', white, [0, 1.2, 0.004], 0.004);
  for (const x of [-0.018, 0.018])
    p.box([0.03, 0.07, 0.006], 'plastic', shade(white, 0.95), [x, 1.2, 0.011], 0.003);
  p.box([0.09, 0.12, 0.012], 'gloss', ctx.color('black', 'black'), [0.13, 1.2, 0.006], 0.006);
  p.castShadow = false;
  for (let i = 0; i < 4; i++) {
    p.box(
      [0.05, 0.008, 0.001],
      'emissive',
      ctx.emissive(i === 0 ? 'neutralWhite' : '#7FA8FF', 'white', 1.2),
      [0.13, 1.24 - i * 0.026, 0.0125],
      0.0003,
    );
  }
  p.castShadow = true;
}

/** Presenter lectern: walnut body, slanted reading top and a gooseneck microphone. */
export function buildLectern(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const wood = ctx.color(inst.color, 'walnut');
  const metal = ctx.color(inst.accent, 'aluminum');
  p.slab(0.62, 0.46, 0.02, 0.03, 'powder', ctx.color('black', 'black'), [0, 0.01, 0], 0.004);
  p.box([0.56, 1.0, 0.38], 'wood', wood, [0, 0.52, 0], 0.01);
  p.box([0.566, 0.04, 0.386], 'metal', metal, [0, 0.9, 0], 0.004);
  p.slab(0.66, 0.48, 0.028, 0.02, 'woodGloss', wood, [0, 1.07, 0.01], 0.004, [-0.2, 0, 0]);
  p.box([0.6, 0.03, 0.02], 'metal', metal, [0, 1.03, -0.22], 0.006);
  p.tube(
    'lectern-gooseneck',
    [
      [0.2, 1.09, 0.15],
      [0.21, 1.25, 0.12],
      [0.16, 1.38, 0.02],
      [0.1, 1.42, -0.06],
    ],
    0.006,
    'powder',
    ctx.color('black', 'black'),
    [0, 0, 0],
    false,
    24,
  );
  p.capsule(
    0.012,
    0.05,
    'powder',
    ctx.color('black', 'black'),
    [0.09, 1.425, -0.08],
    [1.2, 0, 0.6],
  );
  p.castShadow = false;
  p.torus(
    0.0125,
    0.002,
    'emissive',
    ctx.emissive('tomato', 'tomato', 2.4),
    [0.2, 1.1, 0.15],
    [Math.PI / 2, 0, 0],
  );
  p.castShadow = true;
}
