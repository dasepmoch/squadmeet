import type { AvatarRig } from './rig.ts';

/**
 * Hip joint height above the sitting surface (meters). Seated players stand their transform (and
 * so the avatar root) on the seat surface, so this is also the seated hips' height above the root.
 */
export const HIP_ABOVE_SEAT = 0.075;

/** Leg proportions read from the bind pose (avatar-local meters). */
export interface LegMetrics {
  /** Hip joint height relative to the hips bone (negative: below it). */
  hipJointY: number;
  thigh: number;
  shin: number;
  /** Ankle height above the floor when standing. */
  ankle: number;
}

export function legMetrics(rig: AvatarRig): LegMetrics {
  const root = rig.restPosition('root');
  const hips = rig.restPosition('hips');
  const hipJoint = rig.restPosition('thighL');
  const knee = rig.restPosition('shinL');
  const ankle = rig.restPosition('footL');
  return {
    hipJointY: hipJoint.y,
    thigh: knee.length(),
    shin: ankle.length(),
    ankle: root.y + hips.y + hipJoint.y + knee.y + ankle.y,
  };
}

/** Thighs never slope down more steeply than this (radians from straight down). */
const MIN_THIGH_PITCH = 1.05;

/** Leg rotations added on top of the seated pose (radians, relative to the bind pose). */
export interface SeatedLegs {
  /** Lowers the knees on tall seats (added to the thigh's forward pitch, so >= 0). */
  thigh: number;
  shin: number;
  foot: number;
}

/**
 * Plants the feet on the floor in front of a seat. The root stands on the seat surface (the floor
 * is `seatHeight` below it). With the thigh pitched forward by `thighPitch`, the shin swings
 * forward until the ankle reaches its standing height. On seats too tall for that, the knees drop
 * (thighs slope down) until a vertical shin reaches the floor, then the feet dangle. The foot
 * counter-rotates so the sole stays level.
 */
export function seatedLegs(
  m: LegMetrics,
  seatHeight: number,
  thighPitch: number,
  out: SeatedLegs,
): SeatedLegs {
  const hipJoint = HIP_ABOVE_SEAT + m.hipJointY;
  // How far the hip joint is above the ankle's target height.
  const reach = hipJoint + seatHeight - m.ankle;
  let pitch = thighPitch;
  const kneeDrop = (reach - m.shin) / m.thigh;
  if (kneeDrop > Math.cos(pitch))
    pitch = Math.max(MIN_THIGH_PITCH, Math.acos(Math.min(1, kneeDrop)));
  const knee = hipJoint - m.thigh * Math.cos(pitch);
  const drop = knee + seatHeight - m.ankle;
  const forward = drop >= m.shin ? 0 : Math.acos(Math.max(-1, drop / m.shin));
  out.thigh = thighPitch - pitch;
  out.shin = pitch - forward;
  out.foot = forward;
  return out;
}
