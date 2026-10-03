import { PLAYER, type ResolvedCollider, type ResolvedRoom } from '@huddle/shared';

/**
 * Baked navigation grid. Each cell stores the walkable floor height, or NaN when blocked.
 * Plain typed arrays, so it can be baked in a worker and transferred.
 */
export interface WalkGrid {
  originX: number;
  originZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  maxStep: number;
  heights: Float32Array;
}

export interface BakeOptions {
  cellSize: number;
  /** Agent radius plus a comfort margin. */
  radius: number;
  maxStep: number;
  clearance: number;
}

export const DEFAULT_BAKE: BakeOptions = {
  cellSize: 0.25,
  radius: PLAYER.radius + 0.06,
  maxStep: 0.32,
  clearance: 1.7,
};

function inFootprint(c: ResolvedCollider, x: number, z: number, grow: number): boolean {
  const dx = x - c.center[0];
  const dz = z - c.center[2];
  if (c.shape === 'cylinder') {
    const r = c.radius + grow;
    return dx * dx + dz * dz <= r * r;
  }
  const cos = Math.cos(-c.yaw);
  const sin = Math.sin(-c.yaw);
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  return Math.abs(lx) <= c.half[0] + grow && Math.abs(lz) <= c.half[2] + grow;
}

function verticalRange(c: ResolvedCollider): [number, number] {
  const h = c.shape === 'box' ? c.half[1] : c.halfHeight;
  return [c.center[1] - h, c.center[1] + h];
}

/** Pure bake from resolved colliders. ~7k cells for the Sunny Loft; runs in a worker on web. */
export function bakeWalkGrid(room: ResolvedRoom, options: BakeOptions = DEFAULT_BAKE): WalkGrid {
  const { cellSize, radius, maxStep, clearance } = options;
  const minX = room.bounds.min[0];
  const minZ = room.bounds.min[2];
  const cols = Math.ceil((room.bounds.max[0] - minX) / cellSize);
  const rows = Math.ceil((room.bounds.max[2] - minZ) / cellSize);
  const heights = new Float32Array(cols * rows);
  const surfaces = room.colliders.filter((c) => c.walkable && verticalRange(c)[1] <= 0.6);
  const obstacles = room.colliders.filter((c) => !c.walkable || verticalRange(c)[1] > 0.6);

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const x = minX + (q + 0.5) * cellSize;
      const z = minZ + (r + 0.5) * cellSize;
      let floor = 0;
      for (const s of surfaces) {
        const top = verticalRange(s)[1];
        if (top > floor && inFootprint(s, x, z, 0)) floor = top;
      }
      let blocked = false;
      for (const o of obstacles) {
        const [bottom, top] = verticalRange(o);
        if (top <= floor + maxStep || bottom >= floor + clearance) continue;
        if (inFootprint(o, x, z, radius)) {
          blocked = true;
          break;
        }
      }
      // Surfaces we are not standing on still block at their edges if they are too tall to step.
      if (!blocked) {
        for (const s of surfaces) {
          const top = verticalRange(s)[1];
          if (top > floor + maxStep && inFootprint(s, x, z, radius)) {
            blocked = true;
            break;
          }
        }
      }
      heights[r * cols + q] = blocked ? Number.NaN : floor;
    }
  }
  return { originX: minX, originZ: minZ, cellSize, cols, rows, maxStep, heights };
}

export function cellIndex(grid: WalkGrid, x: number, z: number): number {
  const q = Math.floor((x - grid.originX) / grid.cellSize);
  const r = Math.floor((z - grid.originZ) / grid.cellSize);
  if (q < 0 || r < 0 || q >= grid.cols || r >= grid.rows) return -1;
  return r * grid.cols + q;
}

export function isWalkable(grid: WalkGrid, index: number): boolean {
  return index >= 0 && index < grid.heights.length && !Number.isNaN(grid.heights[index]);
}

export function cellCenter(grid: WalkGrid, index: number): { x: number; y: number; z: number } {
  const q = index % grid.cols;
  const r = Math.floor(index / grid.cols);
  return {
    x: grid.originX + (q + 0.5) * grid.cellSize,
    y: grid.heights[index] ?? 0,
    z: grid.originZ + (r + 0.5) * grid.cellSize,
  };
}

/** Nearest walkable cell to a point (spiral search), or -1. */
export function nearestWalkable(grid: WalkGrid, x: number, z: number, maxRadiusCells = 12): number {
  const q0 = Math.floor((x - grid.originX) / grid.cellSize);
  const r0 = Math.floor((z - grid.originZ) / grid.cellSize);
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring <= maxRadiusCells; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dq = -ring; dq <= ring; dq++) {
        if (Math.max(Math.abs(dr), Math.abs(dq)) !== ring) continue;
        const q = q0 + dq;
        const r = r0 + dr;
        if (q < 0 || r < 0 || q >= grid.cols || r >= grid.rows) continue;
        const i = r * grid.cols + q;
        if (!isWalkable(grid, i)) continue;
        const c = cellCenter(grid, i);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return best;
}
