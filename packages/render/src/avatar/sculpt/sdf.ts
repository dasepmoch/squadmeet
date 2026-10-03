/**
 * Signed distance field toolkit for sculpting characters. Pure math on plain arrays (no three.js,
 * no DOM) so it runs in a worker. Shapes are combined in order with smooth boolean operators; each
 * additive shape carries the bone and paint tag the mesher uses for skin weights and colors.
 */
export type V3 = [number, number, number];

/** Row-major 3x3 rotation (world -> shape local when stored as `inv`). */
export type M3 = [number, number, number, number, number, number, number, number, number];

export type Shape =
  | { t: 'sphere'; c: V3; r: number }
  | { t: 'ellipsoid'; c: V3; r: V3; inv?: M3 }
  | { t: 'cone'; a: V3; b: V3; ra: number; rb: number }
  | { t: 'box'; c: V3; h: V3; r: number; inv?: M3 }
  | { t: 'torus'; c: V3; R: number; r: number; inv?: M3 }
  | { t: 'plane'; n: V3; d: number }
  /** A nested sculpt used as one shape (local clips, e.g. a sleeve cut that must not cut the torso). */
  | { t: 'group'; s: Sculpt }
  /** Arbitrary field with optional bounds (hairlines and other analytic regions). */
  | { t: 'fn'; f: (p: V3) => number; b: { min: V3; max: V3 } | null };

export type Op = 'add' | 'sub' | 'clip';

export interface Prim {
  shape: Shape;
  op: Op;
  /** Smoothing radius of the boolean (meters). */
  k: number;
  /** Bone this surface follows (additive shapes). */
  bone?: string;
  /** Paint/material tag for vertex colors (additive shapes). */
  tag?: number;
  /**
   * Spatially fading blend: the smoothing radius ramps from 0 at `from` to `k` at `to` along
   * `axis`. Lets an arm melt into the shoulder without webbing to the ribs further down.
   */
  fade?: { axis: V3; from: number; to: number };
  /** Cached bounds (computed lazily). */
  box?: { min: V3; max: V3 };
}

export interface Fade {
  axis: V3;
  from: number;
  to: number;
}

export function v3(x: number, y: number, z: number): V3 {
  return [x, y, z];
}

