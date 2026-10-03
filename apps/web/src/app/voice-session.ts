import type { Simulation } from '@huddle/engine';
import type { ConnectionState, RealtimeClient } from '@huddle/net';
import type { PlatformServices } from '@huddle/platform';
import {
  MeshTransport,
  SpatialAudio,
  voiceRoute,
  type MediaTransport,
  type ScreenHint,
} from '@huddle/rtc';
import {
  EventBus,
  mediaPeers,
  type Logger,
  type ServerMessage,
  type TimerHandle,
  type Unsubscribe,
  type Vec3,
} from '@huddle/shared';
import { pushToast, type HudStore, type WorldLabels } from '@huddle/ui';
import { LocalVoice, type VoicePrefs } from './local-voice.ts';
import { sampleVoiceStats, voiceDebugState, type VoiceDebug } from './voice-stats.ts';

export type { VoiceDebug } from './voice-stats.ts';

export interface VoiceEvents {
  /** A peer's screen stream appeared, changed or ended (null). */
  screen: { peerId: string; stream: MediaStream | null };
}

export interface VoiceSessionDeps {
  client: RealtimeClient;
  sim: Simulation;
  platform: PlatformServices;
  store: HudStore;
  labels: WorldLabels;
  log: Logger;
  /** Head position of a player (the avatar's head anchor), or null when unknown. */
  headOf: (playerId: string) => Vec3 | null;
  prefs: () => VoicePrefs;
  persist: (patch: Partial<VoicePrefs>) => void;
}

/** Audio source id of the presenter's screen audio. */
const SCREEN_SOURCE = '#screen';
/** Full volume this close to the wall screen (it is big and meant for the whole room). */
const SCREEN_REF_DISTANCE = 6;
const HEAD_HEIGHT = 1.55;
const SEATED_HEAD_HEIGHT = 1.2;
/** Mute/deafen updates are spaced out to stay inside the server's rate limit. */
const STATE_SPACING_MS = 300;

/**
 * Voice in an online room: the WebRTC mesh to everyone within the room's mesh cap, positional
 * audio (listener at your avatar's head, facing where the camera looks; global, proximity or
 * zones), speaking and mute state on name tags and in the people panel, mouth flap levels,
 * host mute requests, and the transport the presenter's screen travels on.
 */
export class VoiceSession {
  readonly events = new EventBus<VoiceEvents>();
  readonly local: LocalVoice;
  /** Bumps when anything the people panel shows changes (mute, speaking, volume). */
  version = 0;
  private readonly d: VoiceSessionDeps;
  private readonly audio: SpatialAudio;
  private transport: MediaTransport | null = null;
  private transportSelf: string | null = null;
  private readonly screens = new Map<string, MediaStream>();
  private screenAudio: MediaStream | null = null;
  private theater = false;
  private overCap = false;
  /** Per player: bit 1 speaking, bit 2 muted (what labels and the panel show). */
  private readonly bits = new Map<string, number>();
  private lastSent = '';
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private sendTimer: TimerHandle | null = null;
  private statsTimer = 0;
  private readonly listener = { x: 0, y: 0, z: 0 };
  private readonly source = { x: 0, y: 0, z: 0 };

  constructor(deps: VoiceSessionDeps) {
    this.d = deps;
    this.audio = new SpatialAudio(deps.platform.audio, deps.platform.mediaElements);
    this.local = new LocalVoice({
      platform: deps.platform,
      store: deps.store,
      log: deps.log.child('mic'),
      prefs: deps.prefs,
      persist: deps.persist,
      onChange: () => this.localChanged(),
    });
  }

  /** Connected to the room's media mesh (online and within the cap). */
  get active(): boolean {
    return this.transport !== null && !this.overCap;
  }

  attach(): Unsubscribe[] {
    const { client } = this.d;
    return [
      ...this.local.attach(),
      // New device, restart or stop: the same senders carry the new track (no renegotiation).
      this.local.mic.events.on('track', (e) => this.transport?.publishMic(e.track)),
      client.events.on('welcome', () => this.onWelcome()),
      client.events.on('state', (e) => this.onState(e.state)),
      client.events.on('message', (m) => this.onMessage(m)),
    ];
  }

  /** The presenter's screen stream as it arrives from the mesh (null until it does). */
  screenOf(peerId: string): MediaStream | null {
    return this.screens.get(peerId) ?? null;
  }

  publishScreen(stream: MediaStream | null, hint: ScreenHint): void {
    this.transport?.publishScreen(stream, hint);
  }

  setScreenHint(hint: ScreenHint): void {
    this.transport?.setScreenHint(hint);
  }

  /** Plays the presenter's screen audio from the wall (null stops it). */
  setScreenAudio(stream: MediaStream | null): void {
    this.screenAudio = stream;
    this.refreshScreenAudio();
  }

  /** In Theater Mode the screen audio is global. */
  setTheater(on: boolean): void {
    this.theater = on;
  }

  /** Volume of the presenter's screen audio, 0..2 (kept across shares). */
  setScreenVolume(volume: number): void {
    this.audio.setVolume(SCREEN_SOURCE, volume);
    this.refreshScreenAudio();
  }

