import { smoothstep } from '@huddle/shared';
import type { FaceOut, PoseMap } from './emotes.ts';
import type { BoneName } from './rig.ts';

/** Rotations of one arm (shoulder excluded), written for the left side. */
interface ArmPose {
  upper: readonly [number, number, number];
  lower: readonly [number, number, number];
  hand: readonly [number, number, number];
}

type Side = 'L' | 'R';

/** Holding something in front: elbow bent, forearm up, the item at belly height. */
const HOLD: ArmPose = { upper: [-0.3, -0.15, -0.1], lower: [-1.3, -0.35, 0], hand: [0, 0, -0.08] };
/** Hand at the mouth (sip, bite). */
const TO_MOUTH: ArmPose = { upper: [-1.0, -0.12, -0.09], lower: [-2.2, -0.3, 0], hand: [0, 0, 0] };
/** Arm stretched out front, the phone screen turned to the room. */
const SHOW: ArmPose = { upper: [-1.25, -0.1, -0.05], lower: [-0.45, -0.2, 0], hand: [0, 0, 0] };
/** A sign held high overhead. */
const OVERHEAD: ArmPose = { upper: [-0.25, 0, 2.55], lower: [-0.1, 0, 0.25], hand: [0, 0, 0] };
/** Both hands on a mop handle. */
const MOP: ArmPose = { upper: [-0.85, -0.1, -0.15], lower: [-0.7, -0.3, 0], hand: [0, 0, 0] };
/** Hands together under the chin (blushing). */
const CLASP: ArmPose = { upper: [-0.55, -0.2, -0.18], lower: [-1.65, -0.6, 0], hand: [0, 0, 0] };
/** Back of the hand across the face (wiping tomato off). */
const WIPE: ArmPose = { upper: [-1.35, -0.1, -0.25], lower: [-1.9, -0.5, 0], hand: [0, 0, 0] };

/** Seconds each item / reaction action holds before blending out. */
export const ITEM_ACTION_LENGTH: Record<string, number> = {
  sip: 2.4,
  eat: 2.0,
  showPhone: 2.6,
  signUp: 2.8,
  mop: 3.2,
  wipe: 1.9,
  blush: 2.2,
};

/** Which hand holds an item: a picked-up paper plane is thrown, so it sits in the right. */
export function holdingSide(item: string): Side {
  return item === 'plane' ? 'R' : 'L';
}

/** How far into using its item an action is (0..1): the cup at the lips, the sign up high. */
export function useProgress(id: string, t: number): number {
  switch (id) {
    case 'sip':
      return smoothstep(0.3, 0.8, t) * (1 - smoothstep(1.6, 2.1, t));
    case 'eat':
      return smoothstep(0.2, 0.55, t) * (1 - smoothstep(1.0, 1.4, t));
    case 'showPhone':
      return smoothstep(0.15, 0.5, t) * (1 - smoothstep(2.1, 2.5, t));
    case 'signUp':
      return smoothstep(0.1, 0.45, t) * (1 - smoothstep(2.3, 2.75, t));
    default:
      return 0;
  }
}

/** Seconds into `eat` when the bite is taken (the slice gets shorter). */
export const BITE_AT = 0.6;

const LEFT = ['upperArmL', 'lowerArmL', 'handL'] as const;
const RIGHT = ['upperArmR', 'lowerArmR', 'handR'] as const;

/** Blends one arm toward a pose (`k` 0..1); right arms mirror the left-side numbers. */
function blendArm(p: PoseMap, side: Side, pose: ArmPose, k: number): void {
  const m = side === 'L' ? 1 : -1;
  const bones: readonly BoneName[] = side === 'L' ? LEFT : RIGHT;
  const parts = [pose.upper, pose.lower, pose.hand];
  for (let b = 0; b < 3; b++) {
    const q = p[bones[b] as BoneName];
    const t = parts[b] as readonly [number, number, number];
    q.rx += (t[0] - q.rx) * k;
    q.ry += (t[1] * m - q.ry) * k;
    q.rz += (t[2] * m - q.rz) * k;
  }
}

