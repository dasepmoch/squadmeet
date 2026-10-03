import {
  clamp,
  DEG2RAD,
  lerp,
  RAD2DEG,
  smoothstep,
  v3,
  type ScreenDef,
  type Vec3,
  type Vec3Tuple,
} from '@huddle/shared';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** Per-frame camera controls, already mapped from devices (see `Simulation.applyLook`). */
export interface CameraInput {
  /** Look/orbit deltas in radians. */
  lookX: number;
  lookY: number;
  /** Pan drag in viewport heights (x right, y down). */
  panX: number;
  panY: number;
  /** Zoom steps (positive = out). */
  zoom: number;
  /** Fly / pan movement in [-1, 1] (only for views that capture movement). */
  moveX: number;
  moveY: number;
  moveUp: number;
  fast: boolean;
}

export interface CameraContext {
  /** Feet position of the followed avatar (interpolated). */
  pivotFeet: Vec3 | null;
  seatEye: Vec3 | null;
  seatYaw: number;
  screen: ScreenDef;
  overview: { position: Vec3; target: Vec3 } | null;
  /** Room interior: the free camera stays inside it and the overview pans within it. */
  bounds: { min: Vec3Tuple; max: Vec3Tuple } | null;
  pointerX: number;
  pointerY: number;
  aspect: number;
  reducedMotion: boolean;
  raycastStatic(origin: Vec3, dir: Vec3, maxDistance: number): number;
}

export const FOLLOW_FOV = 60;
export const FIRST_PERSON_FOV = 72;
export const PIVOT_HEIGHT = 1.42;
const EYE_HEIGHT = 1.56;
const CINEMA_VFOV = 58;
const FOCUS_FOV = 50;
const FREE_FOV = 64;
const OVERVIEW_FOV = 50;
/** Fraction of the horizontal view the big screen should fill from a seat. */
const CINEMA_COVERAGE = 0.56;
export const SEAT_LOOK_YAW = 110 * DEG2RAD;
const MAX_ORBIT = 10;
/** The free camera stays below ceiling fixtures (and the renderer's ceiling cutaway line). */
const FREE_MAX_Y = 2.7;

export function copyPose(out: CameraPose, p: CameraPose): void {
  v3.copy(out.position, p.position);
  v3.copy(out.target, p.target);
  out.fov = p.fov;
}

/** Horizontal half-FOV tangent for a vertical FOV (degrees) and aspect ratio. */
export function hTan(vfovDeg: number, aspect: number): number {
  return Math.tan((vfovDeg * DEG2RAD) / 2) * aspect;
}

/** View direction for a yaw (0 = +Z) and pitch (positive looks down). */
export function lookDir(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  return v3.set(out, Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp);
}

/** 0 = third person, 1 = first person (the orbit arm has shrunk into the head). */
export function firstPersonBlend(distance: number): number {
  return smoothstep(0.75, 0.2, distance);
}

function clampToBounds(p: Vec3, b: CameraContext['bounds'], margin: number, maxY: number): void {
  if (!b) return;
  p.x = clamp(p.x, b.min[0] + margin, b.max[0] - margin);
  p.y = clamp(p.y, b.min[1] + 0.2, Math.min(maxY, b.max[1] - margin));
  p.z = clamp(p.z, b.min[2] + margin, b.max[2] - margin);
}

/**
 * Third-person spring arm around the avatar. Zooming all the way in slides it into first person
 * at eye height; panning shifts the pivot (reeled back in while the avatar walks away).
 */
export class OrbitView {
  /** Direction the camera looks (0 = +Z). */
  yaw = Math.PI;
  pitch = 0.3;
  distance = 4.4;
  /** Pan offset of the orbit pivot in world meters. */
  readonly offset = v3.vec3();
  private arm = 4.4;
  private initialized = false;
  private readonly pivot = v3.vec3(0, PIVOT_HEIGHT, 0);
  private readonly lastFeet = v3.vec3();
  private readonly zero = v3.vec3();
  private readonly dir = v3.vec3();
  private readonly back = v3.vec3();
  private readonly want = v3.vec3();

