import { clamp, easeInOutCubic, lerp, v3, type Vec3 } from '@huddle/shared';
import {
  computeFocus,
  copyPose,
  FOLLOW_FOV,
  FreeView,
  OrbitView,
  OverviewView,
  SeatedView,
  type CameraContext,
  type CameraInput,
  type CameraPose,
} from './camera-views.ts';

export type { CameraContext, CameraInput, CameraPose } from './camera-views.ts';

/**
 * - follow: third-person orbit around the avatar (zoom all the way in for first person)
 * - seated: cinema view from the seat towards the big screen
 * - seatedFree: orbit around the seated avatar
 * - focus: the big screen framed head-on
 * - overview: bird's-eye dollhouse view of the whole room
 * - free: free-fly camera inside the room
 * - fixed: explicit pose (photos, tests)
 */
export type CameraMode =
  'follow' | 'seated' | 'seatedFree' | 'focus' | 'overview' | 'free' | 'fixed';

const STANDING_CYCLE: readonly CameraMode[] = ['follow', 'overview', 'free'];
const SEATED_CYCLE: readonly CameraMode[] = ['seated', 'seatedFree', 'overview', 'free'];

function clonePose(p: CameraPose): CameraPose {
  return { position: { ...p.position }, target: { ...p.target }, fov: p.fov };
}

/**
 * All camera views with eased blends between them. Pure math over the physics raycast, so it is
 * testable headlessly. Input arrives once per rendered frame through `applyInput`.
 */
export class CameraRig {
  mode: CameraMode = 'follow';
  readonly pose: CameraPose = {
    position: v3.vec3(0, 2, 5),
    target: v3.vec3(0, 1.4, 0),
    fov: FOLLOW_FOV,
  };
  readonly orbit = new OrbitView();
  private readonly seated = new SeatedView();
  private readonly overview = new OverviewView();
  private readonly free = new FreeView();
  private focusZoom = 1;
  private readonly fixed: CameraPose = { position: v3.vec3(), target: v3.vec3(), fov: 40 };
  private readonly live: CameraPose = clonePose(this.pose);
  private readonly from: CameraPose = clonePose(this.pose);
  private blend = 1;
  private blendDuration = 0.9;
  /** Set while a glide swings around a point (see `glideTo`). */
  private pivot: Vec3 | null = null;
  private readonly pivotAt: Vec3 = v3.vec3();
  private bounds: CameraContext['bounds'] = null;
  private readonly scratch: CameraInput = {
    lookX: 0,
    lookY: 0,
    panX: 0,
    panY: 0,
    zoom: 0,
    moveX: 0,
    moveY: 0,
    moveUp: 0,
    fast: false,
  };

  /** Orbit yaw: the direction the follow camera looks (0 = +Z). */
  get yaw(): number {
    return this.orbit.yaw;
  }

  set yaw(v: number) {
    this.orbit.yaw = v;
  }

  get pitch(): number {
    return this.orbit.pitch;
  }

  set pitch(v: number) {
    this.orbit.pitch = v;
  }

  /** Orbit distance; below ~0.5 m the follow view becomes first person. */
  get distance(): number {
    return this.orbit.distance;
  }

  set distance(v: number) {
    this.orbit.distance = clamp(v, 0, 10);
  }

  /** Horizontal forward used as the movement basis (yaw convention: 0 faces +Z). */
  get movementYaw(): number {
    return this.orbit.yaw;
  }

  /** Views that use WASD themselves (the avatar stands still meanwhile). */
  get capturesMovement(): boolean {
    return this.mode === 'free' || this.mode === 'overview';
  }

  /** True while the orbit has zoomed into the avatar's head. */
  get firstPerson(): boolean {
    return (this.mode === 'follow' || this.mode === 'seatedFree') && this.orbit.firstPerson > 0.5;
  }

  setMode(mode: CameraMode, instant = false, duration = 0.9): void {
    if (mode === this.mode && !instant) return;
    copyPose(this.from, this.pose);
    if (mode === 'free' && this.mode !== 'free') this.free.enter(this.pose, this.bounds);
    if (mode === 'seated') this.seated.reset();
    this.mode = mode;
    this.blend = instant ? 1 : 0;
    this.blendDuration = duration;
    this.pivot = null;
  }

  /**
   * Glides from wherever the camera is now into `mode`, even when it already is that mode (say a
   * teleport just cut to it): the lobby's camera moves. With a `pivot` (a point on the floor) the
   * camera swings around it on an arc instead of cutting straight through, e.g. from in front of
   * your avatar to behind it.
   */
  glideTo(mode: CameraMode, duration: number, pivot: Vec3 | null = null): void {
    this.setMode(mode, true);
    this.blend = 0;
    this.blendDuration = duration;
    if (pivot) this.pivot = v3.copy(this.pivotAt, pivot);
  }

