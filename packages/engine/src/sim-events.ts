import type { HeldItem, ResolvedRoom, Vec3 } from '@huddle/shared';
import type { Entity } from './ecs/world.ts';
import type { PhysicsWorld } from './physics/physics-world.ts';
import type { ProjectileEvent } from './projectiles/projectile-system.ts';
import type { ThrowLaunch, ThrowRefusal } from './projectiles/throw-system.ts';
import type { SeatArbiter } from './seats/seat-arbiter.ts';

export interface SeatEvent {
  playerId: string;
  seatId: string;
  isLocal: boolean;
}

/** Everything the simulation tells its host about (sounds, HUD, network relay). */
export interface SimEvents {
  playerSpawned: { entity: Entity; id: string; isLocal: boolean; isBot: boolean };
  playerRemoved: { entity: Entity; id: string };
  pathArrived: { entity: Entity };
  sat: SeatEvent;
  stood: SeatEvent;
  seatDenied: SeatEvent;
  screenClicked: { u: number; v: number };
  interact: { kind: string; id: string };
  focusChanged: { focused: boolean };
  playerClicked: { id: string };
  boardClicked: { id: string; u: number; v: number };
  /** A throw left someone's hand. */
  thrown: ThrowLaunch;
  /** Hits, splats, bursts and bounces of thrown objects. */
  projectile: ProjectileEvent;
  handRaised: { playerId: string; raised: boolean };
  /** An upper-body action started (emote, throw, flinch). Reactions are derived, not chosen. */
  action: { playerId: string; id: string; reaction: boolean };
  /** A bot says one of the canned remarks (`bot.line.<line>`). */
  botSay: { playerId: string; line: number };
  /** Someone's hands changed: picked something up, put it away, finished the pizza. */
  held: { playerId: string; item: HeldItem | null };
  /** "Don't hit me" was switched on or off. */
  shield: { playerId: string; on: boolean };
  /** Someone picked up a landed paper plane (`throwerId`'s throw number `seq`). */
  pickedUp: { playerId: string; throwerId: string; seq: number };
  /** The local player's throw was refused (cooldown, too much in the air, protection). */
  throwRefused: { reason: ThrowRefusal };
}

export interface BotSpawnOptions {
  /** Start at this seat and sit down right away. */
  seatId?: string;
  /** Start near this room spawn point (default 0). */
  spawnIndex?: number;
  /** Exact start (tests, scripted scenes); wins over the other options. */
  at?: { position: Vec3; yaw: number };
}

export interface SimulationOptions {
  room: ResolvedRoom;
  physics: PhysicsWorld;
  /** Local player id used for seat arbitration. */
  selfId?: string;
  seatArbiter?: SeatArbiter;
}