export function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function len3(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function norm3(a: V3): V3 {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Rotation from Euler XYZ (radians); returns the inverse (transpose) for world -> local. */
export function invRotation(rx: number, ry: number, rz: number): M3 {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rz * Ry * Rx (applied to local vectors); inverse is the transpose.
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
}

/** Inverse rotation whose local +Y axis maps to `dir` (for shapes aligned along a direction). */
export function invAlignY(dir: V3, hint: V3 = [0, 0, 1]): M3 {
  const y = norm3(dir);
  let x = cross3(y, hint);
  if (len3(x) < 1e-5) x = cross3(y, [1, 0, 0]);
  x = norm3(x);
  const z = cross3(x, y);
  // Columns x, y, z form local->world; the inverse is its transpose (rows).
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

function local(p: V3, c: V3, inv: M3 | undefined, out: V3): V3 {
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  const z = p[2] - c[2];
  if (!inv) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }
  out[0] = inv[0] * x + inv[1] * y + inv[2] * z;
  out[1] = inv[3] * x + inv[4] * y + inv[5] * z;
  out[2] = inv[6] * x + inv[7] * y + inv[8] * z;
  return out;
}

const q: V3 = [0, 0, 0];

/** Distance to one shape (exact for spheres/cones/boxes/tori, a tight bound for ellipsoids). */
export function shapeDistance(s: Shape, p: V3): number {
  // Hot path: plain sqrt of sums (Math.hypot is several times slower in V8).
  switch (s.t) {
    case 'sphere': {
      const x = p[0] - s.c[0];
      const y = p[1] - s.c[1];
      const z = p[2] - s.c[2];
      return Math.sqrt(x * x + y * y + z * z) - s.r;
    }
    case 'ellipsoid': {
      local(p, s.c, s.inv, q);
      const ax = q[0] / s.r[0];
      const ay = q[1] / s.r[1];
      const az = q[2] / s.r[2];
      const bx = ax / s.r[0];
      const by = ay / s.r[1];
      const bz = az / s.r[2];
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      return k1 < 1e-9 ? -Math.min(s.r[0], s.r[1], s.r[2]) : (k0 * (k0 - 1)) / k1;
    }
    case 'cone':
      return roundCone(p, s.a, s.b, s.ra, s.rb);
    case 'box': {
      local(p, s.c, s.inv, q);
      const dx = Math.abs(q[0]) - s.h[0] + s.r;
      const dy = Math.abs(q[1]) - s.h[1] + s.r;
      const dz = Math.abs(q[2]) - s.h[2] + s.r;
      const ox = dx > 0 ? dx : 0;
      const oy = dy > 0 ? dy : 0;
      const oz = dz > 0 ? dz : 0;
      const m = dx > dy ? (dx > dz ? dx : dz) : dy > dz ? dy : dz;
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + (m < 0 ? m : 0) - s.r;
    }
    case 'torus': {
      local(p, s.c, s.inv, q);
      const ring = Math.sqrt(q[0] * q[0] + q[2] * q[2]) - s.R;
      return Math.sqrt(ring * ring + q[1] * q[1]) - s.r;
    }
    case 'plane':
      return dot3(s.n, p) - s.d;
    case 'group':
      return s.s.distance(p);
    case 'fn':
      return s.f(p);
  }
}

/** Inigo Quilez's exact round cone (capsule with different end radii). */
function roundCone(p: V3, a: V3, b: V3, r1: number, r2: number): number {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = p[0] - a[0];
  const pay = p[1] - a[1];
  const paz = p[2] - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y;
  const xy = pay * l2 - bay * y;
  const xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Conservative axis-aligned bounds of a shape (planes are unbounded). */
export function shapeBounds(s: Shape): { min: V3; max: V3 } | null {
  const around = (c: V3, r: number): { min: V3; max: V3 } => ({
    min: [c[0] - r, c[1] - r, c[2] - r],
    max: [c[0] + r, c[1] + r, c[2] + r],
  });
  switch (s.t) {
    case 'sphere':
      return around(s.c, s.r);
    case 'ellipsoid':
      return around(s.c, Math.max(s.r[0], s.r[1], s.r[2]));
    case 'cone': {
      const r = Math.max(s.ra, s.rb);
      return {
        min: [
          Math.min(s.a[0], s.b[0]) - r,
          Math.min(s.a[1], s.b[1]) - r,
          Math.min(s.a[2], s.b[2]) - r,
        ],
        max: [
          Math.max(s.a[0], s.b[0]) + r,
          Math.max(s.a[1], s.b[1]) + r,
          Math.max(s.a[2], s.b[2]) + r,
        ],
      };
    }
    case 'box':
      return around(s.c, len3(s.h));
    case 'torus':
      return around(s.c, s.R + s.r);
    case 'plane':
      return null;
    case 'group':
      return s.s.bounds(0);
    case 'fn':
      return s.b;
  }
}

function boxDistance(p: V3, b: { min: V3; max: V3 }): number {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const dx = x < b.min[0] ? b.min[0] - x : x > b.max[0] ? x - b.max[0] : 0;
  const dy = y < b.min[1] ? b.min[1] - y : y > b.max[1] ? y - b.max[1] : 0;
  const dz = z < b.min[2] ? b.min[2] - z : z > b.max[2] ? z - b.max[2] : 0;
  return dx === 0 && dy === 0 && dz === 0 ? 0 : Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Optional per-point displacement (hair strands, fabric ribs), added after the booleans. */
export type Displace = (p: V3, d: number) => number;

/** An ordered list of primitives evaluated as one field. */
export class Sculpt {
  readonly prims: Prim[] = [];
  displace: Displace | null = null;

  add(shape: Shape, k: number, bone: string, tag = 0, fade?: Fade): this {
    this.prims.push(
      fade ? { shape, op: 'add', k, bone, tag, fade } : { shape, op: 'add', k, bone, tag },
    );
    return this;
  }

  sub(shape: Shape, k: number): this {
    this.prims.push({ shape, op: 'sub', k });
    return this;
  }

  /** Keeps only the inside of `shape` (intersection), e.g. a half-space cut. */
  clip(shape: Shape, k: number): this {
    this.prims.push({ shape, op: 'clip', k });
    return this;
  }

  /** Appends another sculpt's primitives (they keep their own ops). */
  append(other: Sculpt): this {
    for (const p of other.prims) this.prims.push({ ...p, box: undefined });
    return this;
  }

  /** Bounds of all additive shapes, padded. */
  bounds(pad: number): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims) {
      if (p.op !== 'add') continue;
      const b = shapeBounds(p.shape);
      if (!b) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i] as number, (b.min[i] as number) - p.k);
        max[i] = Math.max(max[i] as number, (b.max[i] as number) + p.k);
      }
    }
    return {
      min: [min[0] - pad, min[1] - pad, min[2] - pad],
      max: [max[0] + pad, max[1] + pad, max[2] + pad],
    };
  }

  /** Signed distance at `p`. Skips shapes whose bounds cannot affect the result. */
  distance(p: V3): number {
    let d = 1e9;
    for (const prim of this.prims) {
      const s = prim.shape;
      if (s.t !== 'plane') {
        prim.box ??= shapeBounds(s) ?? undefined;
        const lb = prim.box ? boxDistance(p, prim.box) : 0;
        if (prim.op === 'add' && lb >= d + prim.k) continue;
        if (prim.op === 'sub' && lb >= prim.k - d) continue;
      }
      const di = shapeDistance(s, p);
      let k = prim.k;
      if (prim.fade) {
        const f = prim.fade;
        const t =
          (f.axis[0] * p[0] + f.axis[1] * p[1] + f.axis[2] * p[2] - f.from) / (f.to - f.from);
        k *= t < 0 ? 0 : t > 1 ? 1 : t;
      }
      if (prim.op === 'add') d = smin(d, di, k);
      else if (prim.op === 'sub') d = smax(d, -di, k);
      else d = smax(d, di, k);
    }
    return this.displace ? this.displace(p, d) : d;
  }

  /**
   * The additive primitive whose surface is closest to `p`, searching into groups. Its bone and
   * tag drive skin weights and paint for mesh vertices at `p`.
   */
  owner(p: V3): Prim | null {
    let best: Prim | null = null;
    let bestD = Infinity;
    for (const prim of this.prims) {
      if (prim.op !== 'add') continue;
      if (prim.shape.t === 'group') {
        // Rank a group by its full field (clips and cuts included): a belt band clipped to 3 cm
        // must not own the whole pelvis just because its unclipped shapes are slightly larger.
        const g = prim.shape.s;
        const d = g.distance(p);
        if (d >= bestD) continue;
        const inner = g.owner(p);
        if (!inner) continue;
        bestD = d;
        // Group-level bone/tag override the inner ones when set.
        best =
          prim.bone && prim.bone !== '*'
            ? { ...inner, bone: prim.bone, tag: prim.tag ? prim.tag : inner.tag }
            : inner;
        continue;
      }
      const d = shapeDistance(prim.shape, p);
      if (d < bestD) {
        bestD = d;
        best = prim;
      }
    }
    return best;
  }
}

/** Wraps a sculpt as a shape. Use bone `'*'` on the group prim to keep the inner bones. */
export function group(s: Sculpt): Shape {
  return { t: 'group', s };
}
