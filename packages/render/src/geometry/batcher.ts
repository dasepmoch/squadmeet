import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../materials/library.ts';
import { METRIC_UV, NON_CASTING, UNLIT, type MaterialKey } from '../materials/material-keys.ts';
import type { Part } from './parts.ts';

interface Bucket {
  material: MaterialKey;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

const KEEP = new Set(['position', 'normal', 'uv', 'color']);
const tmpScale = new THREE.Vector3();
const tmpSize = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

function hash01(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Real-world-scale UVs (meters) from a dominant-axis projection in part space. U follows the
 * longer extent of each face, so wood grain runs along boards, slats and legs, and fabric weave
 * keeps the same density on every cushion. A random per-part offset breaks up repetition.
 */
function metricUv(g: THREE.BufferGeometry, part: Part, world: THREE.Matrix4): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  tmpScale.setFromMatrixScale(part.matrix);
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (!box) return;
  box.getSize(tmpSize).multiply(tmpScale);
  tmpPos.set(0, 0, 0).applyMatrix4(part.matrix).applyMatrix4(world);
  const ou = hash01(tmpPos.x, tmpPos.y, tmpPos.z) * 7.3;
  const ov = hash01(tmpPos.z, tmpPos.x, tmpPos.y) * 5.1;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) * tmpScale.x;
    const py = pos.getY(i) * tmpScale.y;
    const pz = pos.getZ(i) * tmpScale.z;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      [u, v] = tmpSize.x >= tmpSize.z ? [px, pz] : [pz, px];
    } else if (nx >= nz) {
      [u, v] = tmpSize.z >= tmpSize.y ? [pz, py] : [py, pz];
    } else {
      [u, v] = tmpSize.x >= tmpSize.y ? [px, py] : [py, px];
    }
    uv[i * 2] = u + ou;
    uv[i * 2 + 1] = v + ov;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

/** Clones a part into world space with a vertex color attribute and a normalized attribute set. */
function bake(part: Part, world: THREE.Matrix4): THREE.BufferGeometry {
  const g = part.geometry.index ? part.geometry.clone() : withIndex(part.geometry.clone());
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (METRIC_UV.has(part.material)) metricUv(g, part, world);
  if (!g.getAttribute('uv')) {
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2),
    );
  }
  const m = new THREE.Matrix4().multiplyMatrices(world, part.matrix);
  g.applyMatrix4(m);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const own = g.getAttribute('color');
  for (let i = 0; i < count; i++) {
    // Geometries with baked colors (gradients) are tinted by the part color. Non-finite values
    // are zeroed: one NaN vertex would poison bloom and the captured light probe.
    const r = own ? own.getX(i) : 1;
    const gg = own ? own.getY(i) : 1;
    const b = own ? own.getZ(i) : 1;
    colors[i * 3] = Number.isFinite(r) ? r * part.color.r : 0;
    colors[i * 3 + 1] = Number.isFinite(gg) ? gg * part.color.g : 0;
    colors[i * 3 + 2] = Number.isFinite(b) ? b * part.color.b : 0;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = g.getAttribute('position').count;
  const index = new Array<number>(count);
  for (let i = 0; i < count; i++) index[i] = i;
  g.setIndex(index);
  return g;
}

/**
 * Merges static parts into one mesh per (material, casts-shadow) bucket. Vertex colors carry the
 * per-part tint, so the whole room renders in a few dozen draw calls.
 */
export class StaticBatcher {
  private readonly buckets = new Map<string, Bucket>();
  private triangles = 0;

  addParts(parts: readonly Part[], world: THREE.Matrix4): void {
    for (const part of parts) {
      const cast = part.castShadow && !NON_CASTING.has(part.material);
      const key = `${part.material}:${cast ? 1 : 0}`;
      let b = this.buckets.get(key);
      if (!b) {
        b = { material: part.material, castShadow: cast, geometries: [] };
        this.buckets.set(key, b);
      }
      const g = bake(part, world);
      this.triangles += (g.index?.count ?? 0) / 3;
      b.geometries.push(g);
    }
  }

  get triangleCount(): number {
    return this.triangles;
  }

  get empty(): boolean {
    return this.buckets.size === 0;
  }

  build(
    library: MaterialLibrary,
    name = 'static-batches',
  ): { group: THREE.Group; meshes: Map<MaterialKey, THREE.Mesh[]> } {
    const group = new THREE.Group();
    group.name = name;
    const meshes = new Map<MaterialKey, THREE.Mesh[]>();
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geometries, false);
      for (const g of b.geometries) g.dispose();
      if (!merged) throw new Error(`Failed to merge batch ${b.material}`);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, library.get(b.material));
      mesh.name = `batch:${b.material}`;
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = !UNLIT.has(b.material);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (b.material === 'leaf') mesh.customDepthMaterial = library.leafDepthMaterial();
      if (
        b.material === 'glass' ||
        b.material === 'frosted' ||
        b.material === 'glow' ||
        b.material === 'additive'
      )
        mesh.renderOrder = 2;
      group.add(mesh);
      const list = meshes.get(b.material) ?? [];
      list.push(mesh);
      meshes.set(b.material, list);
    }
    this.buckets.clear();
    return { group, meshes };
  }
}
