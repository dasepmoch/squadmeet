import { v3 } from '@huddle/shared';
import type { AimView, HoverView, PlayerView, WorldView } from '../world-view.ts';
import { aimPoint, throwOrigin } from './throw-system.ts';
import { clampThrowTarget, type ThrowKind } from './throwables.ts';

/** The dotted throw preview: from the local hand to the person or point under the pointer. */
export class AimPreview {
  private readonly aim: AimView = {
    kind: 'paper',
    from: v3.vec3(),
    to: v3.vec3(),
    targetId: null,
    flat: false,
    tilt: 0,
  };
  private readonly target = v3.vec3();

  /** The preview for this frame, or null when not aiming (or the pointer is off the canvas). */
  update(
    kind: ThrowKind | null,
    local: PlayerView | null,
    view: WorldView,
    tilt = 0,
  ): AimView | null {
    if (!kind || !local) return null;
    const hover: HoverView = view.hover;
    const person = hover.kind === 'player' && hover.id ? view.findPlayer(hover.id) : undefined;
    const target = this.target;
    if (person) aimPoint(person.position, person.sitBlend > 0.5, target);
    else v3.copy(target, hover.point);
    const a = this.aim;
    a.kind = kind;
    a.targetId = person ? person.id : null;
    a.flat = !person && (hover.kind === 'floor' || hover.kind === 'seat');
    a.tilt = kind === 'plane' ? tilt : 0;
    throwOrigin(local.position, local.sitBlend > 0.5, target, a.from);
    clampThrowTarget(a.from, target, a.to);
    return a;
  }
}
