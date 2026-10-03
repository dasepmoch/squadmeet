import type { Vec3 } from '@huddle/shared';
import { cellCenter, cellIndex, isWalkable, nearestWalkable, type WalkGrid } from './walk-grid.ts';

const SQRT2 = Math.SQRT2;
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Binary min-heap keyed by f-score, storing cell indices. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, score: number): void {
    this.items.push(item);
    this.scores.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.scores[p] as number) <= score) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const lastItem = this.items.pop() as number;
    const lastScore = this.scores.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && (this.scores[l] as number) < (this.scores[m] as number)) m = l;
        if (r < this.items.length && (this.scores[r] as number) < (this.scores[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a] as number;
    this.items[a] = this.items[b] as number;
    this.items[b] = ti;
    const ts = this.scores[a] as number;
    this.scores[a] = this.scores[b] as number;
    this.scores[b] = ts;
  }
}

function canStep(grid: WalkGrid, from: number, to: number): boolean {
  if (!isWalkable(grid, to)) return false;
  return Math.abs((grid.heights[to] as number) - (grid.heights[from] as number)) <= grid.maxStep;
}

/** Line of sight across the grid (walkable, step-continuous cells), used for path smoothing. */
export function hasLineOfSight(grid: WalkGrid, a: Vec3, b: Vec3): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / (grid.cellSize * 0.4)));
  let prev = cellIndex(grid, a.x, a.z);
  if (!isWalkable(grid, prev)) return false;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const i = cellIndex(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (i !== prev) {
      if (!canStep(grid, prev, i)) return false;
      prev = i;
    }
  }
  return true;
}

/**
 * A* on the walk grid (8-connected, no corner cutting, step-height aware) followed by greedy
 * string-pulling. Returns world-space waypoints excluding the start, or null when unreachable.
 */
export function findPath(
  grid: WalkGrid,
  start: Vec3,
  goal: Vec3,
  maxExpanded = 20_000,
): Vec3[] | null {
  let s = cellIndex(grid, start.x, start.z);
  if (!isWalkable(grid, s)) s = nearestWalkable(grid, start.x, start.z, 4);
  let g = cellIndex(grid, goal.x, goal.z);
  if (!isWalkable(grid, g)) g = nearestWalkable(grid, goal.x, goal.z);
  if (s < 0 || g < 0) return null;
  if (s === g) return [{ ...cellCenter(grid, g) }];

  const n = grid.cols * grid.rows;
  const gScore = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gq = g % grid.cols;
  const gr = Math.floor(g / grid.cols);
  const h = (i: number): number => {
    const dq = Math.abs((i % grid.cols) - gq);
    const dr = Math.abs(Math.floor(i / grid.cols) - gr);
    return Math.max(dq, dr) + (SQRT2 - 1) * Math.min(dq, dr);
  };
  const open = new MinHeap();
  gScore[s] = 0;
  open.push(s, h(s));
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === g) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxExpanded) return null;
    const cq = cur % grid.cols;
    const cr = Math.floor(cur / grid.cols);
    for (const [dq, dr, cost] of NEIGHBORS) {
      const q = cq + dq;
      const r = cr + dr;
      if (q < 0 || r < 0 || q >= grid.cols || r >= grid.rows) continue;
      const next = r * grid.cols + q;
      if (closed[next] || !canStep(grid, cur, next)) continue;
      if (dq !== 0 && dr !== 0) {
        if (!canStep(grid, cur, cr * grid.cols + q) || !canStep(grid, cur, r * grid.cols + cq))
          continue;
      }
      const tentative = (gScore[cur] as number) + cost;
      if (tentative < (gScore[next] as number)) {
        gScore[next] = tentative;
        came[next] = cur;
        open.push(next, tentative + h(next));
      }
    }
  }
  if (came[g] === -1) return null;

  const cells: number[] = [];
  for (let c = g; c !== -1; c = came[c] as number) cells.push(c);
  cells.reverse();
  const raw = cells.map((c) => cellCenter(grid, c));
  const smoothed: Vec3[] = [];
  let anchor: Vec3 = { x: start.x, y: start.y, z: start.z };
  let i = 1;
  while (i < raw.length) {
    let far = i;
    for (let j = raw.length - 1; j > i; j--) {
      if (hasLineOfSight(grid, anchor, raw[j] as Vec3)) {
        far = j;
        break;
      }
    }
    const p = raw[far] as Vec3;
    smoothed.push(p);
    anchor = p;
    i = far + 1;
  }
  const end = smoothed[smoothed.length - 1];
  if (end && cellIndex(grid, goal.x, goal.z) === g) {
    end.x = goal.x;
    end.z = goal.z;
  }
  return smoothed;
}
