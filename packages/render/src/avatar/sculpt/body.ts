import type { Figure } from './figure.ts';
import {
  add3,
  cross3,
  norm3,
  scale3,
  sub3,
  type Fade,
  type M3,
  type Sculpt,
  type Shape,
  type V3,
} from './sdf.ts';

export const sph = (c: V3, r: number): Shape => ({ t: 'sphere', c, r });
export const ell = (c: V3, r: V3, inv?: M3): Shape =>
  inv ? { t: 'ellipsoid', c, r, inv } : { t: 'ellipsoid', c, r };
export const cone = (a: V3, b: V3, ra: number, rb: number): Shape => ({ t: 'cone', a, b, ra, rb });
export const box = (c: V3, h: V3, r: number, inv?: M3): Shape =>
  inv ? { t: 'box', c, h, r, inv } : { t: 'box', c, h, r };
export const torus = (c: V3, R: number, r: number, inv?: M3): Shape =>
  inv ? { t: 'torus', c, R, r, inv } : { t: 'torus', c, R, r };
/** Half-space keeping points where dot(n, p) < d. */
export const half = (n: V3, d: number): Shape => ({ t: 'plane', n, d });

const UP: V3 = [0, 1, 0];

/** Garment/skin layer options: `t` inflates every shape, `ease` loosens the torso. */
export interface Layer {
  t: number;
  ease: number;
  tag: number;
}

export type Side = 'L' | 'R';

function sideX(side: Side): number {
  return side === 'L' ? 1 : -1;
}

/** Pelvis, waist, ribcage, chest, shoulder girdle and trapezius. */
export function torso(f: Figure, l: Layer, sc: Sculpt): void {
  const s = f.s;
  const w = f.width;
  const P = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  const { t, ease, tag } = l;
  sc.add(
    ell(P(0, 0.868, -0.004), [
      0.152 * s * f.hip + t + ease,
      0.1 * s + t,
      0.102 * s + t + ease * 0.6,
    ]),
    0,
    'hips',
    tag,
  );
  for (const x of [0.058, -0.058])
    sc.add(sph(P(x * f.hip, 0.838, -0.052), 0.078 * s * f.hip + t), 0.05 * s, 'hips', tag);
  sc.add(
    ell(P(0, 0.975, 0.004), [
      0.132 * s * w * f.waist + t + ease,
      0.1 * s + t,
      0.09 * s * f.waist + t + ease,
    ]),
    0.06 * s,
    'spine',
    tag,
  );
  if (f.belly > 0) sc.add(sph(P(0, 0.975, 0.04), 0.108 * s + t + ease), 0.07 * s, 'spine', tag);
  sc.add(
    ell(P(0, 1.12, -0.004), [
      0.157 * s * w * f.shoulder + t + ease,
      0.14 * s + t,
      0.104 * s + t + ease * 0.7,
    ]),
    0.07 * s,
    'chest',
    tag,
  );
  sc.add(
    ell(P(0, 1.165, 0.034), [0.128 * s * w + t + ease * 0.5, 0.07 * s + t, 0.07 * s + t]),
    0.05 * s,
    'chest',
    tag,
  );
  // Trapezius: slopes from the neck down to the shoulder tips (a level bar reads as shoulder pads).
  const sh = 0.13 * f.shoulder;
  for (const x of [sh, -sh])
    sc.add(
      cone(P(0, 1.266, -0.024), P(x, 1.236, -0.018), 0.05 * s + t, 0.041 * s + t),
      0.05 * s,
      'chest',
      tag,
    );
  sc.add(
    cone(P(0, 1.25, -0.028), P(0, 1.33, -0.02), 0.066 * s + t, 0.046 * s + t),
    0.05 * s,
    'neck',
    tag,
  );
}

/** Blend fade that only lets a limb melt into the torso near its root joint. */
export function rootFade(y: number, below: number, above: number): Fade {
  return { axis: UP, from: y - below, to: y + above };
}