  get firstPerson(): number {
    return firstPersonBlend(this.distance);
  }

  input(i: CameraInput, fov: number): void {
    this.yaw -= i.lookX;
    const step = i.zoom * Math.max(0.8, this.distance * 0.35);
    this.distance = clamp(this.distance + step, 0, MAX_ORBIT);
    if (this.distance < 0.12 && step < 0) this.distance = 0;
    const fp = this.firstPerson;
    this.pitch = clamp(this.pitch + i.lookY, lerp(-0.45, -1.25, fp), lerp(1.2, 1.3, fp));
    if (i.panX !== 0 || i.panY !== 0) {
      // Drag moves the world with the cursor: scale by the view height at the pivot.
      const k = Math.max(1, this.arm) * 2 * Math.tan((fov * DEG2RAD) / 2);
      this.offset.x += Math.cos(this.yaw) * i.panX * k;
      this.offset.z -= Math.sin(this.yaw) * i.panX * k;
      this.offset.y = clamp(this.offset.y + i.panY * k, -1.1, 1.6);
      const h = Math.hypot(this.offset.x, this.offset.z);
      if (h > 4) {
        this.offset.x *= 4 / h;
        this.offset.z *= 4 / h;
      }
    }
  }

  recenter(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.3;
    this.distance = 4.4;
    v3.set(this.offset, 0, 0, 0);
  }

  compute(dt: number, ctx: CameraContext, seated: boolean, out: CameraPose): void {
    const fp = this.firstPerson;
    const feet = ctx.pivotFeet;
    if (feet) {
      const baseH = seated ? 1.0 : PIVOT_HEIGHT;
      const eyeH = seated && ctx.seatEye ? ctx.seatEye.y - feet.y : EYE_HEIGHT;
      const moved = this.initialized
        ? Math.hypot(feet.x - this.lastFeet.x, feet.z - this.lastFeet.z)
        : 0;
      v3.copy(this.lastFeet, feet);
      if (moved > 0.0005) v3.dampVec(this.offset, this.zero, 2.5, dt);
      const keep = 1 - fp;
      v3.set(
        this.want,
        feet.x + this.offset.x * keep,
        feet.y + lerp(baseH, eyeH, fp) + this.offset.y * keep,
        feet.z + this.offset.z * keep,
      );
      if (!this.initialized) {
        v3.copy(this.pivot, this.want);
        this.initialized = true;
      } else {
        v3.dampVec(this.pivot, this.want, fp > 0.5 ? 40 : 20, dt);
      }
    }
    const dir = lookDir(this.yaw, this.pitch, this.dir);
    let allowed = this.distance;
    if (this.distance > 0.01) {
      const hit = ctx.raycastStatic(this.pivot, v3.scale(this.back, dir, -1), this.distance + 0.4);
      // Never push through geometry; the renderer hides the avatar when the arm gets very short.
      allowed = clamp(Math.min(this.distance, hit - 0.25), 0, this.distance);
    }
    // Snap in quickly when blocked, ease back out when free (classic spring arm feel).
    this.arm = allowed < this.arm ? allowed : lerp(this.arm, allowed, 1 - Math.exp(-4 * dt));
    v3.addScaled(out.position, this.pivot, dir, -this.arm);
    if (fp < 0.5) out.position.y = Math.max(0.3, out.position.y);
    v3.addScaled(out.target, this.pivot, dir, 2);
    out.fov = lerp(FOLLOW_FOV, FIRST_PERSON_FOV, fp);
  }
}

/**
 * Seated cinema view: from the seat's eye towards the big screen, gliding a little along that
 * line and narrowing the lens so far seats still see a big screen. Look around up to ±110°.
 */
export class SeatedView {
  lookYaw = 0;
  lookPitch = 0;
  /** FOV offset in degrees from the wheel (negative = zoomed in). */
  zoom = 0;
  private readonly parallax = v3.vec3();
  private readonly toScreen = v3.vec3();
  private readonly base = v3.vec3();
  private readonly shift = v3.vec3();

