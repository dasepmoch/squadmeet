import type { Simulation } from '@huddle/engine';
import { LIGHT_SCENES, type GameRenderer, type LightScene } from '@huddle/render';
import type { Unsubscribe, Vec3 } from '@huddle/shared';
import { pushToast, type HudStore } from '@huddle/ui';
import type { BoardMode } from './board-mode.ts';
import type { ScreenShare } from './screen-share.ts';
import type { Sfx } from './sfx.ts';

/** Interactable kinds this build supports (the rest of the catalog stays inert). */
export const ENABLED_KINDS = [
  'coffee',
  'water',
  'pizza',
  'whiteboard',
  'present',
  'lights',
  'board',
  /** Landed paper planes (handled inside the simulation). */
  'pickup',
] as const;

export interface RoomActionDeps {
  sim: Simulation;
  renderer: GameRenderer;
  store: HudStore;
  sfx: Sfx;
  board: BoardMode;
  share: ScreenShare;
  setLightScene(scene: LightScene): void;
}

export function isLightScene(v: string): v is LightScene {
  return (LIGHT_SCENES as readonly string[]).includes(v);
}

/** What happens when you click or press E on things in the room. */
export function wireRoomActions(d: RoomActionDeps): Unsubscribe[] {
  const { sim, store, sfx } = d;
  const interactablePos = (id: string): Vec3 | null => {
    const it = sim.interaction.interactable(id);
    return it ? { x: it.position[0], y: it.position[1], z: it.position[2] } : null;
  };
  return [
    sim.events.on('seatDenied', (e) => {
      if (e.isLocal) pushToast(store, 'toast.seatTaken', 'warn');
    }),
    sim.events.on('focusChanged', (e) => {
      if (e.focused) pushToast(store, 'toast.focus');
    }),
    // The wall screen opens Theater Mode (crisp DOM video); without a stream it frames the screen.
    sim.events.on('screenClicked', () => {
      d.share.openTheater();
      if (!d.share.theaterOpen) sim.toggleFocus();
    }),
    sim.events.on('boardClicked', (e) => d.board.enter(e.id)),
    sim.events.on('playerClicked', () => sim.emote('wave')),
    sim.events.on('interact', (e) => {
      switch (e.kind) {
        case 'coffee':
        case 'water':
          // A fresh mug (or cup) in hand and a first sip.
          sim.play.hold(e.kind === 'coffee' ? 'mug' : 'water');
          sim.play.use();
          sfx.play('pour', interactablePos(e.id), 0.7);
          break;
        case 'pizza':
          sim.play.hold('pizza');
          sfx.play('paper', interactablePos(e.id), 0.6);
          break;
        case 'lights': {
          const i = LIGHT_SCENES.indexOf(d.renderer.lightScene);
          d.setLightScene(LIGHT_SCENES[(i + 1) % LIGHT_SCENES.length] ?? 'meeting');
          break;
        }
        case 'whiteboard':
          d.board.enter();
          break;
        case 'present':
          void d.share.toggle();
          break;
        default:
          break;
      }
    }),
  ];
}
