import { clamp, type HeldItem } from '@huddle/shared';
import type { Entity } from './ecs/world.ts';
import { parsePickupId, type ItemSystem } from './items/held-items.ts';
import type { ThrowKind } from './projectiles/throwables.ts';
import type { SocialSystem } from './social.ts';

/** Camera zoom travel (a wheel notch is about 0.2) per quarter step of paper-plane tilt. */
const WHEEL_PER_TILT_STEP = 0.2;
const TILT_STEP = 0.25;

export interface LocalPlayDeps {
  readonly items: ItemSystem;
  readonly social: SocialSystem;
  /** The local player's entity, null before spawning. */
  local(): Entity | null;
  time(): number;
  /** Starts aiming `kind` (a picked-up plane is ready to fly again). */
  aim(kind: ThrowKind): void;
}

/**
 * The local player's playful state: what they hold, "Don't hit me" protection, the paper-plane
 * release tilt (the wheel while aiming a plane) and picking landed planes up again.
 */
export class LocalPlay {
  /** Paper-plane release tilt for the next throw, -1..1 (-1 banks left, 1 right). */
  planeTilt = 0;
  private readonly d: LocalPlayDeps;
  /** Wheel travel not yet turned into a tilt step. */
  private wheelTravel = 0;

  constructor(deps: LocalPlayDeps) {
    this.d = deps;
  }

  /** What the local player holds. */
  get held(): HeldItem | null {
    const e = this.d.local();
    return e === null ? null : this.d.items.heldBy(e);
  }

  /** Puts something in the local player's hand (null puts it away). */
  hold(item: HeldItem | null): void {
    const e = this.d.local();
    if (e !== null) this.d.items.hold(e, item);
  }

  /** Uses the held item: a sip, a bite, the sign held up high. */
  use(): boolean {
    const e = this.d.local();
    return e !== null && this.d.items.use(e, this.d.time());
  }

  get shielded(): boolean {
    const e = this.d.local();
    return e !== null && this.d.social.shielded(e);
  }

  setShield(on: boolean): void {
    const e = this.d.local();
    if (e !== null) this.d.social.setShield(e, on);
  }

  /** Tilts the paper plane's wings for the next throw, in quarter steps. */
  tilt(delta: number): void {
    this.planeTilt = clamp(Math.round((this.planeTilt + delta) / TILT_STEP) * TILT_STEP, -1, 1);
  }

  /** Wheel input while aiming a plane: tilts the wings a step per notch. Returns the zoom left. */
  wheel(zoom: number): number {
    this.wheelTravel += zoom;
    while (Math.abs(this.wheelTravel) >= WHEEL_PER_TILT_STEP) {
      const s = Math.sign(this.wheelTravel);
      this.wheelTravel -= s * WHEEL_PER_TILT_STEP;
      this.tilt(s * TILT_STEP);
    }
    return 0;
  }

  /** Picks up a landed paper plane (its interactable id) and gets ready to throw it again. */
  pickup(id: string): boolean {
    const ref = parsePickupId(id);
    const e = this.d.local();
    if (!ref || e === null || !this.d.items.pickup(e, ref.throwerId, ref.seq)) return false;
    this.d.aim('plane');
    return true;
  }
}
