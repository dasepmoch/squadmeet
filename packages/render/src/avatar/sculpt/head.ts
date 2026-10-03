import type { AvatarSpec } from '@huddle/shared';
import { cone, ell, half, sph } from './body.ts';
import { EYE_POS, type Figure } from './figure.ts';
import { add3, invRotation, scale3, Sculpt, type Shape, type V3 } from './sdf.ts';

export const TAG_SKIN = 0;
export const TAG_LIP = 1;
export const TAG_EAR = 2;
export const TAG_NOSE = 3;

/** Maps head-local coordinates (origin at the skull base, +Z = face) into bind space. */
export class HeadSpace {
  readonly origin: V3;
  readonly k: number;

  constructor(f: Figure) {
    this.origin = f.joints.head;
    this.k = f.headScale;
  }

  p(x: number, y: number, z: number): V3 {
    return add3(this.origin, scale3([x, y, z], this.k));
  }

  r(v: number): number {
    return v * this.k;
  }

  /** A field authored in head-local units, with optional head-local bounds. */
  fn(f: (x: number, y: number, z: number) => number, box: { min: V3; max: V3 } | null): Shape {
    const [ox, oy, oz] = this.origin;
    const k = this.k;
    const ik = 1 / k;
    const b = box ? { min: this.p(...box.min), max: this.p(...box.max) } : null;
    return { t: 'fn', f: (p) => f((p[0] - ox) * ik, (p[1] - oy) * ik, (p[2] - oz) * ik) * k, b };
  }

  /** Transforms a shape authored in head-local units. */
  shape(s: Shape): Shape {
    const k = this.k;
    const P = (v: V3): V3 => add3(this.origin, scale3(v, k));
    switch (s.t) {
      case 'sphere':
        return { ...s, c: P(s.c), r: s.r * k };
      case 'ellipsoid':
        return { ...s, c: P(s.c), r: scale3(s.r, k) };
      case 'cone':
        return { ...s, a: P(s.a), b: P(s.b), ra: s.ra * k, rb: s.rb * k };
      case 'box':
        return { ...s, c: P(s.c), h: scale3(s.h, k), r: s.r * k };
      case 'torus':
        return { ...s, c: P(s.c), R: s.R * k, r: s.r * k };
      case 'plane':
        return {
          ...s,
          d:
            s.d * k + (s.n[0] * this.origin[0] + s.n[1] * this.origin[1] + s.n[2] * this.origin[2]),
        };
      default:
        return s;
    }
  }
}

export interface FaceShape {
  jaw: number;
  cheek: number;
  chin: number;
  length: number;
}

const FACE_SHAPES: readonly FaceShape[] = [
  { jaw: 1.02, cheek: 1.1, chin: 1.05, length: 0.97 },
  { jaw: 0.95, cheek: 0.98, chin: 0.95, length: 1.04 },
  { jaw: 0.9, cheek: 1.08, chin: 0.82, length: 1.0 },
  { jaw: 1.1, cheek: 0.96, chin: 1.12, length: 1.0 },
];

export function faceShape(spec: AvatarSpec): FaceShape {
  return FACE_SHAPES[spec.faceShape] ?? { jaw: 1, cheek: 1, chin: 1, length: 1 };
}

/** Eyeball radius and default lid openness per eye style (head-local units). */
export function eyeParams(spec: AvatarSpec): { radius: number; open: number; tilt: number } {
  switch (spec.eyeStyle) {
    case 1:
      return { radius: 0.0202, open: 0.8, tilt: 0.12 };
    case 2:
      return { radius: 0.0206, open: 0.62, tilt: -0.04 };
    case 3:
      return { radius: 0.0222, open: 1, tilt: 0 };
    default:
      return { radius: 0.0212, open: 0.9, tilt: 0 };
  }
}

/** Head-local mouth line height (between the lips) and half width. */
export const MOUTH_Y = 0.049;
export const MOUTH_HALF = 0.0185;

/** Cranium ellipsoid (head-local), shared by hair and headwear so they hug the skull. */
export const CRANIUM = { c: [0, 0.132, -0.008] as V3, r: [0.101, 0.113, 0.114] as V3 };

/**
 * The head: cranium, face mass, cheeks, jaw, chin, brow ridge, nose, lips, ears and neck, with
 * eye sockets carved out for the separate eyeballs. Designed with gently exaggerated, friendly
 * proportions (big cranium and eyes, soft cheeks) rather than realism.
 */
