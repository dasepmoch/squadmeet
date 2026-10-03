/** Mutable 3D vector used in hot paths. Functions write into `out` to avoid allocations. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Immutable tuple form used in JSON data and on the wire. */
export type Vec3Tuple = readonly [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function fromTuple(t: Vec3Tuple, out: Vec3 = vec3()): Vec3 {
  out.x = t[0];
  out.y = t[1];
  out.z = t[2];
  return out;
}

export function toTuple(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function lengthXZ(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return set(out, 0, 0, 0);
  return scale(out, a, 1 / len);
}

export function lerpVec(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function dampVec(out: Vec3, target: Vec3, lambda: number, dt: number): Vec3 {
  return lerpVec(out, out, target, 1 - Math.exp(-lambda * dt));
}

/** Rotates `a` around +Y by `yaw` radians (right-handed, matching three.js `rotation.y`). */
export function rotateY(out: Vec3, a: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = a.x * c + a.z * s;
  const z = -a.x * s + a.z * c;
  out.x = x;
  out.y = a.y;
  out.z = z;
  return out;
}

/**
 * Forward direction for a yaw angle. Convention across the project:
 * an entity with yaw 0 faces +Z, and yaw rotates counter-clockwise seen from above.
 */
export function forwardFromYaw(out: Vec3, yaw: number): Vec3 {
  out.x = Math.sin(yaw);
  out.y = 0;
  out.z = Math.cos(yaw);
  return out;
}

/** Inverse of `forwardFromYaw` for a direction on the XZ plane. */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function isFiniteVec(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}
