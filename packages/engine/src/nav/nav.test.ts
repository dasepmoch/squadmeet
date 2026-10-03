import { describe, expect, it } from 'vitest';
import { makeTestRoom } from '../testing/fixtures.ts';
import { findPath, hasLineOfSight } from './pathfinder.ts';
import { bakeWalkGrid, cellIndex, isWalkable } from './walk-grid.ts';

describe('walk grid + A*', () => {
  const room = makeTestRoom();
  const grid = bakeWalkGrid(room);

  it('blocks props and walls but keeps open floor walkable', () => {
    expect(isWalkable(grid, cellIndex(grid, 0, 2))).toBe(true);
    expect(isWalkable(grid, cellIndex(grid, 0, -1))).toBe(false); // crate
    expect(isWalkable(grid, cellIndex(grid, -5.95, 0))).toBe(false); // wall margin
  });

  it('routes around an obstacle', () => {
    const start = { x: 0, y: 0, z: 1.5 };
    const goal = { x: 0, y: 0, z: -3 };
    expect(hasLineOfSight(grid, start, goal)).toBe(false);
    const path = findPath(grid, start, goal);
    expect(path).not.toBeNull();
    const last = path![path!.length - 1]!;
    expect(Math.hypot(last.x - goal.x, last.z - goal.z)).toBeLessThan(0.2);
    // Every segment must be walkable.
    let prev = start;
    for (const p of path!) {
      expect(hasLineOfSight(grid, prev, p)).toBe(true);
      prev = p;
    }
  });

  it('snaps blocked goals to the nearest walkable cell', () => {
    const path = findPath(grid, { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 });
    expect(path).not.toBeNull();
    const last = path![path!.length - 1]!;
    expect(isWalkable(grid, cellIndex(grid, last.x, last.z))).toBe(true);
  });
});
