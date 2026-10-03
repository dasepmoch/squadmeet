import { SimDriver, type Simulation, type SwitchableSeatArbiter } from '@huddle/engine';
import { RealtimeClient } from '@huddle/net';
import type { InputSource, PlatformServices } from '@huddle/platform';
import type { GameRenderer, LightScene } from '@huddle/render';
import type { Logger } from '@huddle/shared';
import { WorldLabels, type HudStore, type Translate } from '@huddle/ui';
import { BoardMode } from './board-mode.ts';
import { HudBridge, type Presence } from './hud-bridge.ts';
import type { VoicePrefs } from './local-voice.ts';
import { NetSession } from './net-session.ts';
import { PlayfulSession } from './playful-session.ts';
import { ScreenShare } from './screen-share.ts';
import { Sfx } from './sfx.ts';
import { SocialFeed } from './social-feed.ts';
import { Soundscape } from './soundscape.ts';
import type { UserSettings } from './user-settings.ts';
import { VoiceSession } from './voice-session.ts';

/** Everything that exists once the room is loaded. */
export interface Runtime {
  sim: Simulation;
  driver: SimDriver;
  renderer: GameRenderer;
  input: InputSource;
  labels: WorldLabels;
  sfx: Sfx;
  board: BoardMode;
  share: ScreenShare;
  feed: SocialFeed;
  bridge: HudBridge;
  net: NetSession;
  voice: VoiceSession;
  /** Scores, held items, "Don't hit me", clean-ups, Party mode. */
  play: PlayfulSession;
  /** Footsteps, room tone, HUD clicks. */
  soundscape: Soundscape;
  /** Away, host, mute and speaking state for the people panel. */
  presence: Presence;
}

export interface RuntimeDeps {
  platform: PlatformServices;
  sim: Simulation;
  renderer: GameRenderer;
  canvas: HTMLCanvasElement;
  /** HUD root; world labels are inserted right before it so the HUD stays on top. */
  uiRoot: HTMLElement;
  store: HudStore;
  log: Logger;
  settings: UserSettings;
  t: () => Translate;
  /** Puts the default content back on the wall when a share ends. */
  restoreScreen: () => void;
  /** Stream shown in Theater Mode while nobody shares (the demo deck). */
  fallbackStream: () => MediaStream | null;
  /** Realtime endpoint, e.g. `wss://host/ws`. */
  serverUrl: string;
  /** The simulation's seat arbiter (switched to the server's while online). */
  arbiter: SwitchableSeatArbiter;
  setAvatar: (playerId: string, encoded: string) => void;
  localAvatar: () => string;
  onJoined: (code: string) => void;
  /** Current voice preferences and how to save settings. */
  voicePrefs: () => VoicePrefs;
  persist: (patch: Partial<UserSettings>) => void;
  /** Changes the room lights (and tells the HUD). */
  setLightScene: (scene: LightScene) => void;
}

/** Creates the per-room services: input, labels, sound, voice, sharing, feed, HUD bridge. */
export function createRuntime(d: RuntimeDeps): Runtime {
  const input = d.platform.input.create(d.canvas);
  input.setBindings(d.settings.bindings);
  const host = d.uiRoot.parentElement;
  const labels = host ? new WorldLabels(host, d.uiRoot) : new WorldLabels(d.uiRoot);
  const sfx = new Sfx(d.platform.audio);
  sfx.volume = d.settings.sfxVolume;
  const client = new RealtimeClient({
    url: d.serverUrl,
    sockets: d.platform.sockets,
    clock: d.platform.clock,
    logger: d.log.child('net'),
    random: Math.random,
  });
  const net = new NetSession({
    client,
    sim: d.sim,
    arbiter: d.arbiter,
    store: d.store,
    labels,
    sfx,
    t: d.t,
    setAvatar: d.setAvatar,
    localAvatar: d.localAvatar,
    onJoined: d.onJoined,
  });
  const voice = new VoiceSession({
    client,
    sim: d.sim,
    platform: d.platform,
    store: d.store,
    labels,
    log: d.log.child('voice'),
    headOf: (id) => d.renderer.avatars.anchorOf(id) ?? null,
    prefs: d.voicePrefs,
    persist: d.persist,
  });
  const share = new ScreenShare({
    platform: d.platform,
    renderer: d.renderer,
    sim: d.sim,
    store: d.store,
    log: d.log.child('share'),
    t: d.t,
    client,
    voice,
    online: () => net.online,
    restore: d.restoreScreen,
    fallbackStream: d.fallbackStream,
  });
  const play = new PlayfulSession({
    client,
    net,
    sim: d.sim,
    renderer: d.renderer,
    store: d.store,
    labels,
    sfx,
    t: d.t,
    setLightScene: d.setLightScene,
    persistShield: (on) => d.persist({ dontHitMe: on }),
  });
  const presence: Presence = {
    get version() {
      return (net.version * 4099 + voice.version * 31 + play.version) | 0;
    },
    isAway: (id) => net.isAway(id),
    isHost: (id) => net.isHost(id),
    isMuted: (id) => voice.isMuted(id),
    isSpeaking: (id) => voice.isSpeaking(id),
    levelOf: (id) => voice.talkLevel(id),
    volumeOf: (id) => voice.volumeOf(id),
    pointsOf: (id) => play.pointsOf(id),
  };
  return {
    sim: d.sim,
    driver: new SimDriver(d.sim),
    renderer: d.renderer,
    input,
    labels,
    sfx,
    board: new BoardMode(d.sim, d.renderer, input, d.store),
    share,
    feed: new SocialFeed({
      sim: d.sim,
      renderer: d.renderer,
      store: d.store,
      labels,
      sfx,
      t: d.t,
    }),
    bridge: new HudBridge(d.store, d.uiRoot, d.canvas, labels),
    net,
    voice,
    play,
    soundscape: new Soundscape(sfx, d.settings.ambienceVolume),
    presence,
  };
}
