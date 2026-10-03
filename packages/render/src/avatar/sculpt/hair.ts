import type { AvatarSpec } from '@huddle/shared';
import { cone, ell, half, sph, torus } from './body.ts';
import { CRANIUM, type HeadSpace } from './head.ts';
import { addFacialHair, headwearSculpt, TAG_HAIR } from './headwear.ts';
import {
  cross3,
  invRotation,
  norm3,
  Sculpt,
  sub3,
  type Displace,
  type Shape,
  type V3,
} from './sdf.ts';

/** Hairline keyframes: [azimuth around the skull (0 = forehead, PI = nape), head-local height]. */
type Profile = readonly (readonly [number, number])[];

/** Short cuts: sideburns in front of the ear, an arch over it, then down to the nape. */
const SHORT: Profile = [
  [0, 0.2],
  [0.4, 0.198],
  [0.9, 0.172],
  [1.22, 0.104],
  [1.38, 0.1],
  [1.62, 0.152],
  [1.92, 0.09],
  [2.3, 0.052],
  [3.15, 0.036],
];

/** Longer cuts cover the ears and come down around the head. */
const COVER: Profile = [
  [0, 0.198],
  [0.4, 0.196],
  [0.9, 0.168],
  [1.25, 0.11],
  [1.7, 0.05],
  [3.15, 0.012],
];

interface HairStyle {
  profile: Profile;
  /** Shell thickness low on the head, on top, and extra lift at the front top (head-local). */
  side: number;
  top: number;
  front: number;
  /** Height above the hairline over which the shell thickens: thin, natural edges. */
  band: number;
  /** Strand-clump groove depth and count around the crown axis. */
  groove: number;
  count: number;
  /** Curl bump depth. */
  curl: number;
  /** Whorl (head-local): grooves and highlights radiate from it. */
  crown: V3;
  /** Strands hang down below the ears (flow direction for highlights). */
  hanging: boolean;
  /** Hair below the chin follows the chest (long cuts resting on the back). */
  follow?: boolean;
  /** Head-local x of a combed part line, or null. */
  part: number | null;
  /** Carve clearance around the ears (short cuts). */
  ears: boolean;
}

const CROWN: V3 = [0, 0.228, -0.05];
const BASE = {
  front: 0,
  groove: 0.003,
  count: 36,
  curl: 0,
  crown: CROWN,
  hanging: false,
  part: null,
  ears: true,
} as const;

