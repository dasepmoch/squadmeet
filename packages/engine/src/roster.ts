import { v3, type Vec3 } from '@huddle/shared';
import { Character, LocalPlayer, PlayerIdentity } from './components.ts';
import type { Entity, World } from './ecs/world.ts';
import type { EventBus } from './events.ts';
import type { PhysicsWorld } from './physics/physics-world.ts';
import { createPlayerEntity, writePlayerView } from './players.ts';
import type { ThrowSystem } from './projectiles/throw-system.ts';
import type { SeatSystem } from './seats/seat-system.ts';
import type { SimEvents } from './sim-events.ts';
import { createPlayerView, type PlayerView, type WorldView } from './world-view.ts';

export interface RosterDeps {
  world: World;
  physics: PhysicsWorld;
  view: WorldView;
  events: EventBus<SimEvents>;
  seats: SeatSystem;
  throws: ThrowSystem;
}

export interface RosterEntry {
  id: string;
  name: string;
  isLocal: boolean;
  isBot: boolean;
  position: Vec3;
  yaw: number;
}

/**
 * Everyone in the room: player entities by id, their published views, and spawning / removal
 * with the matching `playerSpawned` / `playerRemoved` events.
 */
export class PlayerRoster {
  /** The local player's entity, or null before spawning. */
  local: Entity | null = null;
  private readonly d: RosterDeps;
  private readonly views = new Map<Entity, PlayerView>();
  private readonly byId = new Map<string, Entity>();

  constructor(deps: RosterDeps) {
    this.d = deps;
  }

  entityOf(id: string): Entity | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  idOf(e: Entity): string {
    return this.d.world.get(e, PlayerIdentity)?.id ?? '';
  }

  spawn(p: RosterEntry): Entity {
    if (this.byId.has(p.id)) throw new Error(`Player ${p.id} already exists`);
    const { world, physics } = this.d;
    const e = createPlayerEntity(world, physics, {
      id: p.id,
      name: p.name,
      isLocal: p.isLocal,
      position: p.position,
      yaw: p.yaw,
    });
    if (p.isLocal) {
      world.add(e, LocalPlayer, true);
      this.local = e;
    }
    const view = createPlayerView(p.id, e, p.isLocal, p.name, p.isBot);
    v3.copy(view.position, p.position);
    view.yaw = p.yaw;
    this.views.set(e, view);
    this.byId.set(p.id, e);
    this.d.view.addPlayer(view);
    this.d.events.emit('playerSpawned', {
      entity: e,
      id: p.id,
      isLocal: p.isLocal,
      isBot: p.isBot,
    });
    return e;
  }

  /** Renames a player (name tags pick it up from the view). */
  rename(id: string, name: string): void {
    const e = this.byId.get(id);
    const who = e === undefined ? undefined : this.d.world.get(e, PlayerIdentity);
    const view = e === undefined ? undefined : this.views.get(e);
    if (!who || !view) return;
    who.name = name;
    view.name = name;
    this.d.view.playersVersion++;
  }

  remove(e: Entity): void {
    const { world, physics } = this.d;
    const id = this.idOf(e);
    this.d.seats.reset(world, e);
    this.d.throws.cancel(e);
    const ch = world.get(e, Character);
    if (ch) physics.removeCharacter(ch.body);
    world.destroy(e);
    this.views.delete(e);
    this.byId.delete(id);
    this.d.view.removePlayer(e);
    if (this.local === e) this.local = null;
    this.d.events.emit('playerRemoved', { entity: e, id });
  }

  removeAll(): void {
    for (const e of [...this.views.keys()]) this.remove(e);
  }

  /** Interpolated simulation state into every published player view. */
  writeViews(alpha: number): void {
    for (const [e, view] of this.views) writePlayerView(this.d.world, e, view, alpha);
  }
}
