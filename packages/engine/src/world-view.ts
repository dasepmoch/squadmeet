import { v3, type HeldItem, type Posture, type ResolvedRoom, type Vec3 } from '@huddle/shared';
import type { CameraMode } from './camera/camera-rig.ts';
import type { Entity } from './ecs/world.ts';
import type { PromptView } from './interaction/interaction-system.ts';
import type { ProjectileView } from './projectiles/projectile-system.ts';
import type { ThrowKind } from './projectiles/throwables.ts';

/** Render-facing state for one avatar. Mutated in place every frame; never reallocated. */
export interface PlayerView {
  readonly id: string;
  readonly entity: Entity;
  readonly isLocal: boolean;
  name: string;
  position: Vec3;
  yaw: number;
  /** Smoothed horizontal speed in m/s (drives locomotion blend). */
  speed: number;
  verticalVelocity: number;
  grounded: boolean;
  seatId: string | null;
  posture: Posture | null;
  /** 0 standing .. 1 seated, eased during transitions. */
  sitBlend: number;
  /** Distance travelled, used to phase the walk cycle without foot sliding. */
  stride: number;
  readonly isBot: boolean;
  /** Hand raised to speak; `handRaisedAt` orders the queue (simulation time). */
  handRaised: boolean;
  handRaisedAt: number;
  /** Latest upper-body action (emote, throw, flinch); a new `actionSeq` restarts it. */
  action: string | null;
  actionSeq: number;
  /** What is in hand. */
  held: HeldItem | null;
  /** "Don't hit me" is on: things pass through with a ghost shimmer. */
  shield: boolean;
}

/** Aiming preview of the local player (the dotted throw arc). */
export interface AimView {
  kind: ThrowKind;
  /** Release point at the thrower's hand. */
  from: Vec3;
  /** Landing point, already clamped to the throw range. */
  to: Vec3;
  /** Person under the pointer, if any. */
  targetId: string | null;
  /** The landing point lies on an upward-facing surface (floor, table top). */
  flat: boolean;
  /** Paper-plane release tilt, -1..1 (the arc curves). */
  tilt: number;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;
  fov: number;
  mode: CameraMode;
}

export type HoverKind = 'none' | 'seat' | 'screen' | 'interactable' | 'floor' | 'player' | 'board';

export interface HoverView {
  kind: HoverKind;
  id: string | null;
  /** Point under the pointer (for `none`: where the ray meets a wall, or 8 m out). */
  point: Vec3;
  /** Board-local coordinates in [0, 1] (origin bottom-left) when `kind` is `board`. */
  u: number;
  v: number;
  /** Where a hovered movable interactable is (a landed paper plane), else null. */
  anchor: Vec3 | null;
}

export function createPlayerView(
  id: string,
  entity: Entity,
  isLocal: boolean,
  name: string,
  isBot = false,
): PlayerView {
  return {
    id,
    entity,
    isLocal,
    name,
    position: v3.vec3(),
    yaw: 0,
    speed: 0,
    verticalVelocity: 0,
    grounded: true,
    seatId: null,
    posture: null,
    sitBlend: 0,
    stride: 0,
    isBot,
    handRaised: false,
    handRaisedAt: 0,
    action: null,
    actionSeq: 0,
    held: null,
    shield: false,
  };
}

/**
 * Read-only facade the renderer consumes. The engine owns and mutates it; the renderer and UI
 * only read. `playersVersion` bumps whenever the player list changes structurally.
 */
export class WorldView {
  readonly room: ResolvedRoom;
  readonly players: PlayerView[] = [];
  playersVersion = 0;
  localPlayer: PlayerView | null = null;
  readonly camera: CameraView = {
    position: v3.vec3(0, 2, 5),
    target: v3.vec3(0, 1.4, 0),
    fov: 60,
    mode: 'follow',
  };
  readonly hover: HoverView = {
    kind: 'none',
    id: null,
    point: v3.vec3(),
    u: 0,
    v: 0,
    anchor: null,
  };
  /** Thrown objects in flight or resting (owned by the projectile system). */
  projectiles: readonly ProjectileView[] = [];
  projectilesVersion = 0;
  /** Throw preview while the local player aims, else null. */
  aim: AimView | null = null;
  /** Proximity interaction target of the local player ("E to sit"). */
  prompt: PromptView | null = null;
  /** Destination of the active click-to-move path. */
  pathTarget: Vec3 | null = null;
  /** Simulation time in seconds. */
  time = 0;
  /** Render-interpolation factor of the last frame. */
  alpha = 0;

  constructor(room: ResolvedRoom) {
    this.room = room;
  }

  addPlayer(view: PlayerView): void {
    this.players.push(view);
    if (view.isLocal) this.localPlayer = view;
    this.playersVersion++;
  }

  removePlayer(entity: Entity): void {
    const i = this.players.findIndex((p) => p.entity === entity);
    if (i < 0) return;
    const [removed] = this.players.splice(i, 1);
    if (removed && removed === this.localPlayer) this.localPlayer = null;
    this.playersVersion++;
  }

  findPlayer(id: string): PlayerView | undefined {
    return this.players.find((p) => p.id === id);
  }
}