  input(i: CameraInput): void {
    this.lookYaw = clamp(this.lookYaw - i.lookX, -SEAT_LOOK_YAW, SEAT_LOOK_YAW);
    this.lookPitch = clamp(this.lookPitch - i.lookY, -0.8, 0.85);
    this.zoom = clamp(this.zoom + i.zoom * 4, -24, 14);
  }

  reset(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.zoom = 0;
  }

  /** Returns false when there is no seat to look from. */
  compute(dt: number, ctx: CameraContext, out: CameraPose): boolean {
    const eye = ctx.seatEye;
    if (!eye) return false;
    const s = ctx.screen;
    const to = v3.set(this.toScreen, s.center[0] - eye.x, s.center[1] - eye.y, s.center[2] - eye.z);
    const dist = v3.length(to);
    v3.scale(to, to, 1 / Math.max(0.001, dist));
    const ideal = s.width / 2 / (CINEMA_COVERAGE * hTan(CINEMA_VFOV, ctx.aspect));
    const glide = clamp(dist - ideal, -0.6, 0.9);
    const rest = Math.max(0.5, dist - glide);
    const fit = clamp(
      2 * Math.atan(s.width / 2 / (CINEMA_COVERAGE * rest) / ctx.aspect) * RAD2DEG,
      44,
      60,
    );
    const base = v3.addScaled(this.base, eye, to, glide);
    base.y += 0.1;
    const px = ctx.reducedMotion ? 0 : ctx.pointerX;
    const py = ctx.reducedMotion ? 0 : ctx.pointerY;
    v3.set(
      this.shift,
      -Math.cos(ctx.seatYaw) * px * 0.14,
      py * 0.06,
      Math.sin(ctx.seatYaw) * px * 0.14,
    );
    v3.dampVec(this.parallax, this.shift, 6, dt);
    v3.add(out.position, base, this.parallax);
    const yaw = Math.atan2(to.x, to.z) + this.lookYaw;
    const pitch = Math.asin(clamp(to.y, -1, 1)) + this.lookPitch;
    const cp = Math.cos(pitch);
    out.target.x = out.position.x + Math.sin(yaw) * cp * 4;
    out.target.y = out.position.y + Math.sin(pitch) * 4;
    out.target.z = out.position.z + Math.cos(yaw) * cp * 4;
    out.fov = clamp(fit + this.zoom, 28, 76);
    return true;
  }
}

/** Frames the big screen head-on; the wheel moves closer or further. */
export function computeFocus(ctx: CameraContext, zoom: number, out: CameraPose): void {
  const s = ctx.screen;
  const d = (s.width / 2 / (0.9 * hTan(FOCUS_FOV, ctx.aspect))) * zoom;
  out.position.x = s.center[0] + Math.sin(s.yaw) * d;
  out.position.y = s.center[1] - 0.2;
  out.position.z = s.center[2] + Math.cos(s.yaw) * d;
  v3.fromTuple(s.center, out.target);
  out.fov = FOCUS_FOV;
}

/**
 * Bird's-eye "dollhouse" view: orbits a point on the floor (the renderer cuts away the ceiling
 * and the walls the camera is behind). Drag rotates, pan / WASD slide it, the wheel zooms.
 */
export class OverviewView {
  readonly target = v3.vec3();
  yaw = 0;
  pitch = 1;
  distance = 14;
  ready = false;
  private readonly dir = v3.vec3();

  input(i: CameraInput, dt: number): void {
    if (!this.ready) return;
    this.yaw -= i.lookX;
    this.pitch = clamp(this.pitch + i.lookY, 0.25, 1.52);
    this.distance = clamp(this.distance * (1 + i.zoom * 0.18), 3, 28);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    const k = this.distance * 0.95;
    const speed = this.distance * (i.fast ? 1.1 : 0.55) * dt;
    this.target.x += -rx * i.panX * k + fx * i.panY * k + (fx * i.moveY + rx * i.moveX) * speed;
    this.target.z += -rz * i.panX * k + fz * i.panY * k + (fz * i.moveY + rz * i.moveX) * speed;
  }

