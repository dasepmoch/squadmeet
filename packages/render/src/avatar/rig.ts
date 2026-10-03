import type * as THREE from 'three';

/**
 * Humanoid bone layout shared by the sculpted avatar and (via name mapping) imported glTF
 * humanoids. Face bones drive separate eye / lid / brow / mouth meshes.
 */
export const BONES = [
  { name: 'root', parent: -1 },
  { name: 'hips', parent: 0 },
  { name: 'spine', parent: 1 },
  { name: 'chest', parent: 2 },
  { name: 'neck', parent: 3 },
  { name: 'head', parent: 4 },
  { name: 'jaw', parent: 5 },
  { name: 'eyeL', parent: 5 },
  { name: 'eyeR', parent: 5 },
  { name: 'lidL', parent: 5 },
  { name: 'lidR', parent: 5 },
  { name: 'browL', parent: 5 },
  { name: 'browR', parent: 5 },
  { name: 'shoulderL', parent: 3 },
  { name: 'upperArmL', parent: 13 },
  { name: 'lowerArmL', parent: 14 },
  { name: 'handL', parent: 15 },
  { name: 'shoulderR', parent: 3 },
  { name: 'upperArmR', parent: 17 },
  { name: 'lowerArmR', parent: 18 },
  { name: 'handR', parent: 19 },
  { name: 'thighL', parent: 1 },
  { name: 'shinL', parent: 21 },
  { name: 'footL', parent: 22 },
  { name: 'thighR', parent: 1 },
  { name: 'shinR', parent: 24 },
  { name: 'footR', parent: 25 },
] as const;

export type BoneName = (typeof BONES)[number]['name'];

export const BONE_INDEX: Readonly<Record<BoneName, number>> = Object.fromEntries(
  BONES.map((b, i) => [b.name, i]),
) as Record<BoneName, number>;

/** The child that continues a limb or the spine (used to blend skin weights across joints). */
export const CHAIN_CHILD: Partial<Record<BoneName, BoneName>> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'neck',
  neck: 'head',
  shoulderL: 'upperArmL',
  upperArmL: 'lowerArmL',
  lowerArmL: 'handL',
  shoulderR: 'upperArmR',
  upperArmR: 'lowerArmR',
  lowerArmR: 'handR',
  thighL: 'shinL',
  shinL: 'footL',
  thighR: 'shinR',
  shinR: 'footR',
};

/** Parent used for weight blending (thighs blend into the hips, shoulders into the chest). */
const BONE_LIST: readonly { name: BoneName; parent: number }[] = BONES;

export function boneParent(name: BoneName): BoneName | null {
  const def = BONE_LIST[BONE_INDEX[name]];
  if (!def || def.parent < 0) return null;
  return BONE_LIST[def.parent]?.name ?? null;
}

/**
 * Abstraction over an animatable avatar. The sculpted avatar implements it; a skinned glTF
 * humanoid can implement it too by mapping its bone names onto `BoneName`.
 */
export interface AvatarRig {
  readonly root: THREE.Object3D;
  bone(name: BoneName): THREE.Bone;
  /** Bind-pose local positions, used to add animated offsets without drift. */
  restPosition(name: BoneName): THREE.Vector3;
  /** Hand socket for held items (coffee cup, marker, throwables). */
  socket(side: 'left' | 'right'): THREE.Object3D;
  /** Closed-mouth crease line, hidden while the mouth is open. */
  readonly mouthCrease?: THREE.Object3D | null;
  setVisible(visible: boolean): void;
  setLod(level: 0 | 1): void;
  dispose(): void;
}
