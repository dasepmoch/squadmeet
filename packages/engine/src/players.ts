import { lerpAngle, v3, type Vec3 } from '@huddle/shared';
import {
  Character,
  Expression,
  Motion,
  PlayerIdentity,
  SeatOccupancy,
  Transform,
} from './components.ts';
import type { Entity, World } from './ecs/world.ts';
import { cellIndex, isWalkable, type WalkGrid } from './nav/walk-grid.ts';
import type { PhysicsWorld } from './physics/physics-world.ts';
import type { PlayerView } from './world-view.ts';

export interface PlayerSpawn {
  id: string;
  name: string;
  isLocal: boolean;
  position: Vec3;
  yaw: number;
}

/**
 * Creates a walking, sitting person (the local player, a bot, later remote players): transform,
 * motion, a kinematic capsule owned by the player id (so projectile hits know who they hit), seat
 * occupancy and social expression.
 */
export function createPlayerEntity(world: World, physics: PhysicsWorld, s: PlayerSpawn): Entity {
  const pos = s.position;
  const e = world.create();
  world.add(e, Transform, {
    position: { ...pos },
    yaw: s.yaw,
    prevPosition: { ...pos },
    prevYaw: s.yaw,
  });
  world.add(e, Motion, {
    velocity: v3.vec3(),
    grounded: true,
    sprinting: false,
    airTime: 0,
    speed: 0,
  });
  const body = physics.createCharacter(pos);
  body.ownerId = s.id;
  world.add(e, Character, { body });
  world.add(e, PlayerIdentity, { id: s.id, name: s.name, isLocal: s.isLocal });
  world.add(e, SeatOccupancy, {
    seatId: null,
    phase: 'standing',
    blend: 0,
    posture: null,
    standPosition: { ...pos },
    standYaw: s.yaw,
  });
  world.add(e, Expression, {
    handRaised: false,
    handRaisedAt: 0,
    action: null,
    actionSeq: 0,
    held: null,
    shield: false,
  });
  return e;
}

/** Copies interpolated simulation state of one player into its render view. */
export function writePlayerView(world: World, e: Entity, view: PlayerView, alpha: number): void {
  const t = world.get(e, Transform);
  if (!t) return;
  const prevX = view.position.x;
  const prevZ = view.position.z;
  v3.lerpVec(view.position, t.prevPosition, t.position, alpha);
  view.yaw = lerpAngle(t.prevYaw, t.yaw, alpha);
  const m = world.get(e, Motion);
  if (m) {
    view.speed = m.speed;
    view.verticalVelocity = m.velocity.y;
    view.grounded = m.grounded;
  }
  view.stride += Math.hypot(view.position.x - prevX, view.position.z - prevZ);
  const seat = world.get(e, SeatOccupancy);
  if (seat) {
    view.seatId = seat.seatId;
    view.posture = seat.posture;
    view.sitBlend = seat.blend;
  }
  const x = world.get(e, Expression);
  if (x) {
    view.handRaised = x.handRaised;
    view.handRaisedAt = x.handRaisedAt;
    view.action = x.action;
    view.actionSeq = x.actionSeq;
    view.held = x.held;
    view.shield = x.shield;
  }
}

/** True when a player counts as seated for aiming and picking (mid-transition included). */
export function isSeatedPose(occ: SeatOccupancy | undefined): boolean {
  return occ !== undefined && occ.phase !== 'standing' && occ.blend > 0.5;
}

/** Moves a player instantly (no interpolation from the old spot). False without a body. */
export function placePlayer(world: World, e: Entity, p: Vec3, yaw: number): boolean {
  const t = world.get(e, Transform);
  const ch = world.get(e, Character);
  if (!t || !ch) return false;
  ch.body.teleport(p);
  v3.copy(t.position, p);
  v3.copy(t.prevPosition, p);
  t.yaw = yaw;
  t.prevYaw = yaw;
  return true;
}

/** Arm's length plus a bit: someone gesturing at a spawn must not reach into a newcomer. */
export const SPAWN_CLEARANCE = 1.3;

/**
 * `center`, or the nearest spot on a golden-angle spiral around it that keeps `clearance` from
 * everyone (and is walkable once the grid is baked). Overlapping kinematic capsules are
 * expensive for the character controller and look broken.
 */
export function findFreeSpot(
  world: World,
  grid: WalkGrid | null,
  center: Vec3,
  seed: number,
  clearance = 0.72,
  ignore: Entity | null = null,
): Vec3 {
  for (let i = 0; i < 60; i++) {
    const a = seed * 0.7 + i * 2.39996;
    const r = i === 0 ? 0 : Math.max(0.75, clearance) + 0.3 * Math.floor(i / 7);
    const x = center.x + Math.sin(a) * r;
    const z = center.z + Math.cos(a) * r;
    if (grid && !isWalkable(grid, cellIndex(grid, x, z))) continue;
    if (crowded(world, x, z, clearance, ignore)) continue;
    return { x, y: center.y, z };
  }
  return { ...center };
}

function crowded(
  world: World,
  x: number,
  z: number,
  radius: number,
  ignore: Entity | null,
): boolean {
  for (const e of world.query(Transform, Character)) {
    if (e === ignore) continue;
    const p = world.req(e, Transform).position;
    if (Math.hypot(p.x - x, p.z - z) < radius) return true;
  }
  return false;
}