  compute(ctx: CameraContext, out: CameraPose): void {
    if (!this.ready) this.reset(ctx);
    const b = ctx.bounds;
    if (b) {
      this.target.x = clamp(this.target.x, b.min[0], b.max[0]);
      this.target.z = clamp(this.target.z, b.min[2], b.max[2]);
    }
    const dir = lookDir(this.yaw, this.pitch, this.dir);
    v3.addScaled(out.position, this.target, dir, -this.distance);
    v3.copy(out.target, this.target);
    out.fov = OVERVIEW_FOV;
  }

  /** Starts from the room's authored overview shot (or a centered top-down one). */
  reset(ctx: CameraContext): void {
    const ov = ctx.overview;
    if (ov) {
      v3.copy(this.target, ov.target);
      const dx = ov.target.x - ov.position.x;
      const dy = ov.target.y - ov.position.y;
      const dz = ov.target.z - ov.position.z;
      this.distance = Math.max(3, Math.hypot(dx, dy, dz));
      this.yaw = Math.atan2(dx, dz);
      this.pitch = clamp(Math.asin(clamp(-dy / this.distance, -1, 1)), 0.25, 1.52);
    } else {
      const b = ctx.bounds;
      v3.set(
        this.target,
        b ? (b.min[0] + b.max[0]) / 2 : 0,
        0.6,
        b ? (b.min[2] + b.max[2]) / 2 : 0,
      );
      this.yaw = 0;
      this.pitch = 1.1;
      this.distance = 14;
    }
    this.ready = true;
  }
}

/** Free-fly "drone" camera inside the room: WASD flies, Space/Z rise and sink, drag looks. */
export class FreeView {
  readonly position = v3.vec3(0, 1.6, 0);
  yaw = 0;
  pitch = 0;
  private readonly dir = v3.vec3();

  /**
   * Starts where the current view is, looking the same way. From outside the room (the
   * overview) it drops in at head height a little way towards the view target instead.
   */
  enter(pose: CameraPose, bounds: CameraContext['bounds']): void {
    const dx = pose.target.x - pose.position.x;
    const dy = pose.target.y - pose.position.y;
    const dz = pose.target.z - pose.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.yaw = Math.atan2(dx, dz);
    this.pitch = clamp(Math.asin(clamp(-dy / len, -1, 1)), -1.45, 1.45);
    v3.copy(this.position, pose.position);
    const b = bounds;
    const outside =
      b !== null &&
      (pose.position.y > b.max[1] ||
        pose.position.x < b.min[0] ||
        pose.position.x > b.max[0] ||
        pose.position.z < b.min[2] ||
        pose.position.z > b.max[2]);
    if (outside) {
      v3.set(
        this.position,
        pose.target.x - Math.sin(this.yaw) * 3,
        1.9,
        pose.target.z - Math.cos(this.yaw) * 3,
      );
      this.pitch = 0.3;
    }
    clampToBounds(this.position, b, 0.18, FREE_MAX_Y);
  }

  input(i: CameraInput, dt: number): void {
    this.yaw -= i.lookX;
    this.pitch = clamp(this.pitch + i.lookY, -1.45, 1.45);
    const speed = (i.fast ? 6 : 2.6) * dt;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    const p = this.position;
    const dir = lookDir(this.yaw, this.pitch, this.dir);
    p.x += (fx * i.moveY + rx * i.moveX) * speed - rx * i.panX * 3 - dir.x * i.zoom * 0.8;
    p.y += i.moveUp * speed + i.panY * 3 - dir.y * i.zoom * 0.8;
    p.z += (fz * i.moveY + rz * i.moveX) * speed - rz * i.panX * 3 - dir.z * i.zoom * 0.8;
  }

  compute(ctx: CameraContext, out: CameraPose): void {
    clampToBounds(this.position, ctx.bounds, 0.18, FREE_MAX_Y);
    const dir = lookDir(this.yaw, this.pitch, this.dir);
    v3.copy(out.position, this.position);
    v3.addScaled(out.target, this.position, dir, 3);
    out.fov = FREE_FOV;
  }
}
