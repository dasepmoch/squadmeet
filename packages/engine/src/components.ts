import type { HeldItem, Posture, Vec3 } from '@huddle/shared';
import { defineComponent } from './ecs/world.ts';
import type { CharacterBody } from './physics/physics-world.ts';

/** Authoritative simulation transform plus the previous step for render interpolation. */
export interface Transform {
  position: Vec3;
  yaw: number;
  prevPosition: Vec3;
  prevYaw: number;
}

export interface Motion {
  velocity: Vec3;
  grounded: boolean;
  sprinting: boolean;
  /** Seconds since the character left the ground (coyote time). */
  airTime: number;
  /** Horizontal speed, smoothed for animation. */
  speed: number;
}

export interface Character {
  body: CharacterBody;
}

export interface PlayerIdentity {
  id: string;
  name: string;
  isLocal: boolean;
}

export type SeatPhase = 'standing' | 'sittingDown' | 'seated' | 'standingUp';

export interface SeatOccupancy {
  seatId: string | null;
  phase: SeatPhase;
  /** 0 = standing, 1 = fully seated. Animated during transitions. */
  blend: number;
  posture: Posture | null;
  /** Where the avatar stood before sitting, to stand back up to. */
  standPosition: Vec3;
  standYaw: number;
}

/**
 * Social expression: a raised hand, the current upper-body action (emote, throw, flinch), what is
 * in hand, and the "Don't hit me" protection.
 */
export interface Expression {
  handRaised: boolean;
  /** Simulation time the hand went up (orders the speaking queue). */
  handRaisedAt: number;
  action: string | null;
  /** Bumps for every started action so renderers restart a repeated emote. */
  actionSeq: number;
  held: HeldItem | null;
  /** Thrown things pass through (and this person does not throw). */
  shield: boolean;
}

/** A player driven by the network: the host writes the interpolated pose every frame. */
export interface Remote {
  target: Vec3;
  yaw: number;
  speed: number;
  grounded: boolean;
}

/** Path following for click-to-move. */
export interface PathFollow {
  points: Vec3[];
  index: number;
  /** Interactable to trigger on arrival (e.g. a seat that was clicked from afar). */
  arriveAction: { kind: 'seat' | 'interact'; id: string } | null;
}

export const Transform = defineComponent<Transform>('Transform');
export const Motion = defineComponent<Motion>('Motion');
export const Character = defineComponent<Character>('Character');
export const PlayerIdentity = defineComponent<PlayerIdentity>('PlayerIdentity');
export const LocalPlayer = defineComponent<true>('LocalPlayer');
export const SeatOccupancy = defineComponent<SeatOccupancy>('SeatOccupancy');
export const PathFollow = defineComponent<PathFollow>('PathFollow');
export const Expression = defineComponent<Expression>('Expression');
export const Remote = defineComponent<Remote>('Remote');
