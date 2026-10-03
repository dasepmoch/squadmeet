import {
  PLAYER,
  v3,
  type ResolvedInteractable,
  type ResolvedRoom,
  type Vec3,
} from '@huddle/shared';
import type { CameraPose } from '../camera/camera-rig.ts';
import type { DynamicInteractable } from '../items/held-items.ts';
import type { PhysicsWorld } from '../physics/physics-world.ts';
import type { SeatSystem } from '../seats/seat-system.ts';
import type { HoverView, PlayerView } from '../world-view.ts';
import {
  createRay,
  rayFromCamera,
  rayPerson,
  rayScreen,
  raySphere,
  type ScreenHit,
} from './picking.ts';

export interface PromptView {
  kind: string;
  id: string;
  labelKey: string;
  position: Vec3;
}

const SEAT_PICK_RADIUS = 0.42;
const SEAT_PROMPT_RANGE = 1.5;

/**
 * Hover picking (pointer ray vs seats, interactables, the screen and the floor) and the
 * proximity prompt ("E to sit"). Only kinds enabled by the host are interactive, so features
 * from later phases degrade gracefully instead of showing dead prompts.
 */
export class InteractionSystem {
  readonly enabledKinds = new Set<string>(['seat']);
  prompt: PromptView | null = null;
  /** Movable things to interact with (landed paper planes), provided by the host systems. */
  dynamic: () => readonly DynamicInteractable[] = () => [];
  private readonly anchor = v3.vec3();
  private readonly room: ResolvedRoom;
  private readonly physics: PhysicsWorld;
  private readonly seats: SeatSystem;
  private readonly ray = createRay();
  private readonly screenHit: ScreenHit = { distance: 0, u: 0, v: 0 };
  private readonly boardHit: ScreenHit = { distance: 0, u: 0, v: 0 };
  private readonly tmp = v3.vec3();
  private readonly approach = v3.vec3();
  private readonly promptPool: PromptView = { kind: '', id: '', labelKey: '', position: v3.vec3() };

  constructor(room: ResolvedRoom, physics: PhysicsWorld, seats: SeatSystem) {
    this.room = room;
    this.physics = physics;
    this.seats = seats;
  }

  /** Last screen hit in normalized coordinates (valid when hover.kind === 'screen'). */
  get screenUv(): ScreenHit {
    return this.screenHit;
  }

  /**
   * What is under the pointer. While aiming (`aiming`), protected people are see-through: a throw
   * at them aims at whatever is behind instead.
   */
  updateHover(
    hover: HoverView,
    pose: CameraPose,
    aspect: number,
    pointer: { x: number; y: number; active: boolean },
    selfId: string,
    players: readonly PlayerView[] = [],
    aiming = false,
  ): void {
    hover.kind = 'none';
    hover.id = null;
    hover.anchor = null;
    if (!pointer.active) return;
    const ray = rayFromCamera(this.ray, pose, aspect, pointer.x, pointer.y);
    const staticHit = this.physics.raycastStaticWithNormal(ray.origin, ray.dir, 60);
    const wall = staticHit ? staticHit.distance : Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const p of players) {
      if (p.id === selfId || (aiming && p.shield)) continue;
      const t = rayPerson(ray, p.position, p.seatId !== null);
      if (t < best && t <= wall + 0.3) {
        best = t;
        hover.kind = 'player';
        hover.id = p.id;
      }
    }
    if (this.enabledKinds.has('board')) {
      for (const b of this.room.boards) {
        if (
          !rayScreen(ray, b, this.boardHit) ||
          this.boardHit.distance >= best ||
          this.boardHit.distance > wall + 0.1
        )
          continue;
        best = this.boardHit.distance;
        hover.kind = 'board';
        hover.id = b.id;
        hover.u = this.boardHit.u;
        hover.v = this.boardHit.v;
      }
    }

