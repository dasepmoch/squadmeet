import { Character, Expression, PlayerIdentity } from './components.ts';
import type { Entity, World } from './ecs/world.ts';
import type { EventBus } from './events.ts';
import type { ThrowKind } from './projectiles/throwables.ts';
import type { SimEvents } from './sim-events.ts';
import type { PlayerView } from './world-view.ts';

/** How people react when something lands on them. */
export const HIT_REACTION: Record<ThrowKind, string> = {
  paper: 'hit',
  plane: 'hit',
  tomato: 'wipe',
  duck: 'hit',
  confetti: 'cheer',
  heart: 'blush',
};

/** People with a raised hand, first come first served. */
export function handQueue(players: readonly PlayerView[]): PlayerView[] {
  return players.filter((p) => p.handRaised).sort((a, b) => a.handRaisedAt - b.handRaisedAt);
}

/** Emotes, raised hands and reactions: what everyone in the room can see someone express. */
export class SocialSystem {
  private readonly world: World;
  private readonly events: EventBus<SimEvents>;

  constructor(world: World, events: EventBus<SimEvents>) {
    this.world = world;
    this.events = events;
  }

  /**
   * Starts an upper-body action (emote, throw swing, flinch) and tells everyone. `reaction`
   * marks automatic ones (a flinch when hit) that every client derives on its own.
   */
  act(e: Entity, id: string, reaction = false): void {
    const x = this.world.get(e, Expression);
    const who = this.world.get(e, PlayerIdentity);
    if (!x || !who) return;
    x.action = id;
    x.actionSeq++;
    this.events.emit('action', { playerId: who.id, id, reaction });
  }

  handRaised(e: Entity): boolean {
    return this.world.get(e, Expression)?.handRaised ?? false;
  }

  setHand(e: Entity, raised: boolean, time: number): void {
    const x = this.world.get(e, Expression);
    const who = this.world.get(e, PlayerIdentity);
    if (!x || !who || x.handRaised === raised) return;
    x.handRaised = raised;
    x.handRaisedAt = time;
    this.events.emit('handRaised', { playerId: who.id, raised });
  }

  shielded(e: Entity): boolean {
    return this.world.get(e, Expression)?.shield ?? false;
  }

  /** "Don't hit me": thrown things pass through this person's body (and they don't throw). */
  setShield(e: Entity, on: boolean): void {
    const x = this.world.get(e, Expression);
    const who = this.world.get(e, PlayerIdentity);
    if (!x || !who || x.shield === on) return;
    x.shield = on;
    this.world.get(e, Character)?.body.setProjectileContact(!on);
    this.events.emit('shield', { playerId: who.id, on });
  }
}
