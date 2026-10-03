import { cellRandom, fbm, valueNoise } from './noise.ts';
import type { TextureData } from './texture-data.ts';

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function capsuleSdf(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/**
 * Splash atlas (cells x cells) for tomato hits. The red channel stores a signed-distance-like field
 * where 0.5 is the edge, so decals stay crisp at any size; green holds a wet-sheen noise.
 */
export function generateSplatAtlas(size: number, cells: number): TextureData {
  const data = new Uint8Array(size * size * 4);
  const cell = size / cells;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const variant = cy * cells + cx;
      const rnd = (k: number): number => cellRandom(variant, k, 99);
      const lobes = [4 + Math.floor(rnd(1) * 4), 9 + Math.floor(rnd(2) * 5)];
      const phases = [rnd(4) * 6.28, rnd(5) * 6.28];
      const drops: [number, number, number][] = [];
      for (let i = 0; i < 7 + Math.floor(rnd(7) * 6); i++) {
        const a = rnd(10 + i) * Math.PI * 2;
        const dist = 0.24 + rnd(30 + i) * 0.2;
        drops.push([Math.cos(a) * dist, Math.sin(a) * dist, 0.008 + rnd(50 + i) * 0.022]);
      }
      const streaks: [number, number, number, number, number][] = [];
      for (let i = 0; i < 3 + Math.floor(rnd(8) * 3); i++) {
        const a = rnd(70 + i) * Math.PI * 2;
        const len = 0.22 + rnd(80 + i) * 0.18;
        streaks.push([
          Math.cos(a) * 0.1,
          Math.sin(a) * 0.1,
          Math.cos(a) * len,
          Math.sin(a) * len,
          0.01 + rnd(90 + i) * 0.012,
        ]);
      }
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const px = (x + 0.5) / cell - 0.5;
          const py = (y + 0.5) / cell - 0.5;
          const ang = Math.atan2(py, px);
          const r =
            0.16 *
            (1 +
              0.18 * Math.sin(ang * (lobes[0] ?? 5) + (phases[0] ?? 0)) +
              0.08 * Math.sin(ang * (lobes[1] ?? 11) + (phases[1] ?? 0)));
          let d = Math.hypot(px, py) - r;
          for (const [dx, dy, rr] of drops) d = smin(d, Math.hypot(px - dx, py - dy) - rr, 0.025);
          for (const [ax, ay, bx, by, rr] of streaks)
            d = smin(d, capsuleSdf(px, py, ax, ay, bx, by, rr), 0.04);
          const field = Math.max(0, Math.min(1, 0.5 - d * 6));
          const i = ((cy * cell + y) * size + cx * cell + x) * 4;
          data[i] = Math.round(field * 255);
          data[i + 1] = Math.round(
            fbm((x + cx * cell) / size, (y + cy * cell) / size, 16, 3, 5) * 255,
          );
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { width: size, height: size, data };
}

type Rgb = [number, number, number];

function mix3(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface LeafSample {
  inside: boolean;
  color: Rgb;
}

/** Leaf silhouettes and coloring; (u, v) in [0,1], v runs from stem (0) to tip (1). */
function leafSample(kind: number, u: number, v: number, seed: number): LeafSample {
  const cx = (u - 0.5) * 2;
  const ax = Math.abs(cx);
  const vein = (spacing: number, slope: number): number => {
    const t = (v * spacing - ax * slope) % 1;
    return Math.abs(cx) > 0.04 && t > 0 && t < 0.06 ? 1 : 0;
  };
  const midrib = ax < 0.025 ? 1 : 0;
  const n = valueNoise(u, v, 24, seed + kind);
  if (kind === 0) {
    // Fiddle-leaf fig: broad violin shape with a waist, strong pale veins.
    let w = 0.92 * Math.sin(Math.PI * Math.pow(v, 0.72));
    w *= 1 - 0.2 * Math.exp(-(((v - 0.58) / 0.12) ** 2));
    const inside = ax < w && v > 0.03 && v < 0.99;
    const base: Rgb = [0.08, 0.26, 0.07];
    const c = mix3(base, [0.2, 0.42, 0.14], (ax / Math.max(0.05, w)) * 0.4 + n * 0.25);
    return { inside, color: mix3(c, [0.42, 0.55, 0.26], Math.max(midrib, vein(7, 0.9) * 0.7)) };
  }
  if (kind === 1) {
    // Bird of paradise: long paddle with a few splits running in from the edge.
    const w = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.04)), 0.55);
    let inside = ax < w && v > 0.02;
    for (let i = 0; i < 4; i++) {
      const sv = 0.25 + cellRandom(i, 3, seed) * 0.6;
      const side = cellRandom(i, 5, seed) > 0.5 ? 1 : -1;
      if (Math.sign(cx) === side && Math.abs(v - sv - (ax - 0.3) * 0.25) < 0.006 && ax > 0.22)
        inside = false;
    }
    const c = mix3([0.07, 0.24, 0.13], [0.18, 0.4, 0.22], n * 0.3 + (1 - ax) * 0.3);
    return { inside, color: mix3(c, [0.45, 0.6, 0.35], Math.max(midrib, vein(26, 0.4) * 0.35)) };
  }
  if (kind === 2) {
    // Snake plant: pointed sword with dark banding and a golden margin.
    const w = 0.34 * Math.pow(1 - v, 0.45);
    const inside = ax < w && v < 0.995;
    const band = 0.5 + 0.5 * Math.sin((v * 22 + Math.sin(cx * 9) * 0.3 + n * 0.8) * Math.PI);
    let c = mix3([0.05, 0.16, 0.07], [0.22, 0.38, 0.16], band * 0.6 + n * 0.2);
    if (ax > w - 0.07) c = mix3(c, [0.78, 0.66, 0.2], 0.85);
    return { inside, color: c };
  }
  // Pothos: heart-shaped leaf with golden variegation.
  const t = v;
  const w = 0.95 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (t < 0.2 ? 0.7 + t * 1.5 : 1);
  const notch = t < 0.12 && ax < 0.3 * (1 - t / 0.12);
  const inside = ax < w && !notch && t < 0.98;
  const variegation = Math.max(0, fbm(u, v, 5, 3, seed + 9) - 0.56) * 3;
  const c = mix3([0.1, 0.33, 0.1], [0.62, 0.62, 0.22], Math.min(1, variegation));
  return { inside, color: mix3(c, [0.35, 0.52, 0.24], midrib * 0.6) };
}

/** 2x2 colored leaf atlas: fiddle-leaf fig, bird of paradise, snake plant, pothos (alpha = mask). */
export function generateLeafAtlas(size: number, seed = 17): TextureData {
  const w = size * 2;
  const data = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const kind = (y >= size ? 2 : 0) + (x >= size ? 1 : 0);
      const u = ((x % size) + 0.5) / size;
      const v = ((y % size) + 0.5) / size;
      const s = leafSample(kind, u, v, seed);
      const i = (y * w + x) * 4;
      const toByte = (c: number): number =>
        Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255);
      data[i] = toByte(s.color[0]);
      data[i + 1] = toByte(s.color[1]);
      data[i + 2] = toByte(s.color[2]);
      data[i + 3] = s.inside ? 255 : 0;
    }
  }
  return { width: w, height: w, data };
}
