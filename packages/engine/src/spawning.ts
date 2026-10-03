import { v3, type ResolvedRoom, type Vec3 } from '@huddle/shared';
import type { World } from './ecs/world.ts';
import type { WalkGrid } from './nav/walk-grid.ts';
import { findFreeSpot, SPAWN_CLEARANCE } from './players.ts';
import type { SeatSystem } from './seats/seat-system.ts';
import type { BotSpawnOptions } from './sim-events.ts';

export interface SpawnContext {
  readonly world: World;
  readonly room: ResolvedRoom;
  readonly seats: SeatSystem;
  readonly grid: WalkGrid | null;
}

export interface SpawnPose {
  position: Vec3;
  yaw: number;
  /** The seat to sit down on right away (asked for and it exists), or null. */
  seatId: string | null;
}

/**
 * Where a newcomer appears: an exact pose, in front of the seat they'll take, or near a room spawn
 * point and clear of everyone (overlapping capsules look broken and cost the character controller).
 */
export function spawnPose(
  ctx: SpawnContext,
  seed: number,
  options: BotSpawnOptions = {},
): SpawnPose {
  const seat = options.seatId === undefined ? undefined : ctx.seats.seat(options.seatId);
  const seatId = seat?.id ?? null;
  if (options.at) return { position: { ...options.at.position }, yaw: options.at.yaw, seatId };
  if (seat) {
    const position = findFreeSpot(ctx.world, ctx.grid, ctx.seats.approachPoint(seat), seed);
    return { position, yaw: seat.yaw, seatId };
  }
  const spawns = ctx.room.data.spawns;
  const spawn = spawns[(options.spawnIndex ?? 0) % spawns.length] ?? spawns[0];
  if (!spawn) throw new Error('Room has no spawn points');
  const center = v3.fromTuple(spawn.position);
  const position = findFreeSpot(ctx.world, ctx.grid, center, seed, SPAWN_CLEARANCE);
  return { position, yaw: spawn.yaw, seatId };
}
