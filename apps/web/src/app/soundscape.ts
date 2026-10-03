import type { WorldView } from '@huddle/engine';
import type { Sfx } from './sfx.ts';

/** Meters of travel per footstep, walking and running. */
const STEP_WALK = 0.68;
const STEP_RUN = 0.95;
const RUN_SPEED = 3.4;
/** Footsteps farther from the camera than this stay silent. */
const HEAR_STEPS = 9;
const CLICKABLE =
  'button, [role="menuitem"], [role="tab"], [role="switch"], [role="radio"], select, input[type="checkbox"]';

/**
 * The room's background sound: footsteps of whoever walks nearby (phase-locked to their
 * stride, like the walk animation), a quiet room tone, and soft clicks on HUD buttons.
 */
export class Soundscape {
  private readonly sfx: Sfx;
  /** Stride distance at which each player's next step sounds. */
  private readonly nextStep = new Map<string, number>();
  private level: number;
  private applied = Number.NaN;
  private playersVersion = -1;

  constructor(sfx: Sfx, ambience: number) {
    this.sfx = sfx;
    this.level = ambience;
  }

  /** Room tone level, 0..1. */
  setAmbience(level: number): void {
    this.level = level;
    this.applied = Number.NaN;
  }

  /** Once per frame, after the simulation (strides are interpolated render state). */
  update(view: WorldView): void {
    // Audio starts locked until a user gesture: keep trying until the tone can start.
    if (this.applied !== this.level && this.sfx.setAmbience(this.level)) this.applied = this.level;
    if (view.playersVersion !== this.playersVersion) {
      this.playersVersion = view.playersVersion;
      const ids = new Set(view.players.map((p) => p.id));
      for (const id of this.nextStep.keys()) if (!ids.has(id)) this.nextStep.delete(id);
    }
    const cam = view.camera.position;
    for (const p of view.players) {
      const next = this.nextStep.get(p.id);
      const run = p.speed > RUN_SPEED;
      if (next === undefined || p.stride < next - 3) {
        this.nextStep.set(p.id, p.stride + STEP_WALK);
        continue;
      }
      if (p.stride < next) continue;
      this.nextStep.set(p.id, p.stride + (run ? STEP_RUN : STEP_WALK));
      if (!p.grounded || p.seatId !== null || p.speed < 0.3) continue;
      if (Math.hypot(p.position.x - cam.x, p.position.z - cam.z) > HEAR_STEPS) continue;
      const gain = (p.isLocal ? 0.32 : 0.22) * Math.min(1.25, 0.55 + p.speed / 4);
      this.sfx.play('step', p.position, gain);
    }
  }

  /** Soft clicks for HUD buttons (capture phase: the buttons' own handlers run as usual). */
  attachClicks(root: HTMLElement): () => void {
    const onClick = (e: Event): void => {
      const target = e.target;
      if (target instanceof Element && target.closest(CLICKABLE)) this.sfx.play('click', null, 0.3);
    };
    root.addEventListener('click', onClick, true);
    return () => root.removeEventListener('click', onClick, true);
  }
}
