import {
  actionBit,
  approach,
  dampAngle,
  PLAYER,
  v3,
  type InputFrame,
  type Vec3,
} from '@huddle/shared';
import { Character, Motion, PathFollow, SeatOccupancy, Transform } from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';

const SPRINT = actionBit('sprint');
const JUMP = actionBit('jump');
const COYOTE_TIME = 0.12;
const WAYPOINT_RADIUS = 0.35;

const wish = v3.vec3();
const delta = v3.vec3();

/** True when the player is giving any manual locomotion input this step. */
export function hasMoveInput(input: InputFrame): boolean {
  return Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05;
}

function pathWish(world: World, e: Entity, pos: Vec3, out: Vec3): boolean {
  const path = world.get(e, PathFollow);
  if (!path) return false;
  while (path.index < path.points.length) {
    const p = path.points[path.index] as Vec3;
    const dx = p.x - pos.x;
    const dz = p.z - pos.z;
    const d = Math.hypot(dx, dz);
    const last = path.index === path.points.length - 1;
    if (d > (last ? 0.12 : WAYPOINT_RADIUS)) {
      const slow = last ? Math.min(1, d / 0.8) : 1;
      out.x = (dx / d) * slow;
      out.z = (dz / d) * slow;
      return true;
    }
    path.index++;
  }
  return false;
}

/**
 * Local player locomotion: camera-relative WASD/stick, click-to-move path following, sprint,
 * jump with coyote time, gravity and collide-and-slide through the kinematic controller.
 * Returns the completed path (with its arrive action) on the step a click-to-move finishes.
 */
export function stepLocalMovement(
  world: World,
  e: Entity,
  input: InputFrame,
  cameraYaw: number,
  dt: number,
): PathFollow | null {
  const t = world.req(e, Transform);
  const m = world.req(e, Motion);
  const body = world.req(e, Character).body;
  const seat = world.get(e, SeatOccupancy);
  v3.copy(t.prevPosition, t.position);
  t.prevYaw = t.yaw;
  if (seat && seat.phase !== 'standing') {
    m.velocity.x = 0;
    m.velocity.z = 0;
    m.speed = approach(m.speed, 0, 8 * dt);
    return null;
  }

  let arrived: PathFollow | null = null;
  const manual = hasMoveInput(input);
  wish.x = 0;
  wish.y = 0;
  wish.z = 0;
  if (manual) {
    world.remove(e, PathFollow);
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    // Right vector for yaw convention (0 faces +Z): (-cos, 0, sin).
    wish.x = fx * input.moveY - Math.cos(cameraYaw) * input.moveX;
    wish.z = fz * input.moveY + Math.sin(cameraYaw) * input.moveX;
  } else if (world.has(e, PathFollow)) {
    if (!pathWish(world, e, t.position, wish)) {
      arrived = world.get(e, PathFollow) ?? null;
      world.remove(e, PathFollow);
    }
  }

  m.sprinting = (input.held & SPRINT) !== 0 && (manual || world.has(e, PathFollow));
  const maxSpeed = m.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const control = m.grounded ? 1 : PLAYER.airControl;
  const accel = PLAYER.acceleration * control * dt;
  m.velocity.x = approach(m.velocity.x, wish.x * maxSpeed, accel);
  m.velocity.z = approach(m.velocity.z, wish.z * maxSpeed, accel);

  m.airTime = m.grounded ? 0 : m.airTime + dt;
  if ((input.pressed & JUMP) !== 0 && m.airTime < COYOTE_TIME && m.velocity.y <= 0.01) {
    m.velocity.y = PLAYER.jumpVelocity;
    m.airTime = COYOTE_TIME;
  }
  m.velocity.y -= PLAYER.gravity * dt;
  if (m.grounded && m.velocity.y < 0) m.velocity.y = -2;

  v3.scale(delta, m.velocity, dt);
  body.move(delta);
  m.grounded = body.grounded;
  if (m.grounded && m.velocity.y < 0) m.velocity.y = 0;
  v3.copy(t.position, body.position);

  const hs = Math.hypot(m.velocity.x, m.velocity.z);
  m.speed = hs;
  if (hs > 0.15) t.yaw = dampAngle(t.yaw, Math.atan2(m.velocity.x, m.velocity.z), 14, dt);
  return arrived;
}