/** bald, buzz, crop, side part, quiff, bob, long, curls, bun, ponytail, waves, pixie */
const STYLES: readonly (HairStyle | null)[] = [
  null,
  { ...BASE, profile: SHORT, side: 0.003, top: 0.0048, band: 0.012, groove: 0.0005, count: 70 },
  {
    ...BASE,
    profile: SHORT,
    side: 0.0055,
    top: 0.015,
    front: 0.004,
    band: 0.02,
    groove: 0.0034,
    count: 40,
  },
  {
    ...BASE,
    profile: SHORT,
    side: 0.0065,
    top: 0.018,
    front: 0.004,
    band: 0.022,
    crown: [0.03, 0.236, -0.045],
    part: 0.04,
  },
  { ...BASE, profile: SHORT, side: 0.005, top: 0.013, front: 0.004, band: 0.02, groove: 0.0034 },
  {
    ...BASE,
    profile: COVER,
    side: 0.011,
    top: 0.013,
    band: 0.012,
    groove: 0.0024,
    count: 44,
    crown: [0, 0.245, -0.02],
    hanging: true,
    ears: false,
  },
  {
    ...BASE,
    profile: COVER,
    side: 0.009,
    top: 0.012,
    band: 0.012,
    groove: 0.0026,
    count: 48,
    crown: [0, 0.245, -0.01],
    hanging: true,
    follow: true,
    part: 0,
    ears: false,
  },
  {
    ...BASE,
    profile: SHORT,
    side: 0.016,
    top: 0.024,
    band: 0.014,
    groove: 0,
    curl: 0.0075,
    ears: false,
  },
  {
    ...BASE,
    profile: SHORT,
    side: 0.006,
    top: 0.0075,
    band: 0.01,
    groove: 0.0018,
    count: 52,
    crown: [0, 0.25, -0.075],
  },
  {
    ...BASE,
    profile: SHORT,
    side: 0.006,
    top: 0.0075,
    band: 0.01,
    groove: 0.0018,
    count: 52,
    crown: [0, 0.148, -0.118],
  },
  {
    ...BASE,
    profile: COVER,
    side: 0.011,
    top: 0.015,
    band: 0.012,
    groove: 0.0026,
    count: 40,
    curl: 0.0028,
    crown: [0, 0.245, -0.02],
    hanging: true,
    follow: true,
    ears: false,
  },
  {
    ...BASE,
    profile: SHORT,
    side: 0.006,
    top: 0.014,
    front: 0.006,
    band: 0.018,
    crown: [0.02, 0.232, -0.05],
  },
];

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Head-local hairline height at a point (below it the scalp is bare). */
function hairlineAt(profile: Profile, x: number, z: number): number {
  const a = Math.abs(Math.atan2(x, z - CRANIUM.c[2]));
  let prev = profile[0] ?? [0, 0.2];
  for (let i = 1; i < profile.length; i++) {
    const cur = profile[i];
    if (!cur) break;
    if (a <= cur[0])
      return prev[1] + (cur[1] - prev[1]) * smooth((a - prev[0]) / (cur[0] - prev[0]));
    prev = cur;
  }
  return prev[1];
}

