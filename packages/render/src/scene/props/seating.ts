import type { PropInstance } from '@huddle/shared';
import * as THREE from 'three';
import { geometryCache, type PartList } from '../../geometry/parts.ts';
import { shade, tint, WHITE, type BuildContext } from '../build-context.ts';

/**
 * Curved mesh back panel: a subdivided plane wrapped around the sitter (`curve` meters at the
 * edges). `flip` reverses the winding so the same surface faces backwards (single-sided materials).
 */
function backPanelGeometry(
  width: number,
  height: number,
  curve: number,
  flip: boolean,
): THREE.BufferGeometry {
  return geometryCache.get(`backpanel:${width}:${height}:${curve}:${flip ? 1 : 0}`, () => {
    const g = new THREE.PlaneGeometry(width, height, 10, 6);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (width / 2);
      const y = pos.getY(i) / (height / 2);
      // Wrap sideways and add a lumbar bulge in the lower third.
      const lumbar = Math.exp(-(((y + 0.35) / 0.35) ** 2)) * 0.025;
      pos.setZ(i, -curve * x * x + lumbar);
    }
    const index = g.getIndex();
    if (flip && index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, a);
      }
    }
    g.computeVertexNormals();
    return g;
  });
}

function backFramePoints(width: number, height: number, curve: number): [number, number, number][] {
  const w = width / 2;
  const h = height / 2;
  const pts: [number, number, number][] = [];
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Superellipse traces a soft rounded rectangle.
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 0.35) * w;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 0.35) * h;
    const xn = x / w;
    pts.push([x, y, -curve * xn * xn]);
  }
  return pts;
}

/** Ergonomic task chair: five-star aluminium base on casters, gas lift, upholstered seat, mesh back. */
export function buildOfficeChair(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const fabric = ctx.color(inst.color, 'charcoal');
  const metal = ctx.color(inst.accent, 'aluminum');
  const black = ctx.color('black', 'black');
  p.eulerOrder = 'YXZ';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    p.box([0.045, 0.026, 0.29], 'metal', metal, [dx * 0.165, 0.078, dz * 0.165], 0.011, [
      0.09,
      a,
      0,
    ]);
    p.box([0.034, 0.03, 0.04], 'plastic', black, [dx * 0.3, 0.058, dz * 0.3], 0.01, [0, a, 0]);
    p.cylinder(
      0.026,
      0.026,
      0.034,
      'rubber',
      black,
      [dx * 0.315, 0.027, dz * 0.315],
      [0, a + 0.6, Math.PI / 2],
      18,
    );
  }
  p.eulerOrder = 'XYZ';
  p.cylinder(0.045, 0.055, 0.05, 'metal', metal, [0, 0.085, 0], [0, 0, 0], 20);
  p.cylinder(0.034, 0.03, 0.14, 'plastic', black, [0, 0.175, 0], [0, 0, 0], 16);
  p.cylinder(
    0.022,
    0.022,
    0.16,
    'chrome',
    ctx.color('chrome', 'chrome'),
    [0, 0.32, 0],
    [0, 0, 0],
    16,
  );
  // Tilt mechanism and height lever.
  p.box([0.25, 0.05, 0.24], 'powder', black, [0, 0.395, -0.01], 0.012);
  p.box([0.015, 0.015, 0.12], 'powder', black, [0.15, 0.39, 0.04], 0.005);
  p.sphere(0.014, 'plastic', black, [0.15, 0.39, 0.1], [1, 1, 1], 10);
  // Seat shell and cushion with a waterfall front edge.
  p.slab(0.5, 0.47, 0.03, 0.1, 'plastic', black, [0, 0.428, 0.02], 0.006);
  p.slab(0.49, 0.46, 0.06, 0.11, 'fabric', fabric, [0, 0.47, 0.02], 0.022);
  p.slab(
    0.46,
    0.08,
    0.05,
    0.03,
    'fabric',
    shade(fabric, 0.92),
    [0, 0.47, 0.235],
    0.022,
    [0.35, 0, 0],
  );
  // Spine from the mechanism up behind the back.
  p.tube(
    'chair-spine',
    [
      [0, 0.4, -0.12],
      [0, 0.42, -0.25],
      [0, 0.52, -0.3],
      [0, 0.66, -0.3],
    ],
    0.02,
    'metal',
    metal,
    [0, 0, 0],
    false,
    20,
  );
  // Mesh back in a flexible frame, tilted slightly back.
  const back = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0.86, -0.3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  const frame = geometryCache.get('chair-back-frame', () => {
    const curve = new THREE.CatmullRomCurve3(
      backFramePoints(0.46, 0.56, 0.06).map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'centripetal',
    );
    return new THREE.TubeGeometry(curve, 72, 0.014, 8, true);
  });
  p.addMatrix(frame, 'plastic', black, back);
  p.addMatrix(
    backPanelGeometry(0.44, 0.54, 0.06, false),
    'fabric',
    tint(fabric, WHITE, 0.06),
    back.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.004)),
  );
  p.addMatrix(
    backPanelGeometry(0.44, 0.54, 0.06, true),
    'fabric',
    shade(fabric, 0.8),
    back.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.008)),
  );
  // Armrests: posts from the mechanism, padded tops.
  for (const side of [-1, 1]) {
    p.tube(
      `chair-arm-${side}`,
      [
        [side * 0.13, 0.4, -0.03],
        [side * 0.25, 0.43, -0.04],
        [side * 0.27, 0.53, -0.03],
        [side * 0.27, 0.64, -0.02],
      ],
      0.014,
      'powder',
      black,
      [0, 0, 0],
      false,
      16,
    );
    p.slab(0.075, 0.25, 0.028, 0.035, 'rubber', black, [side * 0.27, 0.655, 0.01], 0.008);
  }
}

