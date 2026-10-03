import { isThrowKind } from '@huddle/engine';
import { DEFAULT_BINDINGS, isBindableCode, randomAvatar, type AvatarSpec } from '@huddle/shared';
import { pushToast, type AvatarPreviewHandle, type HudCommands, type HudStore } from '@huddle/ui';
import { isLightScene } from './room-actions.ts';
import type { RoomFlow } from './room-flow.ts';
import type { Runtime } from './runtime.ts';
import type { UserSettings } from './user-settings.ts';

/** What the HUD commands need from the app (implemented by `GameApp`). */
export interface CommandHost {
  readonly store: HudStore;
  readonly runtime: Runtime | null;
  readonly settings: UserSettings;
  readonly flow: RoomFlow;
  persist(patch: Partial<UserSettings>): void;
  /** Chat: through the server when online (it echoes back), else straight into the room. */
  say(text: string): void;
  setLocale(locale: string): void;
  setLightScene(scene: string): void;
  clearMess(): void;
  openAvatarEditor(open: boolean): void;
  mountAvatarPreview(canvas: HTMLCanvasElement): AvatarPreviewHandle;
  saveAvatar(spec: AvatarSpec, name: string): void;
  /** The green-room panel covers these fractions of the screen (left, bottom). */
  setLobbyInsets(left: number, bottom: number): void;
  retry(): void;
}

