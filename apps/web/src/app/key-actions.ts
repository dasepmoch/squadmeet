import { THROW_KINDS } from '@huddle/engine';
import type { ActionName, Unsubscribe } from '@huddle/shared';
import { pushToast, type HudStore } from '@huddle/ui';
import type { Runtime } from './runtime.ts';

const SLOTS: readonly ActionName[] = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];

export interface KeyHost {
  readonly store: HudStore;
  /** Esc: closes the topmost thing (popover, modal, theater, board, wheel, aim, panel). */
  back(): void;
}

export interface BackHost {
  readonly store: HudStore;
  readonly runtime: Runtime | null;
  readonly flow: { setStep(step: 'start' | 'ready', room: string): void };
  openAvatarEditor(open: boolean): void;
}

/**
 * Esc: leaves a text field, else closes the topmost thing (popover, modal, theater, board, wheel,
 * aim, panel), and in the green room goes back to the landing.
 */
export function closeTopmost(host: BackHost): void {
  const store = host.store;
  const s = store.getState();
  const rt = host.runtime;
  if (s.typing) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    store.setState({ typing: false });
    return;
  }
  if (s.popover) store.setState({ popover: null });
  else if (s.avatarOpen) host.openAvatarEditor(false);
  else if (s.settingsOpen) store.setState({ settingsOpen: false });
  else if (rt?.share.theaterOpen) rt.share.closeTheater();
  else if (rt?.board.boardId) rt.board.exit();
  else if (s.emoteWheel) store.setState({ emoteWheel: false });
  else if (rt?.sim.aim) {
    rt.sim.setAim(null);
    store.setState({ aim: null });
  } else if (s.panel) store.setState({ panel: null });
  else if (s.lobby?.step === 'ready') host.flow.setStep('start', '');
}

/**
 * The throw key with nothing aimed: a paper plane in hand gets ready to fly (the same press
 * throws it), otherwise the Play menu opens to pick something. Nothing is ever thrown that you
 * did not pick.
 */
function throwKey(rt: Runtime, store: HudStore): void {
  const { sim } = rt;
  if (sim.play.held === 'plane') {
    sim.setAim('plane');
    store.setState({ aim: sim.aim, popover: null });
    return;
  }
  store.setState((s) => ({ popover: s.popover === 'play' ? null : 'play' }));
}

/**
 * Voice keys work in online rooms and in the green room (M there decides whether you join with
 * the mic on); offline they explain that once.
 */
function voiceKey(
  rt: Runtime,
  store: HudStore,
  hinted: { done: boolean },
  run: () => void,
  greenRoom = true,
): void {
  const lobby = store.getState().lobby;
  if (rt.net.online || (greenRoom && lobby?.step === 'ready')) {
    run();
    return;
  }
  if (lobby) return;
  if (!hinted.done) pushToast(store, 'voice.offline');
  hinted.done = true;
}

/** Instant (non-simulation) key actions: HUD toggles, voice, throw slots, quick throw. */
export function wireKeyActions(rt: Runtime, host: KeyHost): Unsubscribe {
  const hinted = { done: false };
  const local = rt.voice.local;
  return rt.input.onAction((e) => {
    // Push-to-talk needs the release too (also sent when the window loses focus).
    if (e.action === 'pushToTalk') {
      if (!e.pressed) local.setPushToTalk(false);
      else voiceKey(rt, host.store, hinted, () => local.setPushToTalk(true));
      return;
    }
    if (!e.pressed) return;
    const store = host.store;
    const s = store.getState();
    switch (e.action) {
      case 'debug':
        store.setState({ debugOpen: !s.debugOpen });
        return;
      case 'back':
        host.back();
        return;
      case 'emoteWheel':
        store.setState({ emoteWheel: !s.emoteWheel });
        return;
      case 'raiseHand':
        rt.sim.raiseHand();
        return;
      case 'useItem':
        if (rt.board.boardId === null) rt.play.use();
        return;
      case 'chat':
        store.setState({ panel: 'chat', unread: 0, chatFocus: s.chatFocus + 1 });
        return;
      case 'theater':
        if (rt.share.theaterOpen) rt.share.closeTheater();
        else if (!s.lobby) rt.share.openTheater();
        return;
      case 'throw':
        if (!rt.sim.throwsEnabled) pushToast(store, 'toast.throwsOff', 'warn');
        else if (rt.sim.aim === null && rt.board.boardId === null) throwKey(rt, store);
        return;
      case 'mute':
        voiceKey(rt, store, hinted, () => local.toggleMute());
        return;
      case 'deafen':
        voiceKey(rt, store, hinted, () => local.toggleDeafen(), false);
        return;
      default: {
        const slot = SLOTS.indexOf(e.action);
        const kind = THROW_KINDS[slot];
        if (slot < 0 || !kind || rt.board.boardId !== null) return;
        if (!rt.sim.throwsEnabled) {
          pushToast(store, 'toast.throwsOff', 'warn');
          return;
        }
        rt.sim.setAim(rt.sim.aim === kind ? null : kind);
        store.setState({ aim: rt.sim.aim, popover: null });
      }
    }
  });
}
