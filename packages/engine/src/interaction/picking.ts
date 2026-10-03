import { DEG2RAD, v3, type ScreenDef, type Vec3 } from '@huddle/shared';
import type { CameraPose } from '../camera/camera-rig.ts';

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export function createRay(): Ray {
  return { origin: v3.vec3(), dir: v3.vec3(0, 0, -1) };
}

const f = v3.vec3();
const r = v3.vec3();
const u = v3.vec3();
const UP = v3.vec3(0, 1, 0);
const oc = v3.vec3();

/** Builds a world-space ray through normalized device coordinates for a perspective camera. */
export function rayFromCamera(
  out: Ray,
  pose: CameraPose,
  aspect: number,
  ndcX: number,
  ndcY: number,
): Ray {
  v3.normalize(f, v3.sub(f, pose.target, pose.position));
  v3.normalize(r, v3.cross(r, f, UP));
  v3.cross(u, r, f);
  const tanY = Math.tan((pose.fov * DEG2RAD) / 2);
  const tanX = tanY * aspect;
  v3.copy(out.origin, pose.position);
  out.dir.x = f.x + r.x * ndcX * tanX + u.x * ndcY * tanY;
  out.dir.y = f.y + r.y * ndcX * tanX + u.y * ndcY * tanY;
  out.dir.z = f.z + r.z * ndcX * tanX + u.z * ndcY * tanY;
  v3.normalize(out.dir, out.dir);
  return out;
}

/** Distance along the ray to a sphere, or Infinity. */
export function raySphere(ray: Ray, center: Vec3, radius: number): number {
  v3.sub(oc, ray.origin, center);
  const b = v3.dot(oc, ray.dir);
  const c = v3.dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Number.POSITIVE_INFINITY;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  const t2 = -b + s;
  return t2 >= 0 ? 0 : Number.POSITIVE_INFINITY;
}

export interface ScreenHit {
  distance: number;
  /** Normalized screen coordinates in [0, 1], origin at the bottom-left. */
  u: number;
  v: number;
}

/** Any vertical rectangle on a wall (the big screen, whiteboards). */
export type WallRectLike = Pick<ScreenDef, 'center' | 'width' | 'height' | 'yaw'>;

const personCenter = v3.vec3();

/**
 * Rough person volume above the player transform, which is the feet when standing and the seat
 * surface (pelvis) when seated. Used for picking people and aiming throws at them. `aim` is the
 * chest when standing and the shoulders when seated, so a lob from behind clears the chair back.
 */
export const PERSON_SHAPE = {
  standing: { body: 1.0, bodyRadius: 0.4, head: 1.52, headRadius: 0.26, aim: 1.18 },
  seated: { body: 0.34, bodyRadius: 0.36, head: 0.72, headRadius: 0.24, aim: 0.58 },
} as const;

/** Distance along the ray to a person standing at (or sitting on) `at`, or Infinity. */
export function rayPerson(ray: Ray, at: Vec3, seated: boolean): number {
  const s = seated ? PERSON_SHAPE.seated : PERSON_SHAPE.standing;
  const c = v3.set(personCenter, at.x, at.y + s.body, at.z);
  const body = raySphere(ray, c, s.bodyRadius);
  c.y = at.y + s.head;
  const head = raySphere(ray, c, s.headRadius);
  return Math.min(body, head);
}

/** Ray against the front face of a wall rectangle. */
export function rayScreen(ray: Ray, screen: WallRectLike, out: ScreenHit): boolean {
  const nx = Math.sin(screen.yaw);
  const nz = Math.cos(screen.yaw);
  const denom = ray.dir.x * nx + ray.dir.z * nz;
  if (denom >= -1e-6) return false;
  const [cx, cy, cz] = screen.center;
  const t = ((cx - ray.origin.x) * nx + (cz - ray.origin.z) * nz) / denom;
  if (t < 0) return false;
  const px = ray.origin.x + ray.dir.x * t - cx;
  const py = ray.origin.y + ray.dir.y * t - cy;
  const pz = ray.origin.z + ray.dir.z * t - cz;
  // Screen right axis is +X rotated by yaw.
  const lx = px * Math.cos(screen.yaw) - pz * Math.sin(screen.yaw);
  if (Math.abs(lx) > screen.width / 2 || Math.abs(py) > screen.height / 2) return false;
  out.distance = t;
  out.u = lx / screen.width + 0.5;
  out.v = py / screen.height + 0.5;
  return true;
}
