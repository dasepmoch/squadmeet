import { WALLS, type ResolvedRoom, type WallSide } from '@huddle/shared';
import * as THREE from 'three';
import { PartList } from '../geometry/parts.ts';
import { borderGlowGeometry, gradientQuadGeometry } from '../geometry/shapes.ts';
import { layoutStrokeText } from '../geometry/stroke-font.ts';
import { shade, type BuildContext } from './build-context.ts';

/** Architecture split into groups the renderer can hide for cutaway views. */
export interface ArchitectureParts {
  floor: PartList;
  /** Full-height walls with their trim, per side. */
  walls: Record<WallSide, PartList>;
  /** Knee-high wall stubs shown while the full wall is cut away. */
  stubs: Record<WallSide, PartList>;
  /** Ceiling slab, tray and LED cove. */
  ceiling: PartList;
}

const STUB_HEIGHT = 0.42;
const BASEBOARD_H = 0.08;

interface WallFrame {
  /** Inward normal (into the room). */
  nx: number;
  nz: number;
  /** Tangent along the wall (x for north/south walls, z for east/west). */
  tx: number;
  tz: number;
  /** Distance from the room center to the inner face. */
  offset: number;
  length: number;
  /** Yaw that makes local +Z face into the room. */
  yaw: number;
}

export function wallFrame(side: WallSide, width: number, depth: number): WallFrame {
  switch (side) {
    case 'north':
      return { nx: 0, nz: 1, tx: 1, tz: 0, offset: depth / 2, length: width, yaw: 0 };
    case 'south':
      return { nx: 0, nz: -1, tx: 1, tz: 0, offset: depth / 2, length: width, yaw: Math.PI };
    case 'east':
      return { nx: -1, nz: 0, tx: 0, tz: 1, offset: width / 2, length: depth, yaw: -Math.PI / 2 };
    case 'west':
      return { nx: 1, nz: 0, tx: 0, tz: 1, offset: width / 2, length: depth, yaw: Math.PI / 2 };
  }
}

/** World position `along` the wall tangent, `out` meters in front of the inner face, height `y`. */
function onWall(f: WallFrame, along: number, out: number, y: number): [number, number, number] {
  const d = f.offset - out;
  return [-f.nx * d + f.tx * along, y, -f.nz * d + f.tz * along];
}

function wallBox(
  f: WallFrame,
  along: number,
  len: number,
  height: number,
  depth: number,
  y: number,
  out: number,
): { size: [number, number, number]; pos: [number, number, number] } {
  const size: [number, number, number] = f.tx !== 0 ? [len, height, depth] : [depth, height, len];
  return { size, pos: onWall(f, along, out + depth / 2, y) };
}

export function buildArchitecture(room: ResolvedRoom, ctx: BuildContext): ArchitectureParts {
  const a = room.data.architecture;
  const t = a.wallThickness;
  const H = a.height;
  const floor = new PartList();
  floor.castShadow = false;
  floor.plane(
    a.width,
    a.depth,
    'carpet',
    ctx.color(a.floorColor, 'graphite'),
    [0, 0, 0],
    [-Math.PI / 2, 0, 0],
  );

  const walls = {} as Record<WallSide, PartList>;
  const stubs = {} as Record<WallSide, PartList>;
  const base = ctx.color(a.baseboardColor, 'charcoal');
  for (const side of WALLS) {
    const f = wallFrame(side, a.width, a.depth);
    const color = ctx.color(a.wallColors[side], 'offWhite');
    const full = new PartList();
    const stub = new PartList();
    const len = f.tx !== 0 ? a.width + 2 * t : a.depth;
    const w = wallBox(f, 0, len, H, t, H / 2, -t);
    full.box(w.size, 'paint', color, w.pos, 0.001);
    const s = wallBox(f, 0, len, STUB_HEIGHT, t, STUB_HEIGHT / 2, -t);
    stub.box(s.size, 'paint', color, s.pos, 0.001);
    // Section cap: the cut top of the wall reads as a dark architectural poche.
    const cap = wallBox(f, 0, len, 0.012, t + 0.004, STUB_HEIGHT + 0.006, -t - 0.002);
    stub.box(cap.size, 'powder', ctx.color('charcoal', 'charcoal'), cap.pos, 0.001);
    const doors = a.doors.filter((d) => d.wall === side);
    for (const list of [full, stub]) addBaseboards(list, f, doors, base);
    for (const d of doors)
      buildDoor(full, ctx, f, d.offset, d.width, d.height, ctx.color(d.color, 'walnut'));
    addOutlets(
      full,
      ctx,
      f,
      side,
      doors.map((d) => d.offset),
    );
    walls[side] = full;
    stubs[side] = stub;
  }
  return { floor, walls, stubs, ceiling: buildCeiling(room, ctx) };
}

