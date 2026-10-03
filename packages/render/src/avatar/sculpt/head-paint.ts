import type { AvatarSpec } from '@huddle/shared';
import { EYE_POS } from './figure.ts';
import { MOUTH_HALF, MOUTH_Y, TAG_EAR, TAG_NOSE, type HeadSpace } from './head.ts';
import type { Rgb } from './mesh-data.ts';
import type { V3 } from './sdf.ts';

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const mul = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Skin paint in head-local units: blush on the cheek apples, a soft rose lip tint (painted, so
 * lips never read as a separate blob), eye-socket shading, a hair-tinted scalp that softens the
 * hairline, freckles and stubble.
 */
export function headPaint(
  spec: AvatarSpec,
  hs: HeadSpace,
  skin: Rgb,
  hairColor: Rgb,
  hairline: ((x: number, z: number) => number) | null,
): (p: V3, tag: number) => Rgb {
  const blush: Rgb = mix(skin, [0.86, 0.26, 0.26], 0.5);
  const lip: Rgb = mix(mul(skin, 0.8), [0.62, 0.2, 0.2], 0.42);
  const scalp: Rgb = mix(skin, mul(hairColor, 0.7), 0.82);
  const socket = mul(skin, 0.86);
  const [ex, ey, ez] = EYE_POS;
  const [ox, oy, oz] = hs.origin;
  const k = hs.k;
  return (p, tag) => {
    const x = (p[0] - ox) / k;
    const y = (p[1] - oy) / k;
    const z = (p[2] - oz) / k;
    let c = skin;
    for (const sx of [1, -1]) {
      const dx = x - sx * 0.058;
      const dy = y - 0.08;
      const dz = z - 0.088;
      c = mix(c, blush, Math.exp(-(dx * dx + dy * dy * 1.6 + dz * dz) / 0.0006) * 0.62);
    }
    let lipW = 0;
    if (z > 0.07) {
      const dy = y - MOUTH_Y;
      const e = (x / (MOUTH_HALF * 0.95)) ** 2 + (dy / (dy > 0 ? 0.0078 : 0.0098)) ** 2;
      lipW = smooth01((1.25 - e) / 0.7);
      c = mix(c, lip, lipW * 0.8);
    }
    if (tag === TAG_NOSE)
      c = mix(c, blush, Math.exp(-(x * x + (y - 0.082) ** 2 + (z - 0.115) ** 2) / 0.00027) * 0.35);
    if (tag === TAG_EAR) c = mix(c, blush, 0.2);
    for (const sx of [1, -1]) {
      const dx = x - sx * ex;
      const dy = y - ey;
      const dz = z - ez;
      c = mix(c, socket, Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.0009) * 0.35);
    }
    if (hairline && tag !== TAG_EAR) {
      const w = smooth01((y - hairline(x, z) + 0.004) / 0.012);
      if (w > 0) c = mix(c, scalp, w);
    }
    if (spec.freckles === 1 && y > 0.06 && y < 0.11 && z > 0.06) {
      if (hash3(p[0] * 900, p[1] * 900, p[2] * 900) > 0.86) c = mix(c, mul(skin, 0.6), 0.55);
    }
    if (spec.facialHair === 1 && y < 0.07 && z > -0.01 && lipW < 0.3) c = mix(c, hairColor, 0.26);
    return c;
  };
}