    if (this.enabledKinds.has('seat')) {
      for (const seat of this.room.seats) {
        if (!this.seats.isFree(seat.id, selfId)) continue;
        this.tmp.x = seat.position[0];
        this.tmp.y = seat.position[1] + 0.18;
        this.tmp.z = seat.position[2];
        const t = raySphere(ray, this.tmp, SEAT_PICK_RADIUS);
        if (t < best && t <= wall + 0.6) {
          best = t;
          hover.kind = 'seat';
          hover.id = seat.id;
        }
      }
    }
    for (const it of this.room.interactables) {
      if (!this.enabledKinds.has(it.kind)) continue;
      v3.fromTuple(it.position, this.tmp);
      const t = raySphere(ray, this.tmp, Math.min(0.7, it.radius));
      if (t < best && t <= wall + 0.4) {
        best = t;
        hover.kind = 'interactable';
        hover.id = it.id;
      }
    }
    for (const it of this.dynamic()) {
      if (!this.enabledKinds.has(it.kind)) continue;
      const t = raySphere(ray, it.position, 0.25);
      if (t < best && t <= wall + 0.3) {
        best = t;
        hover.kind = 'interactable';
        hover.id = it.id;
        hover.anchor = v3.copy(this.anchor, it.position);
      }
    }
    if (rayScreen(ray, this.room.screen, this.screenHit) && this.screenHit.distance < best) {
      if (this.screenHit.distance <= wall + 0.2) {
        best = this.screenHit.distance;
        hover.kind = 'screen';
        hover.id = 'main';
      }
    }
    if (hover.kind === 'none' && staticHit && staticHit.normal.y > 0.7) {
      hover.kind = 'floor';
      hover.id = null;
      best = staticHit.distance;
    }
    // Even with nothing interactive under the pointer, keep a point to aim throws at.
    if (hover.kind === 'none') best = Math.min(wall, 8);
    v3.addScaled(hover.point, ray.origin, ray.dir, best);
  }

  /** Picks the best proximity target in front of the player. */
  updatePrompt(position: Vec3, yaw: number, seated: boolean, selfId: string): PromptView | null {
    const p = this.promptPool;
    if (seated) {
      p.kind = 'stand';
      p.id = 'stand';
      p.labelKey = 'interact.stand';
      v3.copy(p.position, position);
      this.prompt = p;
      return p;
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    let bestScore = Number.POSITIVE_INFINITY;
    let found = false;
    const consider = (
      kind: string,
      id: string,
      labelKey: string,
      x: number,
      y: number,
      z: number,
      range: number,
    ): void => {
      const dx = x - position.x;
      const dz = z - position.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const facing = d < 1e-3 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < -0.35) return;
      const score = d * (1.4 - facing * 0.4);
      if (score >= bestScore) return;
      bestScore = score;
      found = true;
      p.kind = kind;
      p.id = id;
      p.labelKey = labelKey;
      p.position.x = x;
      p.position.y = y;
      p.position.z = z;
    };
    if (this.enabledKinds.has('seat')) {
      for (const seat of this.room.seats) {
        if (!this.seats.isFree(seat.id, selfId)) continue;
        const a = this.seats.approachPoint(seat, this.approach);
        if (Math.abs(a.y - position.y) > 0.5) continue;
        consider(
          'seat',
          seat.id,
          'interact.sit',
          seat.position[0],
          seat.position[1],
          seat.position[2],
          SEAT_PROMPT_RANGE,
        );
      }
    }
    for (const it of this.room.interactables) {
      if (!this.enabledKinds.has(it.kind)) continue;
      consider(
        it.kind,
        it.id,
        it.promptKey ?? `interact.${it.kind}`,
        it.position[0],
        it.position[1],
        it.position[2],
        Math.min(it.radius, PLAYER.interactRange + 0.6),
      );
    }
    for (const it of this.dynamic()) {
      if (!this.enabledKinds.has(it.kind)) continue;
      const q = it.position;
      consider(it.kind, it.id, it.labelKey, q.x, q.y, q.z, it.radius);
    }
    this.prompt = found ? p : null;
    return this.prompt;
  }

  /** A room interactable, or a movable one (as of now) by id. */
  interactable(id: string): ResolvedInteractable | undefined {
    const fixed = this.room.interactables.find((i) => i.id === id);
    if (fixed) return fixed;
    const it = this.dynamic().find((d) => d.id === id);
    if (!it) return undefined;
    return {
      id: it.id,
      kind: it.kind,
      propId: '',
      position: [it.position.x, it.position.y, it.position.z],
      radius: it.radius,
      yaw: 0,
      promptKey: it.labelKey,
    };
  }
}