export function headSculpt(f: Figure, spec: AvatarSpec): { sculpt: Sculpt; hs: HeadSpace } {
  const hs = new HeadSpace(f);
  const fs = faceShape(spec);
  const eye = eyeParams(spec);
  const sc = new Sculpt();
  const add = (s: Shape, k: number, bone: string, tag = TAG_SKIN): void => {
    sc.add(hs.shape(s), hs.r(k), bone, tag);
  };
  const L = fs.length;
  add(ell(CRANIUM.c, CRANIUM.r), 0, 'head');
  // A slightly compact lower face with full cheeks reads younger and friendlier.
  add(ell([0, 0.084 * L + 0.004, 0.03], [0.079 * fs.jaw, 0.084 * L, 0.078]), 0.05, 'head');
  for (const x of [0.05, -0.05])
    add(sph([x * fs.cheek, 0.078, 0.06], 0.041 * fs.cheek), 0.04, 'head');
  add(ell([0, 0.036 - (L - 1) * 0.08, 0.058], [0.041 * fs.chin, 0.032, 0.037]), 0.035, 'head');
  // The jaw tapers towards a small chin (a soft V rather than a square jaw).
  for (const x of [0.051, -0.051])
    add(sph([x * fs.jaw, 0.052, 0.024], 0.029 * fs.jaw), 0.04, 'head');
  const [ex, ey, ez] = EYE_POS;
  for (const x of [ex + 0.001, -ex - 0.001])
    add(ell([x, ey + 0.036, ez + 0.006], [0.031, 0.011, 0.016]), 0.02, 'head');
  // Nose: bridge, a small button tip and wings.
  const noseTip = spec.noseStyle === 2 ? 0.0128 : spec.noseStyle === 1 ? 0.0098 : 0.0106;
  const bridge = spec.noseStyle === 1 ? 0.012 : 0.0105;
  add(ell([0, 0.101, 0.1], [bridge, 0.022, 0.013]), 0.015, 'head', TAG_NOSE);
  add(
    sph([0, spec.noseStyle === 1 ? 0.08 : 0.082, spec.noseStyle === 1 ? 0.118 : 0.115], noseTip),
    0.011,
    'head',
    TAG_NOSE,
  );
  for (const x of [0.0105, -0.0105]) add(sph([x, 0.077, 0.107], 0.0074), 0.008, 'head', TAG_NOSE);
  // Lips: soft, small volumes; their color is painted (see headPaint), not tagged.
  add(ell([0, MOUTH_Y + 0.0045, 0.1], [0.017, 0.0048, 0.009]), 0.006, 'head', TAG_LIP);
  add(ell([0, MOUTH_Y - 0.0055, 0.098], [0.0155, 0.006, 0.0095]), 0.006, 'head', TAG_LIP);
  // Ears with a carved concha.
  for (const side of [1, -1]) {
    const inv = invRotation(0, side * 0.35, side * 0.12);
    sc.add(
      hs.shape({ t: 'ellipsoid', c: [side * 0.098, 0.108, -0.006], r: [0.011, 0.027, 0.018], inv }),
      hs.r(0.011),
      'head',
      TAG_EAR,
    );
  }
  // Neck from inside the collar up into the skull, sturdy enough to carry the big head.
  sc.add(
    hs.shape(cone([0, -0.115, -0.022], [0, 0.05, -0.014], (0.052 / f.headScale) * f.s, 0.046)),
    hs.r(0.03),
    'neck',
    TAG_SKIN,
  );
  for (const side of [1, -1]) {
    sc.sub(
      hs.shape({
        t: 'ellipsoid',
        c: [side * 0.106, 0.106, 0.0],
        r: [0.0055, 0.016, 0.011],
        inv: invRotation(0, side * 0.35, 0),
      }),
      hs.r(0.004),
    );
  }
  // Eye sockets sized to the eyeballs.
  const r = eye.radius;
  for (const x of [ex, -ex]) sc.sub(hs.shape(sph([x, ey, ez + 0.006], r * 1.08)), hs.r(0.011));
  // Close the mesh deep inside the collar (a soft cut meshes without a sawtooth edge).
  sc.clip(half([0, -1, 0], -(f.joints.neck[1] - 0.06 * f.s)), 0.008 * f.s);
  return { sculpt: sc, hs };
}

/** Where a ray from inside the head exits the surface (for placing face parts on the skin). */
export function surfacePoint(sc: Sculpt, from: V3, dir: V3, max: number): V3 {
  let t = 0;
  let last = from;
  for (let i = 0; i < 64 && t < max; i++) {
    const p = add3(from, scale3(dir, t));
    const d = sc.distance(p);
    if (d > 0) {
      // Bisect between the last inside point and this outside point.
      let a = last;
      let b = p;
      for (let k = 0; k < 10; k++) {
        const m = scale3(add3(a, b), 0.5);
        if (sc.distance(m) > 0) b = m;
        else a = m;
      }
      return b;
    }
    last = p;
    t += Math.max(0.0015, -d * 0.8);
  }
  return add3(from, scale3(dir, max));
}
