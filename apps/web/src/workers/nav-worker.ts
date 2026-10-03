import { bakeWalkGrid } from '@huddle/engine/nav';
import type { ResolvedRoom } from '@huddle/shared';

// Walk-grid baking off the main thread.
self.onmessage = (event: MessageEvent<ResolvedRoom>) => {
  const grid = bakeWalkGrid(event.data);
  self.postMessage(grid, { transfer: [grid.heights.buffer as ArrayBuffer] });
};