/** HUD commands: the only way the React layer changes anything in the app. */
export function createHudCommands(app: CommandHost): HudCommands {
  const rt = (): Runtime | null => app.runtime;
  const store = app.store;
  return {
    setQuality: (choice) => {
      app.persist({ quality: choice });
      rt()?.renderer.setQuality(choice);
      store.setState({ quality: choice });
    },
    setLook: (look) => {
      app.persist({ look });
      rt()?.renderer.setLook(look);
      store.setState({ look });
    },
    setReducedMotion: (on) => {
      app.persist({ reducedMotion: on });
      const r = rt();
      if (r) {
        r.sim.reducedMotion = on;
        r.renderer.fx.reducedMotion = on;
      }
      store.setState({ reducedMotion: on });
    },
    setSfxVolume: (volume) => {
      const v = Math.min(1, Math.max(0, volume));
      app.persist({ sfxVolume: v });
      const r = rt();
      if (r) {
        r.sfx.volume = v;
        r.sfx.play('blip', null, 0.6);
      }
      store.setState({ sfxVolume: v });
    },
    setLocale: (locale) => app.setLocale(locale),
    setDebugOpen: (open) => store.setState({ debugOpen: open }),
    setSettingsOpen: (open) => store.setState({ settingsOpen: open }),
    focusScreen: () => rt()?.sim.toggleFocus(),
    pressAction: (action, pressed) => rt()?.input.pressVirtual(action, pressed),
    captureKey: () => rt()?.input.captureNextCode() ?? Promise.reject(new Error('Input not ready')),
    setBinding: (action, codes) => {
      const bindings = { ...app.settings.bindings, [action]: codes.filter(isBindableCode) };
      app.persist({ bindings });
      rt()?.input.setBindings(bindings);
      store.setState({ bindings });
    },
    resetBindings: () => {
      app.persist({ bindings: DEFAULT_BINDINGS });
      rt()?.input.setBindings(DEFAULT_BINDINGS);
      store.setState({ bindings: DEFAULT_BINDINGS });
    },
    retry: () => app.retry(),
    // A closing chat panel takes its focused input with it, possibly without a blur event.
    setPanel: (panel) =>
      store.setState((s) => ({
        panel,
        popover: null,
        unread: panel === 'chat' ? 0 : s.unread,
        typing: panel === 'chat' ? s.typing : false,
      })),
    setPopover: (popover) => store.setState({ popover }),
    setTyping: (typing) => store.setState({ typing }),
    sendChat: (text) => app.say(text),
    setEmoteWheel: (open) => store.setState({ emoteWheel: open }),
    emote: (id) => rt()?.sim.emote(id),
    react: (emoji) => {
      rt()?.feed.react(emoji);
      rt()?.net.react(emoji);
    },
    raiseHand: () => rt()?.sim.raiseHand(),
    setAim: (kind) => {
      const r = rt();
      if (!r || r.board.boardId) return;
      if (kind !== null && !r.sim.throwsEnabled) {
        pushToast(store, 'toast.throwsOff', 'warn');
        return;
      }
      r.sim.setAim(kind !== null && isThrowKind(kind) ? kind : null);
      store.setState({ aim: r.sim.aim });
    },
    throwAt: (playerId, kind) => {
      const r = rt();
      const target = r?.sim.view.findPlayer(playerId);
      if (r && !r.sim.throwsEnabled) pushToast(store, 'toast.throwsOff', 'warn');
      else if (r && target && isThrowKind(kind)) r.sim.throwAt(kind, target.position, playerId);
    },
    cycleCamera: () => rt()?.sim.cycleCamera(),
    recenterCamera: () => rt()?.sim.recenterCamera(),
    setCameraMode: (mode) => {
      const r = rt();
      if (!r) return;
      r.board.exit();
      r.sim.setCameraView(mode);
    },
    setLightScene: (scene) => {
      if (isLightScene(scene)) app.setLightScene(scene);
    },
    toggleShare: () => {
      void rt()?.share.toggle();
    },
    openTheater: () => rt()?.share.openTheater(),
    closeTheater: () => rt()?.share.closeTheater(),
    setScreenVolume: (volume) => rt()?.voice.setScreenVolume(volume),
    toggleFullscreen: () => rt()?.share.toggleFullscreen(),
    openBoard: () => rt()?.board.enter(),
    closeBoard: () => rt()?.board.exit(),
    setBoardTool: (tool, color) => rt()?.board.setTool(tool, color),
    clearBoard: () => rt()?.board.clear(),
    clearMess: () => app.clearMess(),
    setAvatarOpen: (open) => app.openAvatarEditor(open),
    mountAvatarPreview: (canvas) => app.mountAvatarPreview(canvas),
    saveAvatar: (spec, name) => app.saveAvatar(spec, name),
    randomAvatar: () => randomAvatar(Math.random),
    setLobbyStep: (step, room) => app.flow.setStep(step, room ?? ''),
    previewName: (name) => app.flow.previewName(name),
    setLobbyInsets: (left, bottom) => app.setLobbyInsets(left, bottom),
    joinRoom: (room, name, passcode) => app.flow.join(room, name, passcode),
    playOffline: () => app.flow.playOffline(),
    leaveRoom: () => app.flow.leave(),
    copyInvite: () => app.flow.copyInvite(),
    setRoomMode: (mode) => rt()?.net.host({ op: 'mode', mode }),
    lockThrows: (locked) => rt()?.net.host({ op: 'lockThrows', locked }),
    kick: (target) => rt()?.net.host({ op: 'kick', target }),
    lowerHand: (target) => rt()?.net.host({ op: 'lowerHand', target }),
    makeHost: (target) => rt()?.net.host({ op: 'transfer', target }),
    setVoiceMode: (mode) => rt()?.net.host({ op: 'voiceMode', mode }),
    muteAll: () => {
      rt()?.net.host({ op: 'muteAll' });
      pushToast(store, 'voice.mutedAll');
    },
    stopShare: () => rt()?.net.host({ op: 'stopShare' }),
    toggleMute: () => rt()?.voice.local.toggleMute(),
    toggleDeafen: () => rt()?.voice.local.toggleDeafen(),
    enableMic: () => void rt()?.voice.local.enable(false),
    testEcho: () => void rt()?.voice.local.echoTest(),
    setMicDevice: (id) => void rt()?.voice.local.setDevice(id),
    setOutputDevice: (id) => void rt()?.voice.local.setSpeaker(id),
    setMicProcessing: (p) => void rt()?.voice.local.setProcessing(p),
    setPersonVolume: (playerId, volume) => rt()?.voice.setVolume(playerId, volume),
    setShareHint: (hint) => rt()?.share.setHint(hint),
    answerPresentRequest: (playerId, accept) => rt()?.share.answerRequest(playerId, accept),
    holdItem: (item) => rt()?.play.hold(item),
    useItem: () => rt()?.play.use(),
    setShield: (on) => rt()?.play.setShield(on),
    tiltPlane: (delta) => rt()?.play.tilt(delta),
    setAmbienceVolume: (volume) => {
      const v = Math.min(1, Math.max(0, volume));
      app.persist({ ambienceVolume: v });
      rt()?.soundscape.setAmbience(v);
      store.setState({ ambienceVolume: v });
    },
    resetScores: () => rt()?.play.resetScores(),
  };
}