/**
 * Arm from the shoulder cap down to the wrist. `to` limits the extent: 'elbow' stops at the
 * elbow (short sleeves), 'wrist' covers the forearm.
 */
export function arm(
  f: Figure,
  side: Side,
  l: Layer,
  sc: Sculpt,
  to: 'elbow' | 'wrist' = 'wrist',
): void {
  const j = f.joints;
  const L = side === 'L';
  const up = L ? j.upperArmL : j.upperArmR;
  const elbow = L ? j.lowerArmL : j.lowerArmR;
  const wrist = L ? j.handL : j.handR;
  const r = f.limb * f.s;
  const { t, tag } = l;
  const fade = rootFade(f.shoulderY, 0.13 * f.s, -0.02 * f.s);
  const ua = L ? 'upperArmL' : 'upperArmR';
  // Deltoid: a soft cap just below the shoulder line; the arm itself starts a little lower so
  // its round end does not stack a second bump on top.
  const dir = norm3(sub3(elbow, up));
  sc.add(sph(add3(up, [0, -0.016 * f.s, 0.002 * f.s]), 0.043 * r + t), 0.04 * f.s, ua, tag, fade);
  sc.add(
    cone(add3(up, scale3(dir, 0.014 * f.s)), elbow, 0.042 * r + t, 0.035 * r + t),
    0.035 * f.s,
    ua,
    tag,
    fade,
  );
  if (to === 'wrist')
    sc.add(
      cone(elbow, wrist, 0.037 * r + t, 0.026 * r + t),
      0.018 * f.s,
      L ? 'lowerArmL' : 'lowerArmR',
      tag,
    );
}

/** Thigh, knee, shin and calf. `to` 'knee' stops above the knee (shorts). */
export function leg(
  f: Figure,
  side: Side,
  l: Layer,
  sc: Sculpt,
  to: 'knee' | 'ankle' = 'ankle',
): void {
  const j = f.joints;
  const L = side === 'L';
  const hip = L ? j.thighL : j.thighR;
  const knee = L ? j.shinL : j.shinR;
  const ankle = L ? j.footL : j.footR;
  const r = f.limb * f.s;
  const { t, tag } = l;
  const fade = rootFade(f.hipJointY, 0.11 * f.s, 0.02 * f.s);
  const th = L ? 'thighL' : 'thighR';
  const sn = L ? 'shinL' : 'shinR';
  sc.add(cone(hip, knee, 0.079 * r * f.hip + t, 0.053 * r + t), 0.05 * f.s, th, tag, fade);
  if (to === 'knee') return;
  sc.add(sph(add3(knee, [0, 0.005 * f.s, 0.022 * f.s]), 0.043 * r + t), 0.02 * f.s, sn, tag);
  sc.add(cone(knee, ankle, 0.05 * r + t, 0.033 * r + t), 0.02 * f.s, sn, tag);
  const calf = add3(knee, [0, -0.13 * f.s, -0.022 * f.s]);
  sc.add(ell(calf, [0.042 * r + t, 0.085 * r + t, 0.042 * r + t]), 0.03 * f.s, sn, tag);
}

/** Foot volume (heel, arch, toes) used as the base shape for shoes. */
export function foot(f: Figure, side: Side, t: number, tag: number, sc: Sculpt): void {
  const j = f.joints;
  const ankle = side === 'L' ? j.footL : j.footR;
  const toe = side === 'L' ? f.tips.toeL : f.tips.toeR;
  const s = f.s;
  const bone = side === 'L' ? 'footL' : 'footR';
  const x = ankle[0];
  sc.add(sph([x, 0.045 * s, ankle[2] - 0.035 * s], 0.042 * s + t), 0, bone, tag);
  sc.add(
    ell([x, 0.042 * s, (ankle[2] + toe[2]) / 2], [0.046 * s + t, 0.036 * s + t, 0.118 * s + t]),
    0.03 * s,
    bone,
    tag,
  );
  sc.add(
    ell(
      [x + (side === 'L' ? -0.004 : 0.004) * s, 0.034 * s, toe[2] - 0.035 * s],
      [0.047 * s + t, 0.03 * s + t, 0.05 * s + t],
    ),
    0.03 * s,
    bone,
    tag,
  );
  sc.add(cone(ankle, [x, 0.06 * s, ankle[2]], 0.036 * s + t, 0.04 * s + t), 0.03 * s, bone, tag);
}

