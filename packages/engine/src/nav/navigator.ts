import type { Vec3 } from '@huddle/shared';
import { PathFollow, Transform } from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';
import type { SeatSystem } from '../seats/seat-system.ts';
import { findPath } from './pathfinder.ts';
import { cellCenter, isWalkable, type WalkGrid } from './walk-grid.ts';

export type ArriveAction = { kind: 'seat' | 'interact'; id: string };

/**
 * Walking intents shared by the local player and bots: A* paths over the baked walk grid, and
 * "walk to the seat, then sit" with a straight-line fallback while the grid is still baking.
 */
export class Navigator {
  walkGrid: WalkGrid | null = null;
  private readonly world: World;
  private readonly seats: SeatSystem;

  constructor(world: World, seats: SeatSystem) {
    this.world = world;
    this.seats = seats;
  }

  /** Starts a path to `goal`. Returns the path's end point, or null when unreachable. */
  walkTo(e: Entity, goal: Vec3, action: ArriveAction | null): Vec3 | null {
    const t = this.world.get(e, Transform);
    if (!t || !this.walkGrid) return null;
    const points = findPath(this.walkGrid, t.position, goal);
    if (!points || points.length === 0) return null;
    this.world.add(e, PathFollow, { points, index: 0, arriveAction: action });
    return points[points.length - 1] ?? null;
  }

  /**
   * Sits down when close enough, otherwise walks to the seat first. Returns the walk target
   * when walking, null when sitting right away (or when sitting is impossible).
   */
  sit(e: Entity, seatId: string): Vec3 | null {
    if (this.seats.requestSit(this.world, e, seatId) !== 'far') return null;
    const seat = this.seats.seat(seatId);
    if (!seat) return null;
    const approach = this.seats.approachPoint(seat);
    const action: ArriveAction = { kind: 'seat', id: seatId };
    const end = this.walkTo(e, approach, action);
    if (end) return end;
    this.world.add(e, PathFollow, { points: [approach], index: 0, arriveAction: action });
    return approach;
  }

  /** A single sit attempt on arrival; interactions are handed back to the caller. */
  arrived(e: Entity, action: ArriveAction | null): ArriveAction | null {
    if (!action) return null;
    if (action.kind === 'seat') {
      this.seats.requestSit(this.world, e, action.id);
      return null;
    }
    return action;
  }

  /** A random walkable floor point (for wandering bots), or null before the grid is baked. */
  randomPoint(random: () => number, out: Vec3): Vec3 | null {
    const g = this.walkGrid;
    if (!g) return null;
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(random() * g.heights.length);
      if (!isWalkable(g, idx)) continue;
      const c = cellCenter(g, idx);
      out.x = c.x;
      out.y = c.y;
      out.z = c.z;
      return out;
    }
    return null;
  }
}