  /** Steps to the next view: follow -> overview -> free (seated adds cinema and orbit views). */
  cycle(seated: boolean): CameraMode {
    const order = seated ? SEATED_CYCLE : STANDING_CYCLE;
    const i = order.indexOf(this.mode);
    const next = order[(i + 1) % order.length] ?? 'follow';
    this.setMode(next, false, 0.7);
    return next;
  }

  /** Default framing of the current view; the free and fixed cameras return to the avatar. */
  recenter(avatarYaw: number, seated: boolean): void {
    switch (this.mode) {
      case 'seated':
        this.seated.reset();
        break;
      case 'overview':
        this.overview.ready = false;
        break;
      case 'focus':
        this.focusZoom = 1;
        break;
      case 'free':
      case 'fixed':
        this.setMode(seated ? 'seated' : 'follow', false, 0.7);
        this.orbit.recenter(avatarYaw);
        break;
      default:
        this.orbit.recenter(avatarYaw);
    }
  }

  recenterSeatLook(): void {
    this.seated.reset();
  }

  /** Locks the camera to an explicit pose (photo mode, whiteboard, tests, cinematic shots). */
  setFixed(position: Vec3, target: Vec3, fov: number, instant = true): void {
    v3.copy(this.fixed.position, position);
    v3.copy(this.fixed.target, target);
    this.fixed.fov = fov;
    this.setMode('fixed', instant, 0.8);
  }

  /** Look, pan, zoom and (for free/overview) movement for this frame. */
  applyInput(i: CameraInput, dt: number): void {
    switch (this.mode) {
      case 'seated':
        this.seated.input(i);
        break;
      case 'focus':
        this.focusZoom = clamp(this.focusZoom * (1 + i.zoom * 0.25), 0.55, 1.8);
        break;
      case 'overview':
        this.overview.input(i, dt);
        break;
      case 'free':
        this.free.input(i, dt);
        break;
      case 'fixed':
        break;
      default:
        this.orbit.input(i, this.pose.fov);
    }
  }

  /** Look and zoom only (simple hosts and tests). */
  applyLook(lookX: number, lookY: number, zoom: number): void {
    const s = this.scratch;
    s.lookX = lookX;
    s.lookY = lookY;
    s.zoom = zoom;
    this.applyInput(s, 0);
    s.lookX = 0;
    s.lookY = 0;
    s.zoom = 0;
  }

  update(dt: number, ctx: CameraContext): void {
    this.bounds = ctx.bounds;
    switch (this.mode) {
      case 'follow':
        this.orbit.compute(dt, ctx, false, this.live);
        break;
      case 'seatedFree':
        this.orbit.compute(dt, ctx, true, this.live);
        break;
      case 'seated':
        if (this.seated.compute(dt, ctx, this.live)) {
          // Keep the follow yaw aligned so standing up continues naturally.
          this.orbit.yaw = ctx.seatYaw;
        } else {
          this.orbit.compute(dt, ctx, false, this.live);
        }
        break;
      case 'focus':
        computeFocus(ctx, this.focusZoom, this.live);
        break;
      case 'overview':
        this.overview.compute(ctx, this.live);
        break;
      case 'free':
        this.free.compute(ctx, this.live);
        break;
      case 'fixed':
        copyPose(this.live, this.fixed);
        break;
    }
    if (this.blend < 1) {
      this.blend = ctx.reducedMotion ? 1 : Math.min(1, this.blend + dt / this.blendDuration);
      const t = easeInOutCubic(this.blend);
      if (this.pivot)
        arcAround(this.pose.position, this.pivot, this.from.position, this.live.position, t);
      else v3.lerpVec(this.pose.position, this.from.position, this.live.position, t);
      v3.lerpVec(this.pose.target, this.from.target, this.live.target, t);
      this.pose.fov = lerp(this.from.fov, this.live.fov, t);
      if (this.blend >= 1) this.pivot = null;
    } else {
      copyPose(this.pose, this.live);
    }
  }
}

/**
 * A point between `a` and `b` (at `t`) on an arc around a vertical axis through `pivot`: the
 * angle, distance and height are blended separately (the short way round; a half turn goes
 * counter-clockwise seen from above).
 */
export function arcAround(out: Vec3, pivot: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  const ax = a.x - pivot.x;
  const az = a.z - pivot.z;
  const bx = b.x - pivot.x;
  const bz = b.z - pivot.z;
  const ra = Math.hypot(ax, az);
  const rb = Math.hypot(bx, bz);
  if (ra < 1e-3 || rb < 1e-3) return v3.lerpVec(out, a, b, t);
  const from = Math.atan2(az, ax);
  let turn = Math.atan2(bz, bx) - from;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn <= -Math.PI) turn += Math.PI * 2;
  const angle = from + turn * t;
  const r = lerp(ra, rb, t);
  out.x = pivot.x + Math.cos(angle) * r;
  out.z = pivot.z + Math.sin(angle) * r;
  out.y = lerp(a.y, b.y, t);
  return out;
}
