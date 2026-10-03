import { isThrowKind, type CameraMode } from '@huddle/engine';
import type { LightScene } from '@huddle/render';
import { DEFAULT_AVATAR, encodeAvatar, type AvatarSpec } from '@huddle/shared';
import type { GameApp } from './game-app.ts';
import type { ScreenShare } from './screen-share.ts';
import type { VoiceDebug } from './voice-session.ts';

export interface HuddleDebugApi {
  ready: boolean;
  seats(): string[];
  sit(seatId: string): void;
  stand(): void;
  teleport(x: number, z: number, yaw: number): void;
  camera(mode: CameraMode): void;
  look(yaw: number, pitch: number, distance: number): void;
  quality(level: 'auto' | 'low' | 'medium' | 'high' | 'ultra'): void;
  screen(mode: 'idle' | 'selfShare'): void;
  lights(scene: LightScene): void;
  emote(id: string): void;
  /** Fixed camera pose for photos: position, target, vertical FOV (degrees). */
  photo(position: [number, number, number], target: [number, number, number], fov: number): void;
  /** True once the local avatar's sculpted mesh is on screen. */
  avatarReady(): boolean;
  /** Number of avatars whose sculpted mesh is on screen. */
  avatarsReady(): number;
  /**
   * Patches the local avatar spec (on top of the default one when `fresh`); returns the new spec
   * key (compare with `avatarKey`).
   */
  avatar(patch: Partial<AvatarSpec>, fresh?: boolean): string;
  /** Spec key of the local avatar mesh currently on screen. */
  avatarKey(): string | null;
  stats(): Record<string, number | string>;
  /** Current pointer hover target and proximity prompt. */
  hover(): { kind: string; id: string | null; prompt: string | null };
  /** Visibility and world position of a named scene object and its direct children. */
  inspect(name: string): { name: string; visible: boolean; position: number[] }[];
  /** Everyone in the room. */
  players(): {
    id: string;
    name: string;
    bot: boolean;
    seat: string | null;
    hand: boolean;
    x: number;
    z: number;
  }[];
  /** Local throw at a point, or at a person when `targetId` is given. */
  throw(kind: string, x: number, y: number, z: number, targetId?: string): boolean;
  /** Selects (or clears) the aimed throwable. */
  aim(kind: string | null): void;
  hand(raised?: boolean): void;
  chat(text: string): void;
  board(open: boolean): void;
  theater(open: boolean): void;
  /** Live projectiles and particles. */
  fx(): { projectiles: number; particles: number; decals: number };
  /** Joins an online room from the lobby ('' creates one). */
  join(room: string, name: string, passcode?: string): void;
  /** Skips the lobby: offline with AI office-mates. */
  offline(): void;
  /** Connection state, own server id, room code and round trip. */
  net(): { state: string; self: string | null; room: string | null; rtt: number; people: number };
  /** Microphone, mute state, media peers and what we hear from each of them. */
  voice(): Promise<VoiceDebug | null>;
  /** Unmutes (asking for the microphone first) or mutes. */
  talk(on: boolean): Promise<void>;
  /** Shares an animated test pattern (a canvas stream, optionally with a tone) instead of a capture. */
  shareTest(withAudio?: boolean): void;
  shareStop(): void;
  /** Who presents and what the wall shows. */
  share(): ReturnType<ScreenShare['describe']> | null;
  /** Puts something in the local hand (null: empty hands), and uses it. */
  hold(item: string | null): void;
  use(): void;
  /** "Don't hit me" on or off. */
  shield(on: boolean): void;
  /** Hoop points by player id. */
  scores(): Record<string, number>;
  /** Throws a paper ball at the first hoop's rim from where you stand. */
  shootHoop(): boolean;
  /** The broom (host-only online). */
  clean(): void;
  /** Your hands, protection and plane tilt; splats stuck on people. */
  play(): { held: string | null; shield: boolean; tilt: number; splats: number };
  /** Party effects (trails, confetti) without a room mode, for probes. */
  party(on: boolean): void;
  /** Paper-plane tilt for the next throw, -1..1. */
  tilt(value: number): void;
}

