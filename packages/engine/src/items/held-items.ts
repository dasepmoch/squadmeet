import { ITEM_USE, PIZZA_BITES, v3, type HeldItem, type Vec3 } from '@huddle/shared';
import { Expression, PlayerIdentity } from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';
import type { EventBus } from '../events.ts';
import type { ProjectileSystem } from '../projectiles/projectile-system.ts';
import type { SimEvents } from '../sim-events.ts';
import type { SocialSystem } from '../social.ts';

/** Something to interact with that moves or comes and goes (a landed paper plane). */
export interface DynamicInteractable {
  kind: string;
  id: string;
  position: Vec3;
  radius: number;
  labelKey: string;
}

export interface ItemDeps {
  world: World;
  events: EventBus<SimEvents>;
  social: SocialSystem;
  projectiles: ProjectileSystem;
}

/** Reach for picking up a landed paper plane. */
const PICKUP_RADIUS = 1.5;
/** The last slice leaves the hand once its bite is over. */
const LAST_BITE_SECONDS = 1.3;

/** Interactable id of `throwerId`'s landed plane number `seq`. */
export function pickupId(throwerId: string, seq: number): string {
  return `plane:${throwerId}:${seq}`;
}

export function parsePickupId(id: string): { throwerId: string; seq: number } | null {
  const m = /^plane:([A-Za-z0-9_-]{1,40}):(\d{1,5})$/.exec(id);
  return m?.[1] && m[2] ? { throwerId: m[1], seq: Number(m[2]) } : null;
}

/**
 * What people hold: a mug from the coffee machine, a cup of water, a pizza slice, a phone, a
 * sign, a picked-up paper plane. Using it plays its action (a sip, a bite, the sign raised high);
 * a pizza slice is gone after a few bites. Everyone sees what everyone holds.
 */
export class ItemSystem {
  private readonly d: ItemDeps;
  private readonly bites = new Map<Entity, number>();
  private readonly finishing = new Map<Entity, number>();
  private readonly targets: DynamicInteractable[] = [];

  constructor(deps: ItemDeps) {
    this.d = deps;
  }

  heldBy(e: Entity): HeldItem | null {
    return this.d.world.get(e, Expression)?.held ?? null;
  }

  /** Puts `item` in the hand (null: empty hands). */
  hold(e: Entity, item: HeldItem | null): void {
    const x = this.d.world.get(e, Expression);
    const who = this.d.world.get(e, PlayerIdentity);
    if (!x || !who || x.held === item) return;
    x.held = item;
    this.bites.delete(e);
    this.finishing.delete(e);
    this.d.events.emit('held', { playerId: who.id, item });
  }

  /** Uses the held item (sip, bite, raise the sign). False with empty hands or nothing to do. */
  use(e: Entity, time: number): boolean {
    const item = this.heldBy(e);
    const action = item ? ITEM_USE[item] : null;
    if (!item || !action || this.finishing.has(e)) return false;
    this.d.social.act(e, action);
    if (item === 'pizza') {
      const n = (this.bites.get(e) ?? 0) + 1;
      this.bites.set(e, n);
      if (n >= PIZZA_BITES) this.finishing.set(e, time + LAST_BITE_SECONDS);
    }
    return true;
  }

  /** Picks up a landed paper plane: it leaves the floor and goes into the hand. */
  pickup(e: Entity, throwerId: string, seq: number): boolean {
    const who = this.d.world.get(e, PlayerIdentity);
    if (!who || !this.d.projectiles.take(throwerId, seq)) return false;
    this.hold(e, 'plane');
    this.d.events.emit('pickedUp', { playerId: who.id, throwerId, seq });
    return true;
  }

  /** Someone on another client picked a plane up: it leaves the floor here too. */
  pickedUpElsewhere(e: Entity, throwerId: string, seq: number): void {
    this.d.projectiles.take(throwerId, seq);
    this.hold(e, 'plane');
  }

  /** Finishes eaten pizza. Once per fixed step. */
  step(time: number): void {
    for (const [e, at] of this.finishing) {
      if (time < at) continue;
      this.finishing.delete(e);
      this.hold(e, null);
    }
  }

  /** A player left. */
  forget(e: Entity): void {
    this.bites.delete(e);
    this.finishing.delete(e);
  }

  /** Landed paper planes anyone can pick up (reused array, rebuilt per call). */
  pickupTargets(): readonly DynamicInteractable[] {
    const out = this.targets;
    let n = 0;
    for (const p of this.d.projectiles.views) {
      if (p.kind !== 'plane' || !p.resting) continue;
      const t = (out[n] ??= {
        kind: 'pickup',
        id: '',
        position: v3.vec3(),
        radius: PICKUP_RADIUS,
        labelKey: 'interact.pickup',
      });
      t.id = pickupId(p.throwerId, p.seq);
      v3.copy(t.position, p.position);
      n++;
    }
    out.length = n;
    return out;
  }
}
