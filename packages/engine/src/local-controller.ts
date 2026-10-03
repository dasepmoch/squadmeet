import { actionBit, type InputFrame, type Vec3 } from '@huddle/shared';
import type { CameraRig } from './camera/camera-rig.ts';
import { SeatOccupancy } from './components.ts';
import type { Entity, World } from './ecs/world.ts';
import type { InteractionSystem } from './interaction/interaction-system.ts';
import type { ArriveAction, Navigator } from './nav/navigator.ts';
import type { ThrowKind } from './projectiles/throwables.ts';
import type { SeatSystem } from './seats/seat-system.ts';
import { hasMoveInput } from './systems/local-movement.ts';
import type { HoverView } from './world-view.ts';

const INTERACT = actionBit('interact');
const JUMP = actionBit('jump');
const FOCUS = actionBit('focusScreen');
const BACK = actionBit('back');
const THROW = actionBit('throw');

export interface ControllerHooks {
  onScreenClicked(u: number, v: number): void;
  onInteract(kind: string, id: string): void;
  onFocusChanged(focused: boolean): void;
  /** Throw the aimed item at a point (and the person under the pointer, if any); true if thrown. */
  onThrow(kind: ThrowKind, target: Vec3, targetId: string | null): boolean;
  onPlayerClicked(id: string): void;
  onBoardClicked?(id: string): void;
}

export interface ControllerDeps {
  world: World;
  camera: CameraRig;
  seats: SeatSystem;
  interaction: InteractionSystem;
  nav: Navigator;
  hooks: ControllerHooks;
}

/**
 * Translates local input actions into simulation intents: interact / sit / stand, click-to-move,
 * clicking the screen, boards, people or interactables, throwing while aiming, and camera focus.
 * Runs once per fixed step.
 */
export class LocalController {
  private readonly d: ControllerDeps;
  pathTarget: Vec3 | null = null;
  /**
   * Item being aimed: the next click throws it instead of walking. One throw per pick, so a click
   * meant to walk (or the end of a camera drag) never throws by surprise; a refused throw keeps
   * the pick for another try.
   */
  aim: ThrowKind | null = null;

  constructor(deps: ControllerDeps) {
    this.d = deps;
  }

  step(e: Entity, input: InputFrame, hover: HoverView): void {
    const { world, camera, seats, interaction } = this.d;
    const occ = world.get(e, SeatOccupancy);
    const phase = occ?.phase ?? 'standing';

    if (input.pressed & FOCUS) this.toggleFocus(phase === 'seated' || phase === 'sittingDown');
    if (input.pressed & BACK && camera.mode === 'focus') this.setFocus(false);
    if (camera.mode === 'focus' && hasMoveInput(input)) this.setFocus(false);

    // Aiming: a click (or the throw key) throws at whatever is under the pointer, seated or not.
    if (
      this.aim &&
      (input.clicked || (input.pressed & THROW) !== 0) &&
      phase !== 'sittingDown' &&
      phase !== 'standingUp'
    ) {
      const targetId = hover.kind === 'player' ? hover.id : null;
      if (this.d.hooks.onThrow(this.aim, hover.point, targetId)) this.aim = null;
      return;
    }

    if (phase === 'seated') {
      if ((input.pressed & (INTERACT | JUMP)) !== 0 || hasMoveInput(input))
        seats.requestStand(world, e);
      else if (input.clicked) this.clickSeated(hover);
      return;
    }
    if (phase !== 'standing') return;

    if (input.pressed & INTERACT) {
      const target = interaction.prompt;
      if (target?.kind === 'seat') this.sit(e, target.id);
      else if (target) this.d.hooks.onInteract(target.kind, target.id);
    }
    if (!input.clicked) return;
    switch (hover.kind) {
      case 'seat':
        if (hover.id) this.sit(e, hover.id);
        break;
      case 'screen':
        this.d.hooks.onScreenClicked(interaction.screenUv.u, interaction.screenUv.v);
        break;
      case 'player':
        if (hover.id) this.d.hooks.onPlayerClicked(hover.id);
        break;
      case 'board':
        if (hover.id) this.d.hooks.onBoardClicked?.(hover.id);
        break;
      case 'interactable': {
        const it = hover.id ? interaction.interactable(hover.id) : undefined;
        if (it)
          this.walkTo(
            e,
            { x: it.position[0], y: 0, z: it.position[2] },
            { kind: 'interact', id: it.id },
          );
        break;
      }
      case 'floor':
        this.walkTo(e, hover.point, null);
        break;
      case 'none':
        break;
    }
  }

  /** Sits down, walking to the seat first (A* when the grid is baked, straight line otherwise). */
  sit(e: Entity, seatId: string): void {
    const target = this.d.nav.sit(e, seatId);
    if (target) this.pathTarget = target;
  }

  /** Called when a click-to-move path completes. */
  arrived(e: Entity, action: ArriveAction | null): void {
    this.pathTarget = null;
    const left = this.d.nav.arrived(e, action);
    if (!left) return;
    const it = this.d.interaction.interactable(left.id);
    if (it) this.d.hooks.onInteract(it.kind, it.id);
  }

  walkTo(e: Entity, goal: Vec3, action: ArriveAction | null): boolean {
    const end = this.d.nav.walkTo(e, goal, action);
    if (end) this.pathTarget = end;
    return end !== null;
  }

  toggleFocus(seated: boolean): void {
    const cam = this.d.camera;
    if (seated) {
      cam.setMode(cam.mode === 'seated' ? 'seatedFree' : 'seated');
      return;
    }
    this.setFocus(cam.mode !== 'focus');
  }

  private clickSeated(hover: HoverView): void {
    const { hooks, interaction } = this.d;
    if (hover.kind === 'screen')
      hooks.onScreenClicked(interaction.screenUv.u, interaction.screenUv.v);
    else if (hover.kind === 'player' && hover.id) hooks.onPlayerClicked(hover.id);
    else if (hover.kind === 'board' && hover.id) hooks.onBoardClicked?.(hover.id);
  }

  private setFocus(on: boolean): void {
    const cam = this.d.camera;
    if (on === (cam.mode === 'focus')) return;
    cam.setMode(on ? 'focus' : 'follow');
    this.d.hooks.onFocusChanged(on);
  }
}