function addBaseboards(
  p: PartList,
  f: WallFrame,
  doors: readonly { offset: number; width: number }[],
  color: THREE.Color,
): void {
  const half = f.length / 2;
  const cuts = doors
    .map((d) => [d.offset - d.width / 2 - 0.07, d.offset + d.width / 2 + 0.07] as const)
    .sort((x, y) => x[0] - y[0]);
  let start = -half;
  for (const [c0, c1] of [...cuts, [half, half] as const]) {
    const len = c0 - start;
    if (len > 0.02) {
      const b = wallBox(f, start + len / 2, len, BASEBOARD_H, 0.014, BASEBOARD_H / 2, 0);
      p.box(b.size, 'powder', color, b.pos, 0.003);
    }
    start = c1;
  }
}

/** Closed walnut door with an aluminium frame, lever handle, kick plate, closer and exit sign. */
function buildDoor(
  p: PartList,
  ctx: BuildContext,
  f: WallFrame,
  along: number,
  width: number,
  height: number,
  wood: THREE.Color,
): void {
  const frame = ctx.color('graphite', 'graphite');
  const steel = ctx.color('aluminum', 'aluminum');
  const leaf = wallBox(
    f,
    along,
    width - 0.02,
    height - 0.012,
    0.045,
    (height - 0.012) / 2 + 0.006,
    0.002,
  );
  p.box(leaf.size, 'wood', wood, leaf.pos, 0.004);
  for (const side of [-1, 1]) {
    const jamb = wallBox(
      f,
      along + side * (width / 2 + 0.03),
      0.06,
      height + 0.06,
      0.03,
      (height + 0.06) / 2,
      0,
    );
    p.box(jamb.size, 'powder', frame, jamb.pos, 0.004);
  }
  const head = wallBox(f, along, width + 0.12, 0.06, 0.03, height + 0.03, 0);
  p.box(head.size, 'powder', frame, head.pos, 0.004);
  const kick = wallBox(f, along, width - 0.12, 0.2, 0.003, 0.13, 0.047);
  p.box(kick.size, 'metal', steel, kick.pos, 0.001);
  // Lever handle on the latch side.
  const latch = along + width / 2 - 0.09;
  p.cylinder(0.026, 0.026, 0.012, 'metal', steel, onWall(f, latch, 0.053, 1.04), rotToWall(f), 20);
  const lever = wallBox(f, latch - 0.06, 0.13, 0.018, 0.02, 1.04, 0.058);
  p.box(lever.size, 'metal', steel, lever.pos, 0.008);
  const closer = wallBox(f, along - width / 2 + 0.25, 0.3, 0.05, 0.05, height - 0.06, 0.047);
  p.box(closer.size, 'powder', ctx.color('aluminum', 'aluminum'), closer.pos, 0.01);
  buildExitSign(p, ctx, f, along, height + 0.28);
}

/** Rotation that turns a Y-axis cylinder to point out of the wall. */
function rotToWall(f: WallFrame): [number, number, number] {
  return f.tx !== 0 ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2];
}

function buildExitSign(
  p: PartList,
  ctx: BuildContext,
  f: WallFrame,
  along: number,
  y: number,
): void {
  const body = wallBox(f, along, 0.38, 0.16, 0.05, y, 0);
  p.box(body.size, 'powder', ctx.color('offWhite', 'offWhite'), body.pos, 0.008);
  p.castShadow = false;
  const face = wallBox(f, along, 0.34, 0.12, 0.002, y, 0.05);
  p.box(face.size, 'emissive', ctx.emissive('#18A957', '#18A957', 1.6), face.pos, 0.001);
  const text = layoutStrokeText('EXIT');
  const s = 0.012;
  const x0 = -text.width * s * 0.5;
  const white = ctx.emissive('white', 'white', 2.2);
  for (const line of text.lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i] as [number, number];
      const [bx, by] = line[i + 1] as [number, number];
      const len = Math.hypot(bx - ax, by - ay) * s + 0.008;
      const angle = Math.atan2(by - ay, bx - ax);
      const cx = x0 + ((ax + bx) / 2) * s;
      const cy = y - 0.036 + ((ay + by) / 2) * s;
      // Map text x to the viewer's right when facing the wall from inside the room.
      const pos = onWall(f, f.tx !== 0 ? f.nz * cx : -f.nx * cx, 0.053, cy);
      p.eulerOrder = 'YXZ';
      p.box([len, 0.008, 0.002], 'emissive', white, pos, 0.001, [0, f.yaw, angle]);
      p.eulerOrder = 'XYZ';
    }
  }
  p.castShadow = true;
}

/** A few wall outlets and data ports just above the baseboards. */
function addOutlets(
  p: PartList,
  ctx: BuildContext,
  f: WallFrame,
  side: WallSide,
  doorOffsets: readonly number[],
): void {
  const plate = ctx.color('offWhite', 'offWhite');
  const spots = { north: [-6.4, 6.4], south: [-3.85, 2.6], east: [-5.2, 2.7], west: [-4.9, 4.6] }[
    side
  ];
  for (const along of spots) {
    if (doorOffsets.some((d) => Math.abs(d - along) < 1)) continue;
    const b = wallBox(f, along, 0.085, 0.085, 0.008, 0.32, 0);
    p.box(b.size, 'plastic', plate, b.pos, 0.003);
    for (const dy of [-0.018, 0.018]) {
      const hole = wallBox(f, along, 0.03, 0.012, 0.002, 0.32 + dy, 0.008);
      p.box(hole.size, 'plastic', shade(plate, 0.35), hole.pos, 0.001);
    }
  }
}

