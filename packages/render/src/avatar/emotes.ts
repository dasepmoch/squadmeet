import { smoothstep } from '@huddle/shared';
import { applyItemAction, ITEM_ACTION_LENGTH } from './item-actions.ts';
import type { BoneName } from './rig.ts';

export interface Pose {
  rx: number;
  ry: number;
  rz: number;
}

export type PoseMap = Record<BoneName, Pose>;

/** Facial channels an action can drive (added on top of the idle face). */
export interface FaceOut {
  mouthOpen: number;
  smile: number;
  brow: number;
  squint: number;
}

/** Seconds each action holds before blending out (Infinity = until stopped). */
export const ACTION_LENGTH: Record<string, number> = {
  wave: 2.4,
  raiseHand: Number.POSITIVE_INFINITY,
  lowerHand: 0.45,
  clap: 2.2,
  cheer: 2.2,
  point: 1.8,
  shrug: 1.6,
  facepalm: 2.2,
  dance: 6,
  laugh: 2.4,
  nod: 1.2,
  headShake: 1.4,
  think: 3,
  bow: 1.8,
  throw: 0.75,
  hit: 0.9,
  thumbsUp: 1.8,
  ...ITEM_ACTION_LENGTH,
};

export const EMOTE_IDS = [
  'wave',
  'clap',
  'cheer',
  'thumbsUp',
  'laugh',
  'shrug',
  'facepalm',
  'think',
  'nod',
  'headShake',
  'bow',
  'dance',
] as const;

/** Seconds a raised hand takes to come down. */
export const LOWER_HAND_SECONDS = 0.45;

/**
 * Upper-body actions (emotes, throws, reactions) layered over locomotion. Rotations are local to
 * the A-pose bind: for the arms, -rx swings forward/up, rz abducts (sign mirrored per side).
 */
