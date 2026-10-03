import type { AvatarSpec } from '@huddle/shared';
import * as THREE from 'three';
import { isMesh } from '../core/dispose.ts';
import { buildAccessoryParts } from './accessory-parts.ts';
import type { AvatarMaterials } from './avatar-materials.ts';
import { buildFaceParts, type RigidPart } from './face-parts.ts';
import { BONES, BONE_INDEX, type AvatarRig, type BoneName } from './rig.ts';
import type {
  AvatarMaterialKind,
  AvatarMeshData,
  FaceAnchors,
  MeshPartData,
} from './sculpt/character.ts';

const MATERIAL_ORDER: readonly AvatarMaterialKind[] = ['skin', 'cloth', 'hair', 'shoe'];

/**
 * Draws nothing on screen, but the shadow pass still renders the mesh with it. Lets the light
 * LOD cast every avatar's shadow (a sixth of the skinned triangles) while the detailed LOD is
 * the one on screen. Shared by all avatars, never disposed.
 */
const SHADOW_PROXY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
SHADOW_PROXY.name = 'avatar-shadow-proxy';

/** Merges mesh parts into one skinned geometry with one group per material (few draw calls). */
function mergeParts(parts: readonly MeshPartData[]): THREE.BufferGeometry {
  const sorted = [...parts].sort(
    (a, b) => MATERIAL_ORDER.indexOf(a.material) - MATERIAL_ORDER.indexOf(b.material),
  );
  let vcount = 0;
  let icount = 0;
  for (const p of sorted) {
    vcount += p.positions.length / 3;
    icount += p.indices.length;
  }
  const position = new Float32Array(vcount * 3);
  const normal = new Float32Array(vcount * 3);
  const color = new Float32Array(vcount * 3);
  const skinIndex = new Uint16Array(vcount * 4);
  const skinWeight = new Float32Array(vcount * 4);
  const tangent = new Float32Array(vcount * 4);
  const pattern = new Float32Array(vcount * 4);
  const index = new Uint32Array(icount);
  const g = new THREE.BufferGeometry();
  let vo = 0;
  let io = 0;
  let groupStart = 0;
  let groupMat = -1;
  for (const p of sorted) {
    const n = p.positions.length / 3;
    position.set(p.positions, vo * 3);
    normal.set(p.normals, vo * 3);
    color.set(p.colors, vo * 3);
    skinIndex.set(p.skinIndex, vo * 4);
    skinWeight.set(p.skinWeight, vo * 4);
    if (p.pattern) pattern.set(p.pattern, vo * 4);
    for (let v = 0; v < n; v++) {
      // Hair anisotropy runs across the strands: tangent = normal x flow.
      if (p.flow) {
        const nx = p.normals[v * 3] as number;
        const ny = p.normals[v * 3 + 1] as number;
        const nz = p.normals[v * 3 + 2] as number;
        const fx = p.flow[v * 3] as number;
        const fy = p.flow[v * 3 + 1] as number;
        const fz = p.flow[v * 3 + 2] as number;
        const tx = ny * fz - nz * fy;
        const ty = nz * fx - nx * fz;
        const tz = nx * fy - ny * fx;
        const l = Math.hypot(tx, ty, tz) || 1;
        tangent.set([tx / l, ty / l, tz / l, 1], (vo + v) * 4);
      } else {
        tangent.set([1, 0, 0, 1], (vo + v) * 4);
      }
    }
    for (let i = 0; i < p.indices.length; i++) index[io + i] = (p.indices[i] as number) + vo;
    const mat = MATERIAL_ORDER.indexOf(p.material);
    if (mat !== groupMat) {
      if (groupMat >= 0) g.addGroup(groupStart, io - groupStart, groupMat);
      groupStart = io;
      groupMat = mat;
    }
    vo += n;
    io += p.indices.length;
  }
  if (groupMat >= 0) g.addGroup(groupStart, io - groupStart, groupMat);
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  g.setAttribute('aPattern', new THREE.BufferAttribute(pattern, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

/**
 * Sculpted avatar: skinned body/clothes/hair/shoes (two LODs sharing one skeleton) plus rigid
 * face parts and accessories parented to bones.
 */
export class ProceduralAvatar implements AvatarRig {
  readonly root = new THREE.Group();
  readonly anchors: FaceAnchors;
  /** Encoded spec this avatar was built from. */
  readonly key: string;
  readonly mouthCrease: THREE.Object3D | null;
  private readonly bones: THREE.Bone[];
  private readonly rest: THREE.Vector3[];
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private readonly details: THREE.Object3D[] = [];
  private readonly rigid: THREE.Object3D[] = [];
  private readonly skeleton: THREE.Skeleton;
  private readonly sockets: { left: THREE.Object3D; right: THREE.Object3D };
  private readonly joints: Float32Array;
  private readonly bodyMaterials: THREE.Material[];
  private readonly proxyMaterials: THREE.Material[];
  private lod: 0 | 1 = 0;

  constructor(data: AvatarMeshData, spec: AvatarSpec, materials: AvatarMaterials) {
    this.anchors = data.anchors;
    this.key = data.key;
    this.joints = data.joints;
    const j = (i: number): THREE.Vector3 =>
      new THREE.Vector3(data.joints[i * 3], data.joints[i * 3 + 1], data.joints[i * 3 + 2]);
    this.bones = BONES.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      return bone;
    });
    this.rest = BONES.map((b, i) => (b.parent >= 0 ? j(i).sub(j(b.parent)) : j(i)));
    BONES.forEach((b, i) => {
      const bone = this.bones[i] as THREE.Bone;
      bone.position.copy(this.rest[i] as THREE.Vector3);
      if (b.parent >= 0) (this.bones[b.parent] as THREE.Bone).add(bone);
    });
    this.root.add(this.bones[0] as THREE.Bone);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    data.lods.forEach((parts, level) => {
      const geometry = mergeParts(parts);
      const mesh = new THREE.SkinnedMesh(geometry, materials.list);
      mesh.name = `avatar-lod${level}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.bind(this.skeleton);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.25);
      mesh.visible = level === 0;
      this.root.add(mesh);
      this.meshes.push(mesh);
    });
    this.bodyMaterials = materials.list;
    this.proxyMaterials = materials.list.map(() => SHADOW_PROXY);
    this.applyLod();
    const joint = (b: BoneName): readonly number[] => {
      const i = BONE_INDEX[b];
      return [data.joints[i * 3] ?? 0, data.joints[i * 3 + 1] ?? 0, data.joints[i * 3 + 2] ?? 0];
    };
    const face = buildFaceParts(data, spec, materials, joint);
    const parts: RigidPart[] = [...face, ...buildAccessoryParts(data, spec, materials, joint)];
    for (const part of parts) {
      // Tiny face parts (lids, brows, teeth) would only add shadow-pass draw calls.
      const casts = !face.includes(part);
      part.object.traverse((o) => {
        o.castShadow = casts && o instanceof THREE.Mesh;
        o.receiveShadow = true;
      });
      this.bone(part.bone).add(part.object);
      this.rigid.push(part.object);
      if (part.detail) this.details.push(part.object);
    }
    this.mouthCrease = parts.find((p) => p.object.name === 'mouth-crease')?.object ?? null;
    const left = new THREE.Object3D();
    const right = new THREE.Object3D();
    left.position.set(-0.012, -0.075, 0.022);
    right.position.set(0.012, -0.075, 0.022);
    this.bone('handL').add(left);
    this.bone('handR').add(right);
    this.sockets = { left, right };
  }

  bone(name: BoneName): THREE.Bone {
    return this.bones[BONE_INDEX[name]] as THREE.Bone;
  }

  restPosition(name: BoneName): THREE.Vector3 {
    return this.rest[BONE_INDEX[name]] as THREE.Vector3;
  }

  /** Bind-pose world position of a joint. */
  bindJoint(name: BoneName, out = new THREE.Vector3()): THREE.Vector3 {
    const i = BONE_INDEX[name];
    return out.set(
      this.joints[i * 3] ?? 0,
      this.joints[i * 3 + 1] ?? 0,
      this.joints[i * 3 + 2] ?? 0,
    );
  }

  socket(side: 'left' | 'right'): THREE.Object3D {
    return this.sockets[side];
  }

  /** World-space point just above the head for name tags and speaking rings. */
  headAnchor(out: THREE.Vector3): THREE.Vector3 {
    this.bone('head').getWorldPosition(out);
    out.y += 0.4;
    return out;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  setLod(level: 0 | 1): void {
    if (level === this.lod) return;
    this.lod = level;
    this.applyLod();
    for (const d of this.details) d.visible = level === 0;
  }

  /** LOD0 on screen: LOD1 still renders (as an invisible shadow caster). LOD1: drawn normally. */
  private applyLod(): void {
    const [lod0, lod1] = this.meshes;
    if (!lod0) return;
    if (!lod1) {
      lod0.visible = true;
      return;
    }
    lod0.visible = this.lod === 0;
    lod0.castShadow = false;
    lod1.visible = true;
    lod1.castShadow = true;
    lod1.receiveShadow = this.lod === 1;
    lod1.material = this.lod === 1 ? this.bodyMaterials : this.proxyMaterials;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const o of this.rigid) {
      o.traverse((c) => {
        if (isMesh(c)) c.geometry.dispose();
      });
    }
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