/** Basis of a hand: along the fingers, palm normal (towards the body) and thumb direction. */
export function handFrame(f: Figure, side: Side): { wrist: V3; u: V3; n: V3; w: V3 } {
  const j = f.joints;
  const wrist = side === 'L' ? j.handL : j.handR;
  const tip = side === 'L' ? f.tips.handL : f.tips.handR;
  const u = norm3(sub3(tip, wrist));
  const inward: V3 = [-sideX(side), 0, 0];
  const n = norm3(sub3(inward, scale3(u, inward[0] * u[0])));
  const w = norm3(side === 'L' ? cross3(n, u) : cross3(u, n));
  return { wrist, u, n, w };
}

/** Stylized but anatomical hand: palm, four slightly curled two-segment fingers and a thumb. */
export function hand(f: Figure, side: Side, t: number, sc: Sculpt): void {
  const { wrist, u, n, w } = handFrame(f, side);
  const s = f.s * f.limb * 0.98;
  const bone = side === 'L' ? 'handL' : 'handR';
  const at = (a: number, b: number, c: number): V3 =>
    add3(wrist, add3(scale3(u, a * s), add3(scale3(w, b * s), scale3(n, c * s))));
  const inv: M3 = [w[0], w[1], w[2], u[0], u[1], u[2], n[0], n[1], n[2]];
  sc.add(
    cone(at(-0.06, 0, 0), at(0.012, 0, 0.002), 0.026 * s + t, 0.024 * s + t),
    0,
    side === 'L' ? 'lowerArmL' : 'lowerArmR',
    0,
  );
  sc.add(
    box(at(0.046, 0.002, 0.001), [0.041 * s + t, 0.046 * s + t, 0.0145 * s + t], 0.013 * s, inv),
    0.018 * s,
    bone,
    0,
  );
  const fingers: [number, number, number][] = [
    [0.026, 0.074, 0.0088],
    [0.009, 0.081, 0.009],
    [-0.009, 0.076, 0.0086],
    [-0.025, 0.062, 0.0076],
  ];
  fingers.forEach(([off, len, rad], i) => {
    const base = at(0.086, off, 0.001);
    const curl1 = 0.2 + i * 0.03;
    const d1 = norm3(add3(scale3(u, Math.cos(curl1)), scale3(n, Math.sin(curl1))));
    const mid = add3(base, scale3(d1, len * 0.56 * s));
    const curl2 = curl1 + 0.35;
    const d2 = norm3(add3(scale3(u, Math.cos(curl2)), scale3(n, Math.sin(curl2))));
    const end = add3(mid, scale3(d2, len * 0.44 * s));
    sc.add(cone(base, mid, rad * s + t, rad * 0.93 * s + t), 0.004 * s, bone, 0);
    sc.add(cone(mid, end, rad * 0.92 * s + t, rad * 0.8 * s + t), 0.003 * s, bone, 0);
  });
  const tb = at(0.022, 0.03, 0.01);
  const td1 = norm3(add3(scale3(w, 0.75), add3(scale3(u, 0.55), scale3(n, 0.35))));
  const tm = add3(tb, scale3(td1, 0.036 * s));
  const td2 = norm3(add3(scale3(w, 0.35), add3(scale3(u, 0.85), scale3(n, 0.45))));
  const te = add3(tm, scale3(td2, 0.03 * s));
  sc.add(cone(tb, tm, 0.0125 * s + t, 0.0105 * s + t), 0.01 * s, bone, 0);
  sc.add(cone(tm, te, 0.0102 * s + t, 0.0088 * s + t), 0.004 * s, bone, 0);
}
