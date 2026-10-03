/** Small, allocation-free noise helpers for procedural texture generation (tileable). */

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise in [0, 1] with integer `period` cells across the unit square. */
export function valueNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const wrap = (n: number): number => ((n % period) + period) % period;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Anisotropic tileable value noise: separate integer periods along u and v. */
export function valueNoise2(
  u: number,
  v: number,
  periodU: number,
  periodV: number,
  seed: number,
): number {
  const x = u * periodU;
  const y = v * periodV;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const wu = (n: number): number => ((n % periodU) + periodU) % periodU;
  const wv = (n: number): number => ((n % periodV) + periodV) % periodV;
  const a = hash2(wu(x0), wv(y0), seed);
  const b = hash2(wu(x0 + 1), wv(y0), seed);
  const c = hash2(wu(x0), wv(y0 + 1), seed);
  const d = hash2(wu(x0 + 1), wv(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal (fBm) tileable noise in roughly [0, 1]. */
export function fbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u, v, period, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Deterministic hash for per-cell randomness (tile tints, variants). */
export function cellRandom(x: number, y: number, seed: number): number {
  return hash2(x, y, seed);
}

export interface VoronoiSample {
  /** Distance to the nearest feature point, in cell units. */
  f1: number;
  /** Distance to the second nearest feature point (cell edges are where f2 - f1 is small). */
  f2: number;
  /** Stable random value of the nearest cell. */
  id: number;
}

/** Tileable cellular noise (Worley) with `period` cells across the unit square. */
export function voronoi(
  u: number,
  v: number,
  period: number,
  seed: number,
  out: VoronoiSample,
): VoronoiSample {
  const x = u * period;
  const y = v * period;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = ((gx % period) + period) % period;
      const wy = ((gy % period) + period) % period;
      const px = gx + hash2(wx, wy, seed);
      const py = gy + hash2(wx, wy, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 13);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  return out;
}

/**
 * Converts a height field (row-major, `width`x`height`, wraps at edges) into a packed RGBA normal
 * map. `strength` scales the slope; output follows three.js tangent-space conventions (+Y = green).
 */
export function heightToNormal(
  heights: Float32Array,
  size: number,
  strength: number,
  height = size,
): Uint8Array {
  const w = size;
  const out = new Uint8Array(w * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const l = heights[y * w + ((x - 1 + w) % w)] as number;
      const r = heights[y * w + ((x + 1) % w)] as number;
      const d = heights[((y - 1 + height) % height) * w + x] as number;
      const u = heights[((y + 1) % height) * w + x] as number;
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * w + x) * 4;
      out[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
