import * as THREE from 'three';

/** Type guard that keeps three.js default generics (avoids `Mesh<any>` from instanceof). */
export function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as Partial<THREE.Mesh>).isMesh === true;
}

/** Materials of a mesh as an array. */
export function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Disposes geometries, materials and material textures under `root` (inclusive). */
export function disposeObject(root: THREE.Object3D, keep: ReadonlySet<object> = new Set()): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line)) return;
    const obj: THREE.Mesh | THREE.Points | THREE.Line = o;
    const geometry: THREE.BufferGeometry = obj.geometry;
    if (!keep.has(geometry)) geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) {
      if (keep.has(m)) continue;
      disposeMaterialTextures(m, keep);
      m.dispose();
    }
  });
}

export function disposeMaterialTextures(material: THREE.Material, keep: ReadonlySet<object>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !keep.has(value)) value.dispose();
  }
}