export function applyAction(
  id: string,
  t: number,
  p: PoseMap,
  face: FaceOut,
  seated: boolean,
): number {
  const len = ACTION_LENGTH[id] ?? 2;
  // Held actions (Infinity) never fade out; smoothstep(Infinity, Infinity) would be NaN and
  // poison the whole skeleton.
  const fadeOut = Number.isFinite(len) ? 1 - smoothstep(len, len + 0.3, t) : 1;
  // A lowering hand starts fully raised and eases down, instead of fading in like other actions.
  const k =
    id === 'lowerHand'
      ? 1 - smoothstep(0, LOWER_HAND_SECONDS, t)
      : smoothstep(0, 0.22, t) * fadeOut;
  if (!(k > 0)) return 0;
  const s = Math.sin;
  switch (id) {
    case 'wave':
      p.upperArmR.rz -= 2.35 * k;
      p.upperArmR.rx -= 0.25 * k;
      p.lowerArmR.rz -= (0.35 + s(t * 11) * 0.45) * k;
      p.handR.rz += s(t * 11 + 0.6) * 0.25 * k;
      p.head.rz -= 0.08 * k;
      face.smile += 0.6 * k;
      face.brow += 0.4 * k;
      break;
    case 'raiseHand':
    case 'lowerHand':
      p.upperArmR.rz -= 2.75 * k;
      p.upperArmR.rx -= 0.12 * k;
      p.lowerArmR.rz -= 0.12 * k;
      p.handR.rz += s(t * 3) * 0.05 * k;
      p.chest.rz -= 0.05 * k;
      face.brow += 0.3 * k;
      break;
    case 'clap': {
      const c = Math.max(0, s(t * 14));
      for (const [ua, la, sign] of [
        ['upperArmL', 'lowerArmL', -1],
        ['upperArmR', 'lowerArmR', 1],
      ] as const) {
        p[ua].rx -= 0.9 * k;
        p[ua].rz += sign * (0.1 - c * 0.12) * k;
        p[la].rx -= 1.2 * k;
        p[la].rz += sign * (0.55 + c * 0.35) * k;
      }
      face.smile += 0.8 * k;
      break;
    }
    case 'cheer': {
      const bounce = Math.abs(s(t * 7));
      p.upperArmL.rz += (2.5 + bounce * 0.2) * k;
      p.upperArmR.rz -= (2.5 + bounce * 0.2) * k;
      p.lowerArmL.rz += 0.3 * k;
      p.lowerArmR.rz -= 0.3 * k;
      p.spine.rx -= 0.08 * k;
      p.head.rx -= 0.15 * k;
      face.mouthOpen += 0.8 * k;
      face.smile += 0.9 * k;
      face.brow += 0.6 * k;
      return bounce * 0.035 * k * (seated ? 0 : 1);
    }
    case 'point':
    case 'thumbsUp':
      p.upperArmR.rx -= 1.3 * k;
      p.upperArmR.rz += 0.2 * k;
      p.lowerArmR.rx -= (id === 'thumbsUp' ? 0.9 : 0.15) * k;
      p.handR.rz -= (id === 'thumbsUp' ? 1.2 : 0) * k;
      p.chest.ry -= 0.12 * k;
      face.smile += 0.5 * k;
      break;
    case 'shrug':
      p.shoulderL.rz += 0.22 * k;
      p.shoulderR.rz -= 0.22 * k;
      p.upperArmL.rz -= 0.35 * k;
      p.upperArmR.rz += 0.35 * k;
      p.lowerArmL.rx -= 1.2 * k;
      p.lowerArmR.rx -= 1.2 * k;
      p.lowerArmL.ry -= 0.6 * k;
      p.lowerArmR.ry += 0.6 * k;
      p.head.rz += 0.12 * k;
      face.brow += 0.8 * k;
      face.smile -= 0.2 * k;
      break;
    case 'facepalm':
      p.upperArmR.rx -= 1.55 * k;
      p.upperArmR.rz += 0.3 * k;
      p.lowerArmR.rx -= 1.9 * k;
      p.head.rx += 0.35 * k;
      p.neck.rx += 0.1 * k;
      face.squint += 0.7 * k;
      break;
    case 'think':
      p.upperArmR.rx -= 1.1 * k;
      p.upperArmR.rz += 0.2 * k;
      p.lowerArmR.rx -= 2.1 * k;
      p.upperArmL.rx -= 0.6 * k;
      p.lowerArmL.rx -= 1.3 * k;
      p.lowerArmL.ry -= 0.8 * k;
      p.head.rz += 0.1 * k;
      p.head.ry -= 0.15 * k;
      face.brow += s(t * 2) * 0.2 * k;
      break;
    case 'laugh': {
      const shake = s(t * 16) * 0.5 + 0.5;
      p.spine.rx += (0.06 + shake * 0.05) * k;
      p.head.rx -= 0.2 * k;
      p.upperArmL.rx -= 0.4 * k;
      p.upperArmR.rx -= 0.4 * k;
      p.lowerArmL.rx -= 0.8 * k;
      p.lowerArmR.rx -= 0.8 * k;
      face.mouthOpen += (0.6 + shake * 0.4) * k;
      face.smile += 1 * k;
      face.squint += 0.6 * k;
      return shake * 0.012 * k;
    }
    case 'nod':
      p.head.rx += s(t * 9) * 0.22 * k;
      face.smile += 0.3 * k;
      break;
    case 'headShake':
      p.head.ry += s(t * 10) * 0.35 * k;
      face.brow -= 0.3 * k;
      break;
    case 'bow':
      p.spine.rx += 0.35 * k;
      p.chest.rx += 0.25 * k;
      p.head.rx += 0.2 * k;
      p.upperArmL.rx += 0.1 * k;
      p.upperArmR.rx += 0.1 * k;
      break;
    case 'dance': {
      const beat = t * 4.2;
      p.hips.rz += s(beat) * 0.1 * k;
      p.spine.rz -= s(beat) * 0.12 * k;
      p.chest.ry += s(beat * 0.5) * 0.25 * k;
      p.upperArmL.rz += (0.9 + s(beat) * 0.6) * k;
      p.upperArmR.rz -= (0.9 - s(beat) * 0.6) * k;
      p.lowerArmL.rz += 0.9 * k;
      p.lowerArmR.rz -= 0.9 * k;
      p.head.rz += s(beat) * 0.12 * k;
      face.smile += 1 * k;
      face.mouthOpen += 0.3 * k;
      return Math.abs(s(beat)) * 0.04 * k * (seated ? 0 : 1);
    }
    case 'throw': {
      // Wind-up (0..0.2 s), release (~0.26 s, the engine's release delay), follow-through.
      const wind = smoothstep(0, 0.2, t) * (1 - smoothstep(0.2, 0.3, t));
      const swing = smoothstep(0.2, 0.34, t) * (1 - smoothstep(0.48, 0.72, t));
      p.upperArmR.rx += (1.1 * wind - 2.1 * swing) * k;
      p.upperArmR.rz -= (0.5 * wind + 0.2 * swing) * k;
      p.lowerArmR.rx -= (1.4 * wind + 0.3 * swing) * k;
      p.chest.ry += (0.35 * wind - 0.45 * swing) * k;
      p.spine.ry += (0.15 * wind - 0.2 * swing) * k;
      p.upperArmL.rx -= 0.5 * wind * k;
      face.brow += 0.2 * k;
      break;
    }
    case 'hit':
      p.chest.rx -= s(Math.min(1, t * 3) * Math.PI) * 0.25 * k;
      p.head.rx -= s(Math.min(1, t * 3) * Math.PI) * 0.35 * k;
      p.upperArmL.rz -= 0.5 * k;
      p.upperArmR.rz += 0.5 * k;
      p.upperArmL.rx -= 0.6 * k;
      p.upperArmR.rx -= 0.6 * k;
      face.mouthOpen += 0.7 * k;
      face.squint += 0.8 * k;
      face.brow += 0.4 * k;
      break;
    default:
      return applyItemAction(id, t, k, p, face) ?? 0;
  }
  return 0;
}