/** Three-seat lounge sofa: upholstered base, loose seat and back cushions, slim metal legs. */
export function buildLoungeSofa(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const fabric = ctx.color(inst.color, 'slate');
  const leg = ctx.color(inst.accent, 'black');
  const W = 2.32;
  for (const [x, z] of [
    [-W / 2 + 0.1, 0.34],
    [W / 2 - 0.1, 0.34],
    [-W / 2 + 0.1, -0.34],
    [W / 2 - 0.1, -0.34],
  ] as const) {
    p.cylinder(0.018, 0.012, 0.1, 'powder', leg, [x, 0.05, z], [0, 0, 0], 12);
  }
  p.slab(W, 0.9, 0.2, 0.05, 'fabric', shade(fabric, 0.9), [0, 0.2, 0], 0.03);
  p.slab(W, 0.2, 0.52, 0.05, 'fabric', shade(fabric, 0.9), [0, 0.52, -0.35], 0.03, [0.06, 0, 0]);
  for (const side of [-1, 1])
    p.slab(
      0.16,
      0.9,
      0.36,
      0.05,
      'fabric',
      shade(fabric, 0.9),
      [side * (W / 2 - 0.08), 0.42, 0],
      0.035,
      [0, 0, 0],
    );
  const rng = ctx.rng(inst);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.68;
    p.slab(
      0.68,
      0.66,
      0.15,
      0.08,
      'fabric',
      tint(fabric, WHITE, 0.03 + rng.range(0, 0.02)),
      [x, 0.37, 0.07],
      0.05,
    );
    p.slab(0.66, 0.5, 0.17, 0.08, 'fabric', tint(fabric, WHITE, 0.04), [x, 0.64, -0.2], 0.05, [
      -Math.PI / 2 - 0.2,
      0,
      0,
    ]);
  }
  pillow(p, ctx.color('mustard', 'mustard'), [-0.78, 0.6, -0.08], 0.35);
  pillow(p, ctx.color('cream', 'cream'), [0.8, 0.6, -0.08], -0.3);
}

function pillow(p: PartList, color: THREE.Color, at: [number, number, number], lean: number): void {
  p.slab(0.42, 0.4, 0.13, 0.14, 'fabric', color, at, 0.05, [-Math.PI / 2 - 0.25, lean, 0]);
}

/** Mid-century lounge chair: oak splayed legs, upholstered shell with a tilted back. */
export function buildLoungeChair(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const fabric = ctx.color(inst.color, 'terracotta');
  const wood = ctx.color(inst.accent, 'oak');
  p.eulerOrder = 'YXZ';
  for (const [x, z] of [
    [0.3, 0.28],
    [-0.3, 0.28],
    [0.3, -0.26],
    [-0.3, -0.26],
  ] as const) {
    const a = Math.atan2(x, z);
    p.cylinder(0.018, 0.025, 0.26, 'wood', wood, [x, 0.12, z], [-0.14, a, 0], 12);
  }
  p.eulerOrder = 'XYZ';
  p.slab(0.8, 0.76, 0.1, 0.12, 'fabric', shade(fabric, 0.9), [0, 0.28, 0.01], 0.03);
  p.slab(0.68, 0.64, 0.12, 0.12, 'fabric', fabric, [0, 0.39, 0.05], 0.05);
  p.slab(0.8, 0.62, 0.14, 0.16, 'fabric', shade(fabric, 0.95), [0, 0.62, -0.31], 0.05, [
    -Math.PI / 2 - 0.26,
    0,
    0,
  ]);
  for (const side of [-1, 1]) {
    p.slab(0.09, 0.66, 0.24, 0.04, 'fabric', shade(fabric, 0.9), [side * 0.36, 0.44, 0], 0.035);
    p.slab(0.1, 0.5, 0.025, 0.04, 'wood', wood, [side * 0.36, 0.575, 0.05], 0.006);
  }
}

/** Counter stool: oak seat, splayed black legs and a foot ring. */
export function buildBarStool(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const seat = ctx.color(inst.color, 'oak');
  const metal = ctx.color(inst.accent, 'black');
  p.lathe(
    'stool-seat',
    [
      [0.001, 0],
      [0.17, 0],
      [0.19, 0.012],
      [0.195, 0.032],
      [0.18, 0.042],
      [0.001, 0.036],
    ],
    'wood',
    seat,
    [0, 0.728, 0],
    [1, 1, 1],
    40,
  );
  p.cylinder(0.12, 0.12, 0.02, 'powder', metal, [0, 0.718, 0], [0, 0, 0], 24);
  p.eulerOrder = 'YXZ';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.cylinder(
      0.011,
      0.011,
      0.74,
      'powder',
      metal,
      [Math.sin(a) * 0.15, 0.36, Math.cos(a) * 0.15],
      [-0.1, a, 0],
      10,
    );
    p.cylinder(
      0.014,
      0.014,
      0.012,
      'rubber',
      metal,
      [Math.sin(a) * 0.186, 0.006, Math.cos(a) * 0.186],
      [0, 0, 0],
      10,
    );
  }
  p.eulerOrder = 'XYZ';
  p.torus(0.165, 0.009, 'powder', metal, [0, 0.28, 0], [Math.PI / 2, 0, 0]);
}
