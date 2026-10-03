import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { MaterialKey } from '../materials/material-keys.ts';

/** One piece of a procedural prop: base geometry + material + linear color + local transform. */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: MaterialKey;
  color: THREE.Color;
  matrix: THREE.Matrix4;
  castShadow: boolean;
}

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Geometry cache: many props reuse identical primitives (legs, knobs, cushions). */
class GeometryCache {
  private readonly map = new Map<string, THREE.BufferGeometry>();

  get(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.map.get(key);
    if (!g) {
      g = create();
      this.map.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.map.values()) g.dispose();
    this.map.clear();
  }
}

export const geometryCache = new GeometryCache();

const r3 = (n: number): string => n.toFixed(3);

/**
 * Fluent builder for prop parts. Dimensions in meters; rotations are Euler XYZ radians.
 * Every hard edge gets a bevel so highlights catch the edges.
 */
export class PartList {
  readonly parts: Part[] = [];
  castShadow = true;
  /**
   * Euler order for `rotation` tuples. `YXZ` reads as "tilt (x), then yaw (y)", handy for splayed
   * legs, star bases and leaves; the default `XYZ` suits axis-aligned parts.
   */
  eulerOrder: THREE.EulerOrder = 'XYZ';

  add(
    geometry: THREE.BufferGeometry,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
    scale: readonly [number, number, number] = [1, 1, 1],
  ): this {
    tmpEuler.set(rotation[0], rotation[1], rotation[2], this.eulerOrder);
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(position[0], position[1], position[2]);
    tmpScale.set(scale[0], scale[1], scale[2]);
    this.parts.push({
      geometry,
      material,
      color,
      matrix: new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale),
      castShadow: this.castShadow,
    });
    return this;
  }

  /** Rounded box centered at `position`. Bevel radius defaults to 25 mm. */
  box(
    size: readonly [number, number, number],
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    radius = 0.025,
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): this {
    const r = Math.min(radius, Math.min(size[0], size[1], size[2]) / 2 - 0.001);
    const seg = r > 0.06 ? 4 : r > 0.012 ? 3 : 1;
    const g = geometryCache.get(
      `rb:${r3(size[0])}:${r3(size[1])}:${r3(size[2])}:${r3(r)}:${seg}`,
      () =>
        r <= 0.002
          ? new THREE.BoxGeometry(size[0], size[1], size[2])
          : new RoundedBoxGeometry(size[0], size[1], size[2], seg, r),
    );
    return this.add(g, material, color, position, rotation);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
    segments = 24,
  ): this {
    const g = geometryCache.get(
      `cy:${r3(radiusTop)}:${r3(radiusBottom)}:${r3(height)}:${segments}`,
      () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1),
    );
    return this.add(g, material, color, position, rotation);
  }

  sphere(
    radius: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    scale: readonly [number, number, number] = [1, 1, 1],
    segments = 20,
  ): this {
    const g = geometryCache.get(
      `sp:${r3(radius)}:${segments}`,
      () => new THREE.SphereGeometry(radius, segments, Math.max(8, Math.round(segments * 0.66))),
    );
    return this.add(g, material, color, position, [0, 0, 0], scale);
  }

  capsule(
    radius: number,
    length: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): this {
    const g = geometryCache.get(
      `ca:${r3(radius)}:${r3(length)}`,
      () => new THREE.CapsuleGeometry(radius, length, 5, 14),
    );
    return this.add(g, material, color, position, rotation);
  }

  torus(
    radius: number,
    tube: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
    arc = Math.PI * 2,
  ): this {
    const g = geometryCache.get(
      `to:${r3(radius)}:${r3(tube)}:${r3(arc)}`,
      () => new THREE.TorusGeometry(radius, tube, 10, 32, arc),
    );
    return this.add(g, material, color, position, rotation);
  }

  /** Solid of revolution from a (radius, height) profile. */
  lathe(
    key: string,
    profile: readonly [number, number][],
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    scale: readonly [number, number, number] = [1, 1, 1],
    segments = 28,
  ): this {
    const g = geometryCache.get(
      `la:${key}:${segments}`,
      () =>
        new THREE.LatheGeometry(
          profile.map(([r, h]) => new THREE.Vector2(r, h)),
          segments,
        ),
    );
    return this.add(g, material, color, position, [0, 0, 0], scale);
  }

  /**
   * Thin open shell (lamp shades, domes, baskets) visible from both sides with single-sided
   * materials: the outer surface uses the profile as given (bottom to top, outward-facing) and the
   * inner surface is the reversed profile pulled in by `thickness`.
   */
  latheShell(
    key: string,
    outer: readonly [number, number][],
    thickness: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    innerColor: THREE.Color = color,
    segments = 32,
  ): this {
    const inner = [...outer]
      .reverse()
      .map(([r, h]): [number, number] => [Math.max(0.001, r - thickness), h]);
    this.lathe(`${key}:outer`, outer, material, color, position, [1, 1, 1], segments);
    return this.lathe(`${key}:inner`, inner, material, innerColor, position, [1, 1, 1], segments);
  }

  /** Flat plane (XY, facing +Z). */
  plane(
    width: number,
    height: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): this {
    const g = geometryCache.get(
      `pl:${r3(width)}:${r3(height)}`,
      () => new THREE.PlaneGeometry(width, height),
    );
    return this.add(g, material, color, position, rotation);
  }

  /**
   * Rounded-rectangle slab (table tops, cushions, panels): footprint `width` x `depth` with corner
   * radius, `thickness` along Y, and a small edge bevel. Centered on `position`.
   */
  slab(
    width: number,
    depth: number,
    thickness: number,
    corner: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number],
    bevel = 0.006,
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): this {
    const key = `sl:${r3(width)}:${r3(depth)}:${r3(thickness)}:${r3(corner)}:${r3(bevel)}`;
    const g = geometryCache.get(key, () => {
      const w = width / 2 - bevel;
      const d = depth / 2 - bevel;
      const c = Math.max(0.001, Math.min(corner, w, d));
      const s = new THREE.Shape();
      s.moveTo(-w + c, -d);
      s.lineTo(w - c, -d);
      s.quadraticCurveTo(w, -d, w, -d + c);
      s.lineTo(w, d - c);
      s.quadraticCurveTo(w, d, w - c, d);
      s.lineTo(-w + c, d);
      s.quadraticCurveTo(-w, d, -w, d - c);
      s.lineTo(-w, -d + c);
      s.quadraticCurveTo(-w, -d, -w + c, -d);
      const depthZ = Math.max(0.001, thickness - bevel * 2);
      const geo = new THREE.ExtrudeGeometry(s, {
        depth: depthZ,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: Math.max(6, Math.round(c * 60)),
      });
      // Extrusion runs along +Z; lay it flat so thickness is along Y and center it.
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -depthZ / 2, 0);
      return geo;
    });
    return this.add(g, material, color, position, rotation);
  }

  /** Tube along a smooth curve through `points` (chair frames, cables, lamp arms). */
  tube(
    key: string,
    points: readonly [number, number, number][],
    radius: number,
    material: MaterialKey,
    color: THREE.Color,
    position: readonly [number, number, number] = [0, 0, 0],
    closed = false,
    segments = 48,
  ): this {
    const g = geometryCache.get(`tu:${key}:${r3(radius)}:${segments}`, () => {
      const curve = new THREE.CatmullRomCurve3(
        points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
        closed,
        'centripetal',
      );
      return new THREE.TubeGeometry(curve, segments, radius, 10, closed);
    });
    return this.add(g, material, color, position);
  }

  addMatrix(
    geometry: THREE.BufferGeometry,
    material: MaterialKey,
    color: THREE.Color,
    matrix: THREE.Matrix4,
  ): this {
    this.parts.push({ geometry, material, color, matrix, castShadow: this.castShadow });
    return this;
  }

  append(other: PartList, matrix: THREE.Matrix4): this {
    for (const p of other.parts) {
      this.parts.push({ ...p, matrix: matrix.clone().multiply(p.matrix) });
    }
    return this;
  }
}