/** Ceiling slab with an optional raised tray (coffer) and a concealed LED cove around it. */
function buildCeiling(room: ResolvedRoom, ctx: BuildContext): PartList {
  const a = room.data.architecture;
  const p = new PartList();
  const H = a.height;
  const hw = a.width / 2;
  const hd = a.depth / 2;
  const c = ctx.color(a.ceilingColor, 'offWhite');
  const th = 0.1;
  const tray = a.tray;
  if (!tray) {
    p.box([a.width, th, a.depth], 'paint', c, [0, H + th / 2, 0], 0.001);
    return p;
  }
  const [cx, cz] = tray.center;
  const [sx, sz] = tray.size;
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const y = H + th / 2;
  p.box([x0 + hw, th, a.depth], 'paint', c, [(-hw + x0) / 2, y, 0], 0.001);
  p.box([hw - x1, th, a.depth], 'paint', c, [(x1 + hw) / 2, y, 0], 0.001);
  p.box([sx, th, z0 + hd], 'paint', c, [cx, y, (-hd + z0) / 2], 0.001);
  p.box([sx, th, hd - z1], 'paint', c, [cx, y, (z1 + hd) / 2], 0.001);
  const recess = 0.22;
  const top = H + tray.rise;
  const rx = sx + recess * 2;
  const rz = sz + recess * 2;
  p.box([rx + 0.04, th, rz + 0.04], 'paint', c, [cx, top + th / 2, cz], 0.001);
  const wallH = tray.rise - th;
  const wy = H + th + wallH / 2;
  p.box([rx + 0.04, wallH, 0.02], 'paint', c, [cx, wy, cz - rz / 2 - 0.01], 0.001);
  p.box([rx + 0.04, wallH, 0.02], 'paint', c, [cx, wy, cz + rz / 2 + 0.01], 0.001);
  p.box([0.02, wallH, rz], 'paint', c, [cx - rx / 2 - 0.01, wy, cz], 0.001);
  p.box([0.02, wallH, rz], 'paint', c, [cx + rx / 2 + 0.01, wy, cz], 0.001);
  // Lip that hides the LED strip, and the strip itself on the ledge.
  const lipY = H + th + 0.025;
  p.box([sx + 0.03, 0.05, 0.015], 'paint', c, [cx, lipY, z0 - 0.0075], 0.001);
  p.box([sx + 0.03, 0.05, 0.015], 'paint', c, [cx, lipY, z1 + 0.0075], 0.001);
  p.box([0.015, 0.05, sz], 'paint', c, [x0 - 0.0075, lipY, cz], 0.001);
  p.box([0.015, 0.05, sz], 'paint', c, [x1 + 0.0075, lipY, cz], 0.001);
  p.castShadow = false;
  // The LED strip itself sits hidden behind the lip; only its light spill is visible: bright at
  // the ledge, fading up the recess walls and inwards across the tray.
  const spill = ctx
    .color(room.data.lighting.fixtureColor, 'neutralWhite')
    .clone()
    .multiplyScalar(0.34);
  const g = gradientQuadGeometry(1, wallH, 1, 0.25, 1.2);
  const spillY = H + th + wallH / 2;
  for (const [len, pos, rot] of [
    [rx, [cx, spillY, cz - rz / 2 + 0.001], [0, 0, 0]],
    [rx, [cx, spillY, cz + rz / 2 - 0.001], [0, Math.PI, 0]],
    [rz, [cx - rx / 2 + 0.001, spillY, cz], [0, Math.PI / 2, 0]],
    [rz, [cx + rx / 2 - 0.001, spillY, cz], [0, -Math.PI / 2, 0]],
  ] as const) {
    p.add(g, 'additive', spill, pos, rot, [len, 1, 1]);
  }
  p.add(borderGlowGeometry(rx, rz, 1.1), 'additive', spill.clone().multiplyScalar(0.8), [
    cx,
    top - 0.001,
    cz,
  ]);
  p.castShadow = true;
  return p;
}

/** Axis-aligned room box (inner faces) used for box-projected reflections. */
export function roomProbeBox(room: ResolvedRoom): { min: THREE.Vector3; max: THREE.Vector3 } {
  const a = room.data.architecture;
  return {
    min: new THREE.Vector3(-a.width / 2, 0, -a.depth / 2),
    max: new THREE.Vector3(a.width / 2, a.height + (a.tray ? a.tray.rise * 0.5 : 0), a.depth / 2),
  };
}
