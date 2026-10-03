import {
  cellRandom,
  fbm,
  heightToNormal,
  valueNoise,
  valueNoise2,
  voronoi,
  type VoronoiSample,
} from './noise.ts';

/**
 * Pure procedural texture generators. They only produce typed arrays (no DOM, no WebGL), so they
 * run in a worker as well as on the main thread. The project ships zero external texture files.
 */
export interface TextureData {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Albedo (luminance, tinted by material or vertex color), ORM and normal of one surface. */
export interface PbrTextureSet {
  albedo: TextureData;
  /** R: ambient occlusion, G: roughness, B: unused (three.js ORM convention). */
  orm: TextureData;
  normal: TextureData;
  /** Physical size of one texture repeat along U and V, meters. */
  tile: [number, number];
}

function srgbByte(linear: number): number {
  const c =
    linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(Math.max(0, linear), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

interface Channels {
  lum: number;
  height: number;
  rough: number;
  ao: number;
}

/** Runs a per-pixel surface function and packs albedo (sRGB gray), ORM and a normal map. */
function bake(
  size: number,
  strength: number,
  tile: [number, number],
  fn: (u: number, v: number, out: Channels) => void,
): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const c: Channels = { lum: 1, height: 0, rough: 1, ao: 1 };
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      c.lum = 1;
      c.height = 0;
      c.rough = 1;
      c.ao = 1;
      fn(u, v, c);
      const i = (y * size + x) * 4;
      const g = srgbByte(clamp01(c.lum));
      albedo[i] = g;
      albedo[i + 1] = g;
      albedo[i + 2] = g;
      albedo[i + 3] = 255;
      orm[i] = Math.round(clamp01(c.ao) * 255);
      orm[i + 1] = Math.round(clamp01(c.rough) * 255);
      orm[i + 2] = 0;
      orm[i + 3] = 255;
      heights[y * size + x] = c.height;
    }
  }
  return {
    albedo: { width: size, height: size, data: albedo },
    orm: { width: size, height: size, data: orm },
    normal: {
      width: size,
      height: size,
      data: heightToNormal(heights, size, strength * (size / 256)),
    },
    tile,
  };
}

/**
 * Loop-pile carpet tiles (50 cm, laid quarter-turned) covering 1 m: tufting rows, fine pile noise,
 * per-tile tone shifts and faint seams. Neutral gray; the room floor color tints it.
 */
export function generateCarpet(size: number, seed = 5): PbrTextureSet {
  const tiles = 2;
  const seamWidth = 1.2 / (size / tiles);
  return bake(size, 1.6, [1, 1], (u, v, c) => {
    const tx = Math.floor(u * tiles);
    const ty = Math.floor(v * tiles);
    const fu = u * tiles - tx;
    const fv = v * tiles - ty;
    const across = (tx + ty) % 2 === 0 ? fu : fv;
    const along = (tx + ty) % 2 === 0 ? fv : fu;
    const pile = valueNoise(u, v, 256, seed);
    const fine = valueNoise(u, v, 512, seed + 1);
    const rowWobble = valueNoise(u, v, 16, seed + 2);
    const rows = 0.5 + 0.5 * Math.sin((across * 92 + rowWobble * 1.5) * Math.PI * 2);
    const loops = 0.5 + 0.5 * Math.sin((along * 180 + pile * 2) * Math.PI * 2);
    const mottle = fbm(u, v, 6, 3, seed + 3);
    const heather = valueNoise(u, v, 1024, seed + 5);
    const tone = (cellRandom(tx, ty, seed + 4) - 0.5) * 0.02;
    const seam = Math.min(fu, 1 - fu, fv, 1 - fv) < seamWidth ? 1 : 0;
    // Heathered yarn (fine two-tone flecks) reads as carpet rather than flat tiles.
    const fleck = heather > 0.7 ? 0.12 : heather < 0.25 ? -0.08 : 0;
    c.lum =
      0.72 +
      (pile - 0.5) * 0.18 +
      (fine - 0.5) * 0.12 +
      (rows - 0.5) * 0.035 +
      (mottle - 0.5) * 0.08 +
      fleck +
      tone -
      seam * 0.04;
    c.height = pile * 0.5 + fine * 0.35 + rows * loops * 0.25 + heather * 0.2 - seam * 0.3;
    c.rough = 0.9 + pile * 0.08;
    c.ao = 1 - seam * 0.15 - (1 - fine) * 0.12;
  });
}

/**
 * Flat-sawn veneer covering 1.2 m (U, along the grain) x 0.3 m (V): warped growth rings,
 * elongated pores and subtle tone drift. Grayscale; walnut/oak/ash come from the part color.
 */
