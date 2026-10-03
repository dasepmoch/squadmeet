import { BONE_INDEX, boneParent, CHAIN_CHILD, type BoneName } from '../rig.ts';
import type { Figure } from './figure.ts';
import type { Prim, Sculpt, V3 } from './sdf.ts';

/** End point of a bone's segment: its chain child joint, or a tip for leaf bones. */
function boneEnd(f: Figure, b: BoneName): V3 | null {
  const child = CHAIN_CHILD[b];
  if (child) return f.joints[child];
  switch (b) {
    case 'head':
      return f.tips.head;
    case 'handL':
      return f.tips.handL;
    case 'handR':
      return f.tips.handR;
    case 'footL':
      return f.tips.toeL;
    case 'footR':
      return f.tips.toeR;
    default:
      return null;
  }
}

/** Bones that share weights across a joint (the spine chain, limbs and their roots). */
function blendParent(b: BoneName): BoneName | null {
  if (
    b === 'head' ||
    b === 'hips' ||
    b.startsWith('eye') ||
    b.startsWith('lid') ||
    b.startsWith('brow') ||
    b === 'jaw'
  ) {
    return b === 'head' ? 'neck' : null;
  }
  return boneParent(b);
}

const JOINT_BLEND = 0.22;

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Skin weights for a sculpted surface. Each vertex belongs to the bone of the primitive that owns
 * it; near a joint (the first/last 22% of the bone's segment) it blends 50/50 into the parent or
 * the chain child, so elbows, knees, hips, shoulders and the neck bend smoothly.
 */
export function computeWeights(
  positions: Float32Array,
  sculpt: Sculpt,
  f: Figure,
  rigidBone?: BoneName,
  /** Rigid parts that hand over to the chest below `top` (fully at `bottom`), e.g. long hair. */
  hang?: { top: number; bottom: number },
): { index: Uint16Array; weight: Float32Array } {
  const count = positions.length / 3;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  const p: V3 = [0, 0, 0];
  const w = new Map<number, number>();
  for (let v = 0; v < count; v++) {
    w.clear();
    if (rigidBone) {
      const k = hang
        ? smooth((hang.top - (positions[v * 3 + 1] as number)) / (hang.top - hang.bottom))
        : 0;
      index[v * 4] = BONE_INDEX[rigidBone];
      weight[v * 4] = 1 - k;
      if (k > 0) {
        index[v * 4 + 1] = BONE_INDEX.chest;
        weight[v * 4 + 1] = k;
      }
      continue;
    }
    p[0] = positions[v * 3] as number;
    p[1] = positions[v * 3 + 1] as number;
    p[2] = positions[v * 3 + 2] as number;
    const owner: Prim | null = sculpt.owner(p);
    const b = (owner?.bone && owner.bone in BONE_INDEX ? owner.bone : 'hips') as BoneName;
    const a = f.joints[b];
    const e = boneEnd(f, b);
    let t = 0.5;
    if (e) {
      const dx = e[0] - a[0];
      const dy = e[1] - a[1];
      const dz = e[2] - a[2];
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 > 1e-8) t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2;
    }
    let own = 1;
    const parent = blendParent(b);
    if (parent && t < JOINT_BLEND) {
      const k = 0.5 * smooth(1 - t / JOINT_BLEND);
      w.set(BONE_INDEX[parent], k);
      own -= k;
    }
    const child = CHAIN_CHILD[b];
    if (child && t > 1 - JOINT_BLEND) {
      const k = 0.5 * smooth((t - (1 - JOINT_BLEND)) / JOINT_BLEND);
      w.set(BONE_INDEX[child], (w.get(BONE_INDEX[child]) ?? 0) + k);
      own -= k;
    }
    w.set(BONE_INDEX[b], (w.get(BONE_INDEX[b]) ?? 0) + own);
    let slot = 0;
    for (const [bi, wi] of w) {
      if (slot >= 4 || wi <= 0) continue;
      index[v * 4 + slot] = bi;
      weight[v * 4 + slot] = wi;
      slot++;
    }
  }
  return { index, weight };
}
