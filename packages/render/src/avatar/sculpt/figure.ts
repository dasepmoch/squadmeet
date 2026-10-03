import type { AvatarSpec } from '@huddle/shared';
import type { BoneName } from '../rig.ts';
import { add3, norm3, scale3, type V3 } from './sdf.ts';

/** Body measurements (meters, bind pose) derived from the spec. Left side is +X, facing +Z. */
export interface Figure {
  height: number;
  /** Uniform scale of the body relative to the 1.64 m reference. */
  s: number;
  /** Scale of the sculpted head (heads stay relatively large: stylized, friendly proportions). */
  headScale: number;
  joints: Record<BoneName, V3>;
  tips: { head: V3; handL: V3; handR: V3; toeL: V3; toeR: V3 };
  /** Width multipliers from the body type. */
  width: number;
  shoulder: number;
  waist: number;
  belly: number;
  hip: number;
  limb: number;
  hipY: number;
  waistY: number;
  chestY: number;
  shoulderY: number;
  kneeY: number;
  ankleY: number;
  hipJointY: number;
}

const BODY_TYPES: readonly {
  width: number;
  shoulder: number;
  waist: number;
  belly: number;
  hip: number;
  limb: number;
}[] = [
  { width: 0.9, shoulder: 0.94, waist: 0.9, belly: 0, hip: 0.94, limb: 0.88 },
  { width: 1, shoulder: 1, waist: 1, belly: 0, hip: 1, limb: 1 },
  { width: 1.04, shoulder: 1.1, waist: 0.96, belly: 0, hip: 0.98, limb: 1.1 },
  { width: 1.08, shoulder: 1.02, waist: 1.18, belly: 1, hip: 1.1, limb: 1.06 },
];

/** Head-local eyeball center (left eye, +X); big, low-set eyes read as friendly. */
export const EYE_POS: V3 = [0.042, 0.112, 0.086];

export function mirrorX(p: V3): V3 {
  return [-p[0], p[1], p[2]];
}

export function computeFigure(spec: AvatarSpec): Figure {
  const height = 1.52 + Math.max(0, Math.min(8, spec.height)) * 0.03;
  const s = height / 1.64;
  // Friendly stylized proportions: about five heads tall, like modern social avatars.
  const headScale = 1.3 * (1 + (s - 1) * 0.35);
  const bt = BODY_TYPES[spec.bodyType] ?? BODY_TYPES[1];
  const type = bt ?? { width: 1, shoulder: 1, waist: 1, belly: 0, hip: 1, limb: 1 };
  const sh = 0.18 * type.shoulder;
  const P = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  // The arm socket sits a deltoid's radius below the shoulder line (level with the neck base),
  // otherwise the shoulders ride up and the figure looks hunched.
  const shoulderY = 1.258;
  const armDir = norm3([0.19, -0.98, 0]);
  const foreDir = norm3([0.12, -0.98, 0.14]);
  const handDir = norm3([0.12, -0.98, 0.1]);
  const upperArm = P(sh, shoulderY, -0.015);
  const elbow = add3(upperArm, scale3(armDir, 0.258 * s));
  const wrist = add3(elbow, scale3(foreDir, 0.238 * s));
  const handTip = add3(wrist, scale3(handDir, 0.165 * s));
  const neckBase = P(0, 1.3, -0.012);
  // A visible neck keeps the big stylized head from looking hunched into the collar.
  const headJoint: V3 = [0, neckBase[1] + 0.078 * s, -0.004 * s];
  const eye = scale3(EYE_POS, headScale);
  const joints: Record<BoneName, V3> = {
    root: [0, 0, 0],
    hips: P(0, 0.845, -0.005),
    spine: P(0, 0.96, -0.004),
    chest: P(0, 1.1, -0.006),
    neck: neckBase,
    head: headJoint,
    jaw: add3(headJoint, scale3([0, 0.052, 0.07], headScale)),
    eyeL: add3(headJoint, eye),
    eyeR: add3(headJoint, mirrorX(eye)),
    lidL: add3(headJoint, eye),
    lidR: add3(headJoint, mirrorX(eye)),
    browL: add3(headJoint, scale3([0.043, 0.147, 0.1], headScale)),
    browR: add3(headJoint, scale3([-0.043, 0.147, 0.1], headScale)),
    shoulderL: P(0.028, 1.268, -0.012),
    upperArmL: upperArm,
    lowerArmL: elbow,
    handL: wrist,
    shoulderR: mirrorX(P(0.028, 1.268, -0.012)),
    upperArmR: mirrorX(upperArm),
    lowerArmR: mirrorX(elbow),
    handR: mirrorX(wrist),
    thighL: P(0.09 * type.hip, 0.8, 0),
    shinL: P(0.095 * type.hip, 0.455, 0.012),
    footL: P(0.1 * type.hip, 0.085, -0.02),
    thighR: mirrorX(P(0.09 * type.hip, 0.8, 0)),
    shinR: mirrorX(P(0.095 * type.hip, 0.455, 0.012)),
    footR: mirrorX(P(0.1 * type.hip, 0.085, -0.02)),
  };
  return {
    height,
    s,
    headScale,
    joints,
    tips: {
      head: add3(headJoint, scale3([0, 0.26, 0], headScale)),
      handL: handTip,
      handR: mirrorX(handTip),
      toeL: P(0.105 * type.hip, 0.03, 0.16),
      toeR: mirrorX(P(0.105 * type.hip, 0.03, 0.16)),
    },
    width: type.width,
    shoulder: type.shoulder,
    waist: type.waist,
    belly: type.belly,
    hip: type.hip,
    limb: type.limb,
    hipY: 0.845 * s,
    waistY: 0.97 * s,
    chestY: 1.12 * s,
    shoulderY: shoulderY * s,
    kneeY: 0.455 * s,
    ankleY: 0.085 * s,
    hipJointY: 0.8 * s,
  };
}