/**
 * The arm holding an item (weight `k`, eased in by the animator). Seated people rest it a little
 * lower, toward the lap.
 */
export function applyHold(p: PoseMap, side: Side, k: number, sitBlend: number, t: number): void {
  if (!(k > 0)) return;
  blendArm(p, side, HOLD, k);
  const lower = side === 'L' ? p.lowerArmL : p.lowerArmR;
  lower.rx += (0.25 * sitBlend + Math.sin(t * 1.6) * 0.02) * k;
}

/**
 * Item and reaction actions layered over the pose (`k`: the action's fade envelope). Returns a
 * hips offset like `applyAction`, or null when `id` is not one of them.
 */
export function applyItemAction(
  id: string,
  t: number,
  k: number,
  p: PoseMap,
  face: FaceOut,
): number | null {
  const s = Math.sin;
  switch (id) {
    case 'sip': {
      const lift = useProgress(id, t);
      blendArm(p, 'L', HOLD, k);
      blendArm(p, 'L', TO_MOUTH, lift * k);
      p.head.rx -= lift * 0.18 * k;
      face.squint += lift * 0.4 * k;
      return 0;
    }
    case 'eat': {
      const lift = useProgress(id, t);
      blendArm(p, 'L', HOLD, k);
      blendArm(p, 'L', TO_MOUTH, lift * 0.92 * k);
      p.head.rx += lift * 0.08 * k;
      const chewing = smoothstep(BITE_AT, BITE_AT + 0.15, t) * (1 - smoothstep(1.7, 1.95, t));
      face.mouthOpen += (lift * 0.5 + Math.abs(s(t * 13)) * 0.3 * chewing) * k;
      face.smile += 0.35 * k;
      return 0;
    }
    case 'showPhone': {
      const out = useProgress(id, t);
      blendArm(p, 'L', HOLD, k);
      blendArm(p, 'L', SHOW, out * k);
      p.chest.ry += 0.12 * out * k;
      face.brow += 0.45 * out * k;
      face.smile += 0.5 * k;
      return 0;
    }
    case 'signUp': {
      const up = useProgress(id, t);
      blendArm(p, 'L', HOLD, k);
      blendArm(p, 'L', OVERHEAD, up * k);
      p.upperArmL.rz += s(t * 6) * 0.05 * up * k;
      p.chest.rz -= 0.05 * up * k;
      face.smile += 0.4 * k;
      face.brow += 0.3 * up * k;
      return 0;
    }
    case 'mop': {
      blendArm(p, 'L', MOP, k);
      blendArm(p, 'R', MOP, k);
      p.chest.ry += s(t * 4.2) * 0.38 * k;
      p.spine.ry += s(t * 4.2) * 0.12 * k;
      p.spine.rx += 0.18 * k;
      p.head.rx += 0.15 * k;
      face.smile += 0.3 * k;
      return -0.02 * k;
    }
    case 'wipe': {
      // A flinch, then the back of the right hand wipes the face, a few quick strokes.
      const flinch = s(Math.min(1, t * 2.4) * Math.PI) * (1 - smoothstep(0.35, 0.5, t));
      p.chest.rx -= flinch * 0.22 * k;
      p.head.rx -= flinch * 0.3 * k;
      const wipe = smoothstep(0.35, 0.6, t) * (1 - smoothstep(1.45, 1.75, t));
      blendArm(p, 'R', WIPE, wipe * k);
      p.lowerArmR.ry += s(t * 11) * 0.35 * wipe * k;
      p.head.ry += s(t * 11 + 1) * 0.07 * wipe * k;
      face.squint += 0.9 * k;
      face.mouthOpen += (flinch * 0.6 + 0.15) * k;
      return 0;
    }
    case 'blush': {
      blendArm(p, 'L', CLASP, k);
      blendArm(p, 'R', CLASP, k);
      p.head.rz += 0.16 * k;
      p.head.rx += 0.12 * k;
      p.hips.rz += s(t * 3) * 0.03 * k;
      face.smile += 1 * k;
      face.squint += 0.55 * k;
      return 0;
    }
    default:
      return null;
  }
}
