import { createInputFrame, type InputFrame } from '@huddle/shared';
import type { Simulation } from '../simulation.ts';
import { FixedStepper } from './fixed-stepper.ts';

/**
 * Drives a `Simulation` from variable-rate frames. Input edges (presses, clicks) are
 * accumulated until a fixed step consumes them, so no press is lost on frames with zero steps
 * and none is applied twice on frames with several.
 */
export class SimDriver {
  readonly stepper: FixedStepper;
  private readonly sim: Simulation;
  private readonly pending: InputFrame = createInputFrame();

  constructor(sim: Simulation, stepper: FixedStepper = new FixedStepper()) {
    this.sim = sim;
    this.stepper = stepper;
  }

  frame(input: InputFrame, frameDt: number): number {
    const p = this.pending;
    p.moveX = input.moveX;
    p.moveY = input.moveY;
    p.held = input.held;
    p.pressed |= input.pressed;
    p.released |= input.released;
    p.clicked = p.clicked || input.clicked;
    p.pointerX = input.pointerX;
    p.pointerY = input.pointerY;
    p.pointerActive = input.pointerActive;
    p.primaryDown = input.primaryDown;
    p.device = input.device;

    this.sim.applyLook(input, frameDt);
    const steps = this.stepper.advance(frameDt, (dt, index) => {
      this.sim.fixedUpdate(p, dt);
      if (index === 0) {
        p.pressed = 0;
        p.released = 0;
        p.clicked = false;
      }
    });
    this.sim.postStep(input, frameDt, this.stepper.alpha);
    return steps;
  }
}