  isMuted(playerId: string): boolean {
    return this.transport !== null && ((this.bits.get(playerId) ?? 2) & 2) !== 0;
  }

  isSpeaking(playerId: string): boolean {
    return ((this.bits.get(playerId) ?? 0) & 1) !== 0;
  }

  volumeOf(playerId: string): number {
    return this.audio.volumeOf(playerId);
  }

  setVolume(playerId: string, volume: number): void {
    this.audio.setVolume(playerId, volume);
    this.version++;
  }

  /** Mouth flap level 0..1. */
  talkLevel(playerId: string): number {
    const self = playerId === this.d.sim.selfId;
    if (!this.transport) return self ? this.local.previewLevel : 0;
    return self ? this.local.talkLevel : this.audio.level(playerId);
  }

  /** Once per frame: listener, voice positions and routes, speaking state, stats. */
  update(dt: number): void {
    this.local.update(dt);
    if (!this.transport) {
      this.syncPreview();
      return;
    }
    this.audio.update(dt);
    const { sim, client } = this.d;
    const cam = sim.view.camera;
    const me = this.headOf(sim.selfId, this.listener);
    if (me) {
      const fx = cam.target.x - cam.position.x;
      const fz = cam.target.z - cam.position.z;
      this.audio.setListener(me.x, me.y, me.z, fx, fz);
    }
    const mode = client.room?.voice ?? 'zones';
    const zones = sim.room.voiceZones;
    for (const id of this.audio.ids()) {
      let p: Vec3 | null;
      if (id === SCREEN_SOURCE) {
        const c = sim.room.screen.center;
        p = this.source;
        p.x = c[0];
        p.y = c[1];
        p.z = c[2];
      } else p = this.headOf(id, this.source);
      if (!p) continue;
      this.audio.setPosition(id, p.x, p.y, p.z);
      const global = id === SCREEN_SOURCE && this.theater;
      this.audio.setRoute(id, global || !me ? 'global' : voiceRoute(mode, zones, me, p));
    }
    this.syncSpeaking();
    this.statsTimer -= dt;
    if (this.statsTimer <= 0 && this.d.store.getState().debugOpen) {
      this.statsTimer = 1;
      void this.sampleStats();
    }
  }

  debugState(): Promise<VoiceDebug> {
    return voiceDebugState(this.transport, this.audio, {
      mic: this.local.mic.state,
      muted: this.local.muted,
      transmitting: this.local.transmitting,
      overCap: this.overCap,
    });
  }

  dispose(): void {
    this.dropTransport();
    this.local.dispose();
    this.audio.dispose();
    if (this.sendTimer) this.d.platform.clock.clearTimeout(this.sendTimer);
    this.events.clear();
  }

  private onWelcome(): void {
    const { client, platform } = this.d;
    const self = client.selfId;
    if (!self) return;
    if (!platform.peers.supported) {
      this.d.log.warn('WebRTC is not available: no voice or screen sharing');
      return;
    }
    if (this.transportSelf !== self) {
      // A fresh session (new id): the old links belong to someone the room no longer knows.
      this.dropTransport();
      const t = new MeshTransport({
        selfId: self,
        factory: platform.peers,
        sendSignal: (to, data) => client.send({ t: 'signal', to, data }),
        log: this.d.log.child('mesh'),
      });
      t.events.on('remote', (e) => this.onRemote(e.peerId, e.mic, e.screen));
      t.events.on('peerRemoved', (e) => this.onRemote(e.peerId, null, null));
      t.publishMic(this.local.mic.track);
      this.transport = t;
      this.transportSelf = self;
    }
    this.transport?.setIceServers(client.ice);
    this.updatePeers();
    this.lastSent = '';
    this.sendState();
  }

