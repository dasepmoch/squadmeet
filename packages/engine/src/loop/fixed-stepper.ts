import { MAX_SUBSTEPS, SIM_DT } from '@huddle/shared';

/**
 * Fixed-timestep accumulator. The simulation always advances in `dt` increments; rendering
 * interpolates between the last two steps using `alpha`.
 */
export class FixedStepper {
  readonly dt: number;
  private readonly maxSubsteps: number;
  private accumulator = 0;
  private droppedMs = 0;
  alpha = 0;
  steps = 0;

  constructor(dt: number = SIM_DT, maxSubsteps: number = MAX_SUBSTEPS) {
    this.dt = dt;
    this.maxSubsteps = maxSubsteps;
  }

  /**
   * Advances by a frame delta (seconds) and calls `step` for every whole fixed step.
   * Returns the number of steps executed this frame.
   */
  advance(frameDt: number, step: (dt: number, index: number) => void): number {
    this.accumulator += Math.max(0, frameDt);
    let n = 0;
    while (this.accumulator >= this.dt && n < this.maxSubsteps) {
      step(this.dt, n);
      this.accumulator -= this.dt;
      n++;
    }
    if (n === this.maxSubsteps && this.accumulator >= this.dt) {
      // Spiral-of-death guard: drop the backlog instead of trying to catch up forever.
      this.droppedMs += (this.accumulator - (this.accumulator % this.dt)) * 1000;
      this.accumulator %= this.dt;
    }
    this.alpha = this.accumulator / this.dt;
    this.steps += n;
    return n;
  }

  /** Total simulated time discarded by the spiral-of-death guard. */
  get dropped(): number {
    return this.droppedMs;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}