declare global {
  interface Window {
    __huddle?: HuddleDebugApi;
    /** Raw app handle for ad-hoc console debugging (debug builds only). */
    __huddleApp?: unknown;
  }
}

/** A quiet 440 Hz tone as a track (the "system audio" of the test pattern). */
function testTone(app: GameApp): MediaStreamTrack | null {
  const ctx = app.platform.audio.get();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const out = ctx.createMediaStreamDestination();
  osc.frequency.value = 440;
  gain.gain.value = 0.25;
  osc.connect(gain).connect(out);
  osc.start();
  const track = out.stream.getAudioTracks()[0] ?? null;
  track?.addEventListener('ended', () => osc.stop(), { once: true });
  return track;
}

/** Animated test pattern for screen sharing without a capture picker (tests, demos). */
function testPattern(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(15);
  let n = 0;
  const draw = (): void => {
    if (stream.getVideoTracks()[0]?.readyState === 'ended') {
      window.clearInterval(timer);
      return;
    }
    if (!ctx) return;
    n++;
    ctx.fillStyle = `hsl(${(n * 4) % 360} 70% 45%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText(`Shared ${n}`, 60, 210);
  };
  const timer = window.setInterval(draw, 66);
  draw();
  return stream;
}

/**
 * Deterministic hooks for Playwright visual tests and the self-critique screenshots.
 * Only installed in dev builds or with `?debug=1`.
 */
export function installDebugHooks(app: GameApp): void {
  const params = new URLSearchParams(window.location.search);
  if (!import.meta.env.DEV && params.get('debug') !== '1') return;
  const api: HuddleDebugApi = {
    ready: true,
    seats: () => app.sim?.room.seats.map((s) => s.id) ?? [],
    sit: (seatId) => app.sim?.requestSit(seatId),
    stand: () => app.sim?.requestStand(),
    teleport: (x, z, yaw) => app.sim?.teleport(x, 0, z, yaw),
    camera: (mode) => {
      app.lookOverride = null;
      app.sim?.camera.setMode(mode, true);
    },
    look: (yaw, pitch, distance) => {
      const cam = app.sim?.camera;
      if (!cam) return;
      cam.yaw = yaw;
      cam.pitch = pitch;
      cam.distance = distance;
    },
    quality: (level) => app.renderer?.setQuality(level),
    screen: (mode) => {
      const s = app.renderer?.screen;
      if (mode === 'idle') s?.showIdle();
      else s?.showSelfShare('You are sharing', 'Everyone sees your screen here');
    },
    lights: (scene) => app.renderer?.setLightScene(scene, true),
    emote: (id) => app.sim?.emote(id),
    photo: (position, target, fov) => {
      // Subjects look straight ahead in photos so every angle shows the same pose.
      app.lookOverride = (id) => {
        const p = app.sim?.view.players.find((v) => v.id === id);
        return p
          ? {
              x: p.position.x + Math.sin(p.yaw) * 5,
              y: p.position.y + 1.5,
              z: p.position.z + Math.cos(p.yaw) * 5,
            }
          : null;
      };
      app.sim?.camera.setFixed(
        { x: position[0], y: position[1], z: position[2] },
        { x: target[0], y: target[1], z: target[2] },
        fov,
      );
    },
    avatarReady: () => (app.renderer?.avatars.avatarOf('local') ?? null) !== null,
    avatarsReady: () =>
      app.sim?.view.players.filter((p) => app.renderer?.avatars.avatarOf(p.id)).length ?? 0,
    avatar: (patch, fresh = false) => {
      const spec = { ...(fresh ? DEFAULT_AVATAR : app.avatarSpec('local')), ...patch };
      app.setAvatarSpec('local', spec);
      return encodeAvatar(spec);
    },
    avatarKey: () => app.renderer?.avatars.avatarOf('local')?.key ?? null,
    stats: (): Record<string, number | string> => {
      const s = app.renderer?.stats;
      if (!s) return {};
      return {
        fps: s.fps,
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        quality: s.quality,
        frameMs: s.frameMs,
        renderMs: s.renderMs,
      };
    },
    hover: () => {
      const view = app.sim?.view;
      return {
        kind: view?.hover.kind ?? 'none',
        id: view?.hover.id ?? null,
        prompt: view?.prompt?.id ?? null,
      };
    },
    inspect: (name) => {
      const root = app.renderer?.scene.getObjectByName(name);
      if (!root) return [];
      return [root, ...root.children].map((o) => {
        const p = o.getWorldPosition(o.position.clone());
        return {
          name: o.name || o.type,
          visible: o.visible,
          position: [p.x, p.y, p.z].map((n) => Math.round(n * 100) / 100),
        };
      });
    },
    players: () =>
      app.sim?.view.players.map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.isBot,
        seat: p.seatId,
        hand: p.handRaised,
        x: p.position.x,
        z: p.position.z,
      })) ?? [],
    throw: (kind, x, y, z, targetId) =>
      isThrowKind(kind) ? (app.sim?.throwAt(kind, { x, y, z }, targetId ?? null) ?? false) : false,
    aim: (kind) => app.sim?.setAim(kind !== null && isThrowKind(kind) ? kind : null),
    hand: (raised) => app.sim?.raiseHand(raised),
    chat: (text) => app.say(text),
    board: (open) => (open ? app.runtime?.board.enter() : app.runtime?.board.exit()),
    theater: (open) =>
      open ? app.runtime?.share.openTheater() : app.runtime?.share.closeTheater(),
    fx: () => ({
      projectiles: app.sim?.view.projectiles.length ?? 0,
      particles: app.renderer?.fx.particles.count ?? 0,
      decals: app.renderer?.stats.decals ?? 0,
    }),
    join: (room, name, passcode = '') => app.flow.join(room, name, passcode),
    offline: () => app.flow.playOffline(),
    net: () => {
      const s = app.store.getState();
      return {
        state: s.net,
        self: app.runtime?.net.selfId ?? null,
        room: s.room?.code ?? null,
        rtt: app.runtime?.net.rtt ?? 0,
        people: app.sim?.view.players.length ?? 0,
      };
    },
    voice: async () => (await app.runtime?.voice.debugState()) ?? null,
    talk: async (on) => {
      const local = app.runtime?.voice.local;
      if (!local) return;
      if (on) await local.enable(true);
      else local.setMuted(true);
    },
    shareTest: (withAudio = false) => {
      const stream = testPattern();
      const tone = withAudio ? testTone(app) : null;
      if (tone) stream.addTrack(tone);
      app.runtime?.share.startWith(stream, false);
    },
    shareStop: () => app.runtime?.share.stop(),
    share: () => app.runtime?.share.describe() ?? null,
    hold: (item) => app.runtime?.play.hold(item),
    use: () => app.runtime?.play.use(),
    shield: (on) => app.runtime?.play.setShield(on),
    scores: () => app.runtime?.play.scores() ?? {},
    shootHoop: () => {
      const goal = app.sim?.room.goals[0];
      if (!goal) return false;
      const [x, y, z] = goal.position;
      return app.sim?.throwAt('paper', { x, y: y - 0.05, z }) ?? false;
    },
    clean: () => app.clearMess(),
    play: () => {
      const play = app.sim?.play;
      return {
        held: play?.held ?? null,
        shield: play?.shielded ?? false,
        tilt: play?.planeTilt ?? 0,
        splats: app.renderer?.avatars.splatCount ?? 0,
      };
    },
    party: (on) => {
      if (app.renderer) app.renderer.party = on;
    },
    tilt: (value) => {
      const play = app.sim?.play;
      if (play) play.tilt(value - play.planeTilt);
    },
  };
  window.__huddle = api;
  window.__huddleApp = app;
}
