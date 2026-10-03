import { actionBit, v3, type InputFrame, type ResolvedRoom, type Vec3 } from '@huddle/shared';
import type { SeatPhase } from '../components.ts';
import type { PhysicsWorld } from '../physics/physics-world.ts';
import type { SeatSystem } from '../seats/seat-system.ts';
import type { CameraView, PlayerView } from '../world-view.ts';
import type { CameraRig } from './camera-rig.ts';
import type { CameraContext, CameraInput } from './camera-views.ts';

const JUMP = actionBit('jump');
const SPRINT = actionBit('sprint');
const FLY_DOWN = actionBit('flyDown');

/** The camera's view of the room: screen, overview pose, bounds and static raycasts. */
export function createCameraContext(room: ResolvedRoom, physics: PhysicsWorld): CameraContext {
  const ov = room.data.overviewCamera;
  return {
    pivotFeet: null,
    seatEye: null,
    seatYaw: 0,
    screen: room.screen,
    overview: ov ? { position: v3.fromTuple(ov.position), target: v3.fromTuple(ov.target) } : null,
    bounds: room.bounds,
    pointerX: 0,
    pointerY: 0,
    aspect: 16 / 9,
    reducedMotion: false,
    raycastStatic: (o, d, max) => physics.raycastStatic(o, d, max),
  };
}

export function createCameraInput(): CameraInput {
  return {
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
}

/** Maps a frame of input onto the camera; WASD, Space and Z fly only the free and overview views. */
export function fillCameraInput(input: InputFrame, flying: boolean, out: CameraInput): CameraInput {
  out.lookX = input.lookX;
  out.lookY = input.lookY;
  out.panX = input.panX;
  out.panY = input.panY;
  out.zoom = input.zoom;
  out.moveX = flying ? input.moveX : 0;
  out.moveY = flying ? input.moveY : 0;
  out.moveUp = flying
    ? ((input.held & JUMP) !== 0 ? 1 : 0) - ((input.held & FLY_DOWN) !== 0 ? 1 : 0)
    : 0;
  out.fast = (input.held & SPRINT) !== 0;
  return out;
}

/** Points the context at the local player (and their seat) for this frame. */
export function syncCameraContext(
  ctx: CameraContext,
  local: PlayerView | null,
  seats: SeatSystem,
  input: InputFrame,
  seatEye: Vec3,
): void {
  ctx.pivotFeet = local ? local.position : null;
  ctx.seatEye = null;
  const seat = local?.seatId ? seats.seat(local.seatId) : undefined;
  if (seat) {
    ctx.seatEye = v3.fromTuple(seat.eye, seatEye);
    ctx.seatYaw = seat.yaw;
  }
  ctx.pointerX = input.pointerActive ? input.pointerX : 0;
  ctx.pointerY = input.pointerActive ? input.pointerY : 0;
}

/** Sitting down switches to the cinema view only from the avatar cameras; standing up returns. */
export function followSeatPhase(camera: CameraRig, phase: SeatPhase | undefined): void {
  const mode = camera.mode;
  if (phase === 'sittingDown' && (mode === 'follow' || mode === 'focus')) camera.setMode('seated');
  if (phase === 'standingUp' && (mode === 'seated' || mode === 'seatedFree')) {
    camera.setMode('follow', false, 0.7);
  }
}

/** Publishes the rig's current pose to the read-only world view. */
export function writeCameraView(camera: CameraRig, out: CameraView): void {
  v3.copy(out.position, camera.pose.position);
  v3.copy(out.target, camera.pose.target);
  out.fov = camera.pose.fov;
  out.mode = camera.mode;
}