  private onState(state: ConnectionState): void {
    if (state !== 'closed' && state !== 'failed') return;
    this.dropTransport();
    // A failed join from the lobby keeps the mic test running; leaving the room stops it.
    if (state === 'closed' || this.d.store.getState().lobby === null) this.local.stop();
    for (const id of this.bits.keys()) this.d.labels.voice(id, false, false);
    this.bits.clear();
    this.setOverCap(false);
    this.lastSent = '';
    this.d.store.setState((s) => ({
      debug: { ...s.debug, peers: [], audio: [], packetLoss: null, bitrateKbps: null },
    }));
    this.version++;
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'signal':
        this.transport?.handleSignal(m.from, m.data);
        return;
      case 'ice':
        this.transport?.setIceServers(m.servers);
        return;
      case 'left':
        this.bits.delete(m.id);
        this.updatePeers();
        this.version++;
        return;
      case 'joined':
      case 'room':
        this.updatePeers();
        this.version++;
        return;
      case 'voice':
        this.version++;
        return;
      case 'muteRequest':
        if (!this.transport || this.local.muted) return;
        this.local.setMuted(true);
        pushToast(this.d.store, 'voice.mutedByHost', 'info', { name: this.nameOf(m.by) });
        return;
      default:
        return;
    }
  }

  /** Links to exactly the room's media peers (the longest-present people up to the cap). */
  private updatePeers(): void {
    const { client } = this.d;
    const t = this.transport;
    const self = client.selfId;
    if (!t || !self || !client.room) return;
    const peers = mediaPeers(client.players.all(), client.room.meshCap);
    const over = !peers.has(self);
    t.setPeers(over ? [] : peers);
    if (over && !this.overCap) {
      pushToast(this.d.store, 'voice.overCap', 'warn', { cap: client.room.meshCap });
    }
    this.setOverCap(over);
  }

  private setOverCap(over: boolean): void {
    this.overCap = over;
    this.local.patchUi({ overCap: over });
  }

  private onRemote(peerId: string, mic: MediaStream | null, screen: MediaStream | null): void {
    if (mic) this.audio.add(peerId, mic);
    else this.audio.remove(peerId);
    const before = this.screens.get(peerId) ?? null;
    if (screen) this.screens.set(peerId, screen);
    else this.screens.delete(peerId);
    if (before !== screen) this.events.emit('screen', { peerId, stream: screen });
    // A screen-audio track can arrive after the picture.
    this.refreshScreenAudio();
    this.version++;
  }

  private refreshScreenAudio(): void {
    const s = this.screenAudio;
    if (s && s.getAudioTracks().length > 0 && this.transport) {
      this.audio.add(SCREEN_SOURCE, s, { refDistance: SCREEN_REF_DISTANCE });
    } else this.audio.remove(SCREEN_SOURCE);
    const volume = this.audio.has(SCREEN_SOURCE) ? this.audio.volumeOf(SCREEN_SOURCE) : null;
    if (this.d.store.getState().screenVolume !== volume)
      this.d.store.setState({ screenVolume: volume });
  }

  private dropTransport(): void {
    const t = this.transport;
    if (!t) return;
    this.transport = null;
    this.transportSelf = null;
    t.dispose();
    for (const id of this.audio.ids()) this.audio.remove(id);
    for (const peerId of [...this.screens.keys()]) {
      this.screens.delete(peerId);
      this.events.emit('screen', { peerId, stream: null });
    }
    this.refreshScreenAudio();
  }

  private localChanged(): void {
    this.audio.setDeafened(this.local.deafened);
    this.sendState();
    this.version++;
  }

  /** Tells the room whether we can be heard (spaced out; the last state always goes out). */
  private sendState(): void {
    if (this.sendTimer) return;
    const clock = this.d.platform.clock;
    const wait = Math.max(0, this.lastSentAt + STATE_SPACING_MS - clock.now());
    this.sendTimer = clock.setTimeout(() => {
      this.sendTimer = null;
      const muted = !this.local.transmitting;
      const deafened = this.local.deafened;
      const key = `${muted}:${deafened}`;
      if (key === this.lastSent) return;
      if (this.d.client.send({ t: 'voice', muted, deafened })) {
        this.lastSent = key;
        this.lastSentAt = clock.now();
      }
    }, wait);
  }

  /** Green room (no room yet): your own tag shows the mic test and the mic you will join with. */
  private syncPreview(): void {
    const self = this.d.sim.selfId;
    const speaking = this.local.previewSpeaking;
    const bits = (speaking ? 1 : 0) | (this.local.muted ? 2 : 0);
    if (this.bits.get(self) === bits) return;
    this.bits.set(self, bits);
    this.d.labels.voice(self, speaking, this.local.muted);
  }

  /** Name tags and the people panel: who speaks, who is muted. */
  private syncSpeaking(): void {
    const { sim, client, labels } = this.d;
    for (const p of sim.view.players) {
      const self = p.id === sim.selfId;
      const speaking = self ? this.local.speaking : this.audio.speaking(p.id);
      const muted = self ? !this.local.transmitting : (client.players.get(p.id)?.muted ?? true);
      const bits = (speaking ? 1 : 0) | (muted ? 2 : 0);
      if (this.bits.get(p.id) === bits) continue;
      this.bits.set(p.id, bits);
      labels.voice(p.id, speaking, muted);
      this.version++;
    }
  }

  private headOf(playerId: string, out: { x: number; y: number; z: number }): Vec3 | null {
    const head = this.d.headOf(playerId);
    if (head) {
      out.x = head.x;
      out.y = head.y;
      out.z = head.z;
      return out;
    }
    const p = this.d.sim.view.findPlayer(playerId);
    if (!p) return null;
    out.x = p.position.x;
    out.y = p.position.y + (p.seatId ? SEATED_HEAD_HEIGHT : HEAD_HEIGHT);
    out.z = p.position.z;
    return out;
  }

  private nameOf(netId: string): string {
    if (netId === SCREEN_SOURCE) return 'screen';
    return this.d.client.players.get(netId)?.name ?? '?';
  }

  private async sampleStats(): Promise<void> {
    const t = this.transport;
    if (t) {
      await sampleVoiceStats(
        t,
        this.audio,
        this.d.store,
        (id) => this.nameOf(id),
        () => {
          return t === this.transport;
        },
      );
    }
  }
}
