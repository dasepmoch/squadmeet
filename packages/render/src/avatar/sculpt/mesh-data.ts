import type { BoneName } from '../rig.ts';
import type { Sculpt, V3 } from './sdf.ts';

/** What the avatar worker hands to the renderer: skinned LOD meshes plus face anchors. */
export type AvatarMaterialKind = 'skin' | 'cloth' | 'hair' | 'shoe';

export interface MeshPartData {
  name: string;
  material: AvatarMaterialKind;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  indices: Uint32Array;
  /** Hair strand direction per vertex (for anisotropic highlights). */
  flow?: Float32Array;
  /** Cloth pattern color (rgb) and pattern id / 8 (a) per vertex. */
  pattern?: Float32Array;
}

/** Bind-space anchor points for the rigid face parts and accessories. */
export interface FaceAnchors {
  eyeL: V3;
  eyeR: V3;
  eyeRadius: number;
  lidOpen: number;
  eyeTilt: number;
  browL: V3;
  browR: V3;
  mouth: V3;
  mouthWidth: number;
  /** Skin depth along the mouth line: z offsets from `mouth` at 9 samples across 1.2x its width. */
  mouthCurve: number[];
  noseBridge: V3;
  earL: V3;
  earR: V3;
  headTop: V3;
  headScale: number;
  chest: V3;
  collarFront: V3;
  neck: V3;
  neckRadius: number;
  wristL: V3;
  topStyle: string;
  /** Front surface of the visible belt (null when none shows) and of the blazer's button. */
  beltFront: V3 | null;
  buttonFront: V3;
}

export interface AvatarMeshData {
  key: string;
  joints: Float32Array;
  lods: MeshPartData[][];
  anchors: FaceAnchors;
  ms: number;
}

/** Linear RGB, 0..1. */
export type Rgb = [number, number, number];

/** One sculpted surface to mesh, paint and skin. */
export interface PartSpec {
  name: string;
  material: AvatarMaterialKind;
  sculpt: Sculpt;
  cell: number;
  paint: (p: V3, tag: number) => Rgb;
  rigid?: BoneName;
  /** Rigid part that hands over to the chest below `top` (long hair). */
  hang?: { top: number; bottom: number };
  flow?: { crown: V3; hanging: boolean };
  pattern?: { color: Rgb; id: number };
  /** Field Lipschitz bound for narrow-band culling (displaced fields need more). */
  lipschitz?: number;
  /** Solids that fully hide parts of this surface (scalp under hair, shirt under a blazer). */
  hiddenBy?: { sculpt: Sculpt; inset: number }[];
}

/** Every typed array in the data, for zero-copy transfer out of a worker. */
export function meshDataTransferables(data: AvatarMeshData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [data.joints.buffer as ArrayBuffer];
  for (const lod of data.lods) {
    for (const m of lod) {
      out.push(
        m.positions.buffer as ArrayBuffer,
        m.normals.buffer as ArrayBuffer,
        m.colors.buffer as ArrayBuffer,
      );
      out.push(
        m.skinIndex.buffer as ArrayBuffer,
        m.skinWeight.buffer as ArrayBuffer,
        m.indices.buffer as ArrayBuffer,
      );
      if (m.flow) out.push(m.flow.buffer as ArrayBuffer);
      if (m.pattern) out.push(m.pattern.buffer as ArrayBuffer);
    }
  }
  return out;
}