export function generateWoodVeneer(size: number, seed = 31): PbrTextureSet {
  const ringCount = 12;
  return bake(size, 0.9, [1.2, 0.3], (u, v, c) => {
    const warp = valueNoise2(u, v, 3, 2, seed) * 0.6 + valueNoise2(u, v, 7, 3, seed + 1) * 0.3;
    const r = v * ringCount + warp * 2.6 + valueNoise2(u, v, 2, 1, seed + 2) * 1.4;
    const ring = Math.pow(0.5 + 0.5 * Math.sin(r * Math.PI * 2), 3);
    const pore = valueNoise2(u, v, 36, 360, seed + 3);
    const poreDark = smoothstep(0.64, 0.92, pore);
    const drift = valueNoise2(u, v, 5, 2, seed + 4);
    const fleck = valueNoise2(u, v, 90, 24, seed + 5);
    c.lum = 0.8 - ring * 0.2 - poreDark * 0.14 + (drift - 0.5) * 0.1 + (fleck - 0.5) * 0.04;
    c.height = -poreDark * 0.9 - ring * 0.08;
    c.rough = 0.72 + poreDark * 0.25 + ring * 0.04;
    c.ao = 1 - poreDark * 0.2;
  });
}

/** Pebble-grain leather (15 cm repeat): cellular grooves with slight height variation. */
export function generateLeather(size: number, seed = 41): PbrTextureSet {
  const s: VoronoiSample = { f1: 0, f2: 0, id: 0 };
  return bake(size, 1.4, [0.15, 0.15], (u, v, c) => {
    voronoi(u, v, 44, seed, s);
    const edge = smoothstep(0.0, 0.16, s.f2 - s.f1);
    const micro = valueNoise(u, v, 128, seed + 1);
    c.lum = 0.9 - (1 - edge) * 0.12 + (s.id - 0.5) * 0.04;
    c.height = edge * (0.6 + s.id * 0.4) + micro * 0.1;
    c.rough = 0.62 + (1 - edge) * 0.2 + micro * 0.06;
    c.ao = 0.85 + edge * 0.15;
  });
}

/** Needle felt for acoustic panels (30 cm repeat). */
export function generateFelt(size: number, seed = 51): PbrTextureSet {
  return bake(size, 1.1, [0.3, 0.3], (u, v, c) => {
    const n = fbm(u, v, 24, 4, seed);
    const fibers = valueNoise(u, v, 200, seed + 1);
    c.lum = 0.86 + (n - 0.5) * 0.16 + (fibers - 0.5) * 0.06;
    c.height = n * 0.8 + fibers * 0.3;
    c.rough = 0.95;
    c.ao = 0.9 + n * 0.1;
  });
}

/** Brushed aluminium streaks (30 cm repeat, brushed along U). */
export function generateBrushed(size: number, seed = 61): PbrTextureSet {
  return bake(size, 0.35, [0.3, 0.3], (u, v, c) => {
    const a = valueNoise2(u, v, 3, 700, seed);
    const b = valueNoise2(u, v, 11, 1400, seed + 1);
    c.lum = 0.94 + (a - 0.5) * 0.06;
    c.height = a * 0.7 + b * 0.3;
    c.rough = 0.7 + a * 0.3;
    c.ao = 1;
  });
}

/** Engineered quartz with fine speckles and faint clouding (60 cm repeat). */
export function generateQuartz(size: number, seed = 71): PbrTextureSet {
  const s: VoronoiSample = { f1: 0, f2: 0, id: 0 };
  return bake(size, 0.4, [0.6, 0.6], (u, v, c) => {
    const cloud = fbm(u, v, 5, 4, seed);
    const speck = valueNoise(u, v, 190, seed + 1);
    voronoi(u, v, 60, seed + 2, s);
    const chip = s.f1 < 0.18 && s.id > 0.86 ? 1 : 0;
    c.lum = 0.93 + (cloud - 0.5) * 0.08 - smoothstep(0.8, 0.9, speck) * 0.3 - chip * 0.18;
    c.height = chip * 0.2;
    c.rough = 0.35 + (cloud - 0.5) * 0.1;
    c.ao = 1;
  });
}

/** Tileable micro-surface normal map for fabric, plaster and painted surfaces. */
export function generateNoiseNormal(
  size: number,
  period: number,
  strength: number,
  seed: number,
  weave = false,
): TextureData {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = fbm(u, v, period, 4, seed);
      if (weave) {
        const wx = Math.sin(u * Math.PI * 2 * period * 2);
        const wy = Math.sin(v * Math.PI * 2 * period * 2);
        h = h * 0.4 + (wx * wx * 0.5 + wy * wy * 0.5) * 0.6;
      }
      heights[y * size + x] = h;
    }
  }
  return { width: size, height: size, data: heightToNormal(heights, size, strength) };
}

/** Radial soft dot for particles and glows (alpha in every channel). */
export function generateSoftDot(size: number): TextureData {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - d, 2.2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: size, height: size, data };
}