/** Hash-based 3D value noise in [-1, 1] (worker-safe, deterministic). */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const h = (a: number, b: number, c: number): number => {
    let n = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(
      l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u),
      l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

/** Shell thickness: fuller on top and at the front, thinning to a fine edge at the hairline. */
function thickness(st: HairStyle, x: number, y: number, z: number): number {
  // Short sides, fuller top: the volume only builds above the temples.
  const up = smooth((y - 0.15) / 0.08);
  const lift = smooth(z / 0.07) * smooth((y - 0.16) / 0.06);
  const full = st.side + (st.top - st.side) * up + st.front * lift;
  return full * (0.55 + 0.45 * smooth((y - hairlineAt(st.profile, x, z)) / st.band));
}

/** The skull-hugging hair shell (an inflated cranium with varying thickness). */
function capField(hs: HeadSpace, st: HairStyle): Shape {
  const [cx, cy, cz] = CRANIUM.c;
  const [rx, ry, rz] = CRANIUM.r;
  const pad = st.top + st.front + 0.01;
  return hs.fn(
    (x, y, z) => {
      const th = thickness(st, x, y, z);
      const ax = rx + th;
      const ay = ry + th;
      const az = rz + th;
      const qx = (x - cx) / ax;
      const qy = (y - cy) / ay;
      const qz = (z - cz) / az;
      const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const k1 = Math.sqrt((qx / ax) ** 2 + (qy / ay) ** 2 + (qz / az) ** 2);
      return k1 < 1e-9 ? -ax : (k0 * (k0 - 1)) / k1;
    },
    {
      min: [cx - rx - pad, cy - ry - pad, cz - rz - pad],
      max: [cx + rx + pad, cy + ry + pad, cz + rz + pad],
    },
  );
}

/** Strand clumps radiating from the crown, a combed part line and curl bumps. */
function strandDisplace(hs: HeadSpace, st: HairStyle): Displace {
  const [cx, cy, cz] = CRANIUM.c;
  const axis = norm3(sub3(st.crown, CRANIUM.c));
  const b1 = norm3(Math.abs(axis[0]) < 0.9 ? cross3(axis, [1, 0, 0]) : cross3(axis, [0, 1, 0]));
  const b2 = cross3(axis, b1);
  const [ox, oy, oz] = hs.origin;
  const k = hs.k;
  return (p, d) => {
    if (d > 0.02) return d;
    const x = (p[0] - ox) / k;
    const y = (p[1] - oy) / k;
    const z = (p[2] - oz) / k;
    let off = 0;
    if (st.groove > 0) {
      const vx = x - cx;
      const vy = y - cy;
      const vz = z - cz;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      const cosPolar = (vx * axis[0] + vy * axis[1] + vz * axis[2]) / len;
      const phi = Math.atan2(
        vx * b2[0] + vy * b2[1] + vz * b2[2],
        vx * b1[0] + vy * b1[1] + vz * b1[2],
      );
      const w = Math.sin(phi * st.count + noise3(x * 26, y * 26, z * 26) * 2.4);
      const fade = smooth((0.97 - cosPolar) / 0.3);
      // Hanging lengths keep full strand texture below the ears (it is not a scalp edge there),
      // while the hairline around the face stays clean.
      const edge = smooth((y - hairlineAt(st.profile, x, z)) / st.band);
      const ramp = st.hanging ? Math.max(edge, smooth((0.1 - y) / 0.04)) : edge;
      off += w * w * st.groove * fade * (0.35 + 0.65 * ramp);
    }
    if (st.curl > 0)
      off +=
        (noise3(x * 58, y * 58, z * 58) * 0.5 +
          0.5 +
          (noise3(x * 130, y * 130, z * 130) * 0.5 + 0.5) * 0.3) *
        st.curl;
    if (st.part !== null) {
      const dx = (x - st.part) / 0.0045;
      off += 0.0048 * Math.exp(-dx * dx) * smooth((y - 0.2) / 0.025) * smooth((z + 0.04) / 0.04);
    }
    return d + off * k;
  };
}

export interface HairResult {
  hair: Sculpt | null;
  hat: Sculpt | null;
  /** Crown (whorl) point in bind space: strand flow radiates from it. */
  crown: V3;
  /** Styles whose strands hang down (flow biased downward below the ears). */
  hanging: boolean;
  /** Long hair whose lower strands should be skinned to the chest. */
  follow: boolean;
  /** Head-local hairline height at (x, z) for tinting the scalp; null when bald. */
  hairline: ((x: number, z: number) => number) | null;
}

/**
 * Hair: a shell over the skull that thins to a natural hairline, style volumes (fringes, quiffs,
 * bobs, long hair), strand clumps along the comb direction and curls. Hats hide the hair under them.
 */
export function hairSculpt(spec: AvatarSpec, hs: HeadSpace): HairResult {
  const st = STYLES[spec.hairStyle] ?? null;
  const hat = headwearSculpt(spec, hs);
  const crown = hs.p(...(st?.crown ?? CROWN));
  if (!st && spec.facialHair < 2)
    return { hair: null, hat, crown, hanging: false, follow: false, hairline: null };
  const sc = new Sculpt();
  const add = (s: Shape, k: number, tag = TAG_HAIR): void => {
    sc.add(hs.shape(s), hs.r(k), 'head', tag);
  };
  if (st) {
    sc.add(capField(hs, st), 0, 'head', TAG_HAIR);
    sc.clip(
      hs.fn((x, y, z) => (hairlineAt(st.profile, x, z) - y) * 0.9, null),
      hs.r(0.0025),
    );
    styleVolumes(spec.hairStyle, add, sc, hs);
    // Keep the face clear of bangs and long hair.
    sc.sub(hs.shape(ell([0, 0.075, 0.08], [0.086, 0.086, 0.07])), hs.r(0.012));
    if (st.ears)
      for (const x of [0.098, -0.098])
        sc.sub(hs.shape(ell([x, 0.108, 0.0], [0.016, 0.028, 0.02])), hs.r(0.006));
  }
  addFacialHair(spec, hs, sc);
  // Hair never pokes through a hat: carve the hat's solid volume (plus a hair's breadth).
  if (hat) sc.sub({ t: 'group', s: hat }, hs.r(0.004));
  if (st) sc.displace = strandDisplace(hs, st);
  const hairline = st ? (x: number, z: number): number => hairlineAt(st.profile, x, z) : null;
  return {
    hair: sc,
    hat,
    crown,
    hanging: st?.hanging ?? false,
    follow: st?.follow === true,
    hairline,
  };
}

function styleVolumes(
  style: number,
  add: (s: Shape, k: number) => void,
  sc: Sculpt,
  hs: HeadSpace,
): void {
  switch (style) {
    case 2:
      add(ell([0.004, 0.207, 0.074], [0.074, 0.028, 0.032]), 0.022);
      break;
    case 3:
      // Combed over from the part: a soft roll over the forehead sloping to the far temple.
      add(ell([-0.01, 0.224, 0.02], [0.084, 0.036, 0.068], invRotation(0, 0, 0.12)), 0.03);
      add(cone([0.03, 0.214, 0.07], [-0.066, 0.19, 0.064], 0.018, 0.013), 0.022);
      break;
    case 4:
      add(ell([0, 0.236, 0.05], [0.066, 0.046, 0.058], invRotation(-0.35, 0, 0)), 0.035);
      add(ell([0.004, 0.25, 0.078], [0.05, 0.032, 0.03]), 0.025);
      break;
    case 5:
      add(ell([0, 0.108, -0.012], [0.124, 0.142, 0.128]), 0.03);
      // Bangs: a thin fringe lying on the forehead rather than a visor.
      add(ell([0, 0.178, 0.082], [0.084, 0.026, 0.02]), 0.02);
      sc.clip(hs.shape(half([0, -1, 0], -0.014)), hs.r(0.012));
      break;
    case 6:
      // One envelope over the skull flowing into the hanging length (no ledge at the back).
      add(ell([0, 0.122, -0.016], [0.116, 0.13, 0.122]), 0.03);
      add(cone([0, 0.08, -0.034], [0, -0.2, -0.07], 0.104, 0.08), 0.06);
      for (const x of [0.084, -0.084])
        add(cone([x, 0.12, 0.024], [x * 1.1, -0.06, 0.04], 0.03, 0.02), 0.035);
      break;
    case 7:
      add(ell([0, 0.168, -0.014], [0.136, 0.126, 0.14]), 0.03);
      sc.clip(hs.shape(half([0, -1, 0], -0.075)), hs.r(0.02));
      break;
    case 8:
      add(sph([0, 0.246, -0.076], 0.047), 0.022);
      add(torus([0, 0.214, -0.064], 0.033, 0.008, invRotation(-0.9, 0, 0)), 0.006);
      break;
    case 9:
      add(sph([0, 0.148, -0.116], 0.024), 0.014);
      add(cone([0, 0.146, -0.128], [0, 0.03, -0.162], 0.028, 0.034), 0.02);
      add(cone([0, 0.03, -0.162], [0, -0.1, -0.138], 0.034, 0.014), 0.03);
      break;
    case 10:
      add(ell([0, 0.124, -0.018], [0.12, 0.13, 0.126]), 0.03);
      add(cone([0, 0.08, -0.03], [0, -0.05, -0.05], 0.11, 0.1), 0.06);
      sc.clip(hs.shape(half([0, -1, 0], 0.07)), hs.r(0.02));
      // Side-swept fringe.
      add(ell([0.02, 0.18, 0.08], [0.078, 0.026, 0.02], invRotation(0, 0, -0.1)), 0.02);
      break;
    case 11:
      add(ell([0.016, 0.218, 0.004], [0.086, 0.044, 0.094]), 0.03);
      add(cone([0.07, 0.212, 0.064], [-0.048, 0.176, 0.094], 0.03, 0.016), 0.028);
      break;
    default:
      break;
  }
}
