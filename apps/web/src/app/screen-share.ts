import type { Simulation } from '@huddle/engine';
import type { RealtimeClient } from '@huddle/net';
import { CaptureError, type PlatformServices } from '@huddle/platform';
import type { GameRenderer } from '@huddle/render';
import { errorMessage, type Logger, type ServerMessage, type Unsubscribe } from '@huddle/shared';
import { pushToast, type HudStore, type ShareHintUi, type Translate } from '@huddle/ui';
import type { VoiceSession } from './voice-session.ts';

export interface ScreenShareDeps {
  platform: PlatformServices;
  renderer: GameRenderer;
  sim: Simulation;
  store: HudStore;
  log: Logger;
  t: () => Translate;
  client: RealtimeClient;
  /** The media mesh the screen travels on. */
  voice: VoiceSession;
  /** In an online room (offline, a share stays on this screen). */
  online: () => boolean;
  /** What the wall shows when nobody shares (the demo deck). */
  restore: () => void;
  /** Stream shown in Theater Mode while nobody shares. */
  fallbackStream: () => MediaStream | null;
}

interface LocalShare {
  stream: MediaStream;
  /** The capture may contain this app: our own wall shows a card instead (no mirror tunnel). */
  selfView: boolean;
  /** The room gave us the screen (always true offline). */
  granted: boolean;
}

const CAPTURE = { width: 1920, height: 1080, frameRate: 30, maxFrameRate: 60 } as const;
/** A handoff request is remembered this long (the presenter may answer later). */
const REQUEST_MS = 120_000;
const MAX_REQUESTS = 4;

/**
 * The big screen: one presenter at a time (the server decides), their capture on everyone's wall
 * through the media mesh, screen audio from the wall, handoff requests and host takeovers, and
 * Theater Mode (a crisp DOM video bound to the same stream). Offline, a share stays local.
 */
export class ScreenShare {
  private readonly d: ScreenShareDeps;
  private local: LocalShare | null = null;
  /** Server id of whoever holds the screen. */
  private presenter: string | null = null;
  private requestedAt = Number.NEGATIVE_INFINITY;
  private hint: ShareHintUi = 'detail';
  private wall: { stream: MediaStream; video: HTMLVideoElement } | null = null;
  private wallKey = '';
  private theaterVideo: HTMLVideoElement | null = null;
  private fullscreenByUs = false;

  constructor(deps: ScreenShareDeps) {
    this.d = deps;
    deps.store.setState({ shareSupported: deps.platform.screenCapture.supported });
  }

  get sharing(): boolean {
    return this.local !== null;
  }

  get theaterOpen(): boolean {
    return this.theaterVideo !== null;
  }

  attach(): Unsubscribe[] {
    const { client, voice } = this.d;
    return [
      client.events.on('welcome', (m) => {
        if (!m.resumed && this.local && this.d.online()) {
          // A fresh session: the room forgot us, so ask for the screen again.
          this.local.granted = false;
          voice.publishScreen(null, this.hint);
          client.send({ t: 'present', on: true });
        }
        this.setPresenter(m.room.presenter);
      }),
      client.events.on('message', (m) => this.onMessage(m)),
      client.events.on('state', (e) => {
        if (e.state === 'closed' || e.state === 'failed') this.wentOffline();
      }),
      voice.events.on('screen', (e) => {
        if (e.peerId === this.presenter) this.refresh();
      }),
      this.d.platform.fullscreen.onChange((active) => {
        if (!active) this.fullscreenByUs = false;
        this.d.store.setState({ fullscreen: active });
      }),
    ];
  }

  async toggle(): Promise<void> {
    if (this.local) this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    const { platform, client, store } = this.d;
    const capture = platform.screenCapture;
    if (!capture.supported) {
      pushToast(store, 'share.unsupported', 'warn');
      return;
    }
    if (this.d.online() && !this.d.voice.active) {
      // Outside the room's media mesh (or without WebRTC): nobody would see the picture.
      pushToast(store, 'share.unreachable', 'warn');
      return;
    }
    const busy = this.d.online() && this.presenter !== null && this.presenter !== client.selfId;
    if (busy && !store.getState().room?.isHost) {
      // Someone else presents: ask them to hand over; we capture once the screen is free.
      if (client.send({ t: 'present', on: true })) {
        this.requestedAt = platform.clock.now();
        pushToast(store, 'share.requested', 'info', { name: this.nameOf(this.presenter) });
      }
      return;
    }
    try {
      const result = await capture.capture({ audio: capture.supportsSystemAudio, ...CAPTURE });
      this.startWith(result.stream, result.mayIncludeSelf);
    } catch (err: unknown) {
      if (err instanceof CaptureError && err.reason === 'cancelled') return;
      this.d.log.warn('screen share failed', errorMessage(err));
      const denied = err instanceof CaptureError && err.reason === 'denied';
      pushToast(store, denied ? 'share.denied' : 'share.failed', 'warn');
    }
  }

  /** Shares an already captured stream (also used by tests with a canvas stream). */
  startWith(stream: MediaStream, selfView: boolean): void {
    if (this.local) this.stopLocal();
    const { client, store } = this.d;
    const online = this.d.online();
    this.local = { stream, selfView, granted: !online };
    for (const track of stream.getVideoTracks()) {
      track.contentHint = this.hint;
      // The browser's own "Stop sharing" button.
      track.addEventListener(
        'ended',
        () => {
          if (this.local?.stream === stream) this.stop();
        },
        { once: true },
      );
    }
    store.setState({ sharing: true });
    if (!online) {
      pushToast(store, 'share.started');
      this.refresh();
      return;
    }
    if (!client.send({ t: 'present', on: true })) {
      this.stopLocal();
      pushToast(store, 'share.failed', 'warn');
      return;
    }
    // Still ours from before (the room ignores a repeated claim): use it right away.
    if (this.presenter === client.selfId) this.setPresenter(this.presenter);
  }

  stop(): void {
    if (!this.local) return;
    this.stopLocal();
    if (this.d.online()) this.d.client.send({ t: 'present', on: false });
    pushToast(this.d.store, 'share.stopped');
  }

  /** Text stays sharp ('detail') or motion stays smooth ('motion'). */
  setHint(hint: ShareHintUi): void {
    this.hint = hint;
    for (const track of this.local?.stream.getVideoTracks() ?? []) track.contentHint = hint;
    this.d.voice.setScreenHint(hint);
    this.d.store.setState({ shareHint: hint });
  }

  /** The presenter's answer to a handoff request. */
  answerRequest(netId: string, accept: boolean): void {
    const { store } = this.d;
    store.setState((s) => ({ presentRequests: s.presentRequests.filter((r) => r.id !== netId) }));
    if (accept && this.local) this.stop();
  }

  /** Theater Mode on whatever the wall shows (a share, or the demo deck). */
  openTheater(): void {
    if (this.theaterVideo) return;
    const stream = this.theaterStream();
    if (!stream) return;
    this.theaterVideo = this.d.platform.mediaElements.createVideo(stream, { muted: true });
    this.d.renderer.screen?.setPaused(true);
    this.d.voice.setTheater(true);
    this.d.store.setState({ theater: this.theaterVideo });
  }

  closeTheater(): void {
    if (!this.theaterVideo) return;
    this.d.platform.mediaElements.releaseVideo(this.theaterVideo);
    this.theaterVideo = null;
    this.d.renderer.screen?.setPaused(false);
    this.d.voice.setTheater(false);
    this.d.store.setState({ theater: null });
    // Fullscreen was for the picture: the room comes back as it was.
    if (this.fullscreenByUs) void this.d.platform.fullscreen.exit().catch(() => undefined);
    this.fullscreenByUs = false;
  }

  /** Browser fullscreen for Theater Mode; iPhone only has the video's own fullscreen player. */
  toggleFullscreen(): void {
    const fs = this.d.platform.fullscreen;
    if (fs.isActive()) {
      this.fullscreenByUs = false;
      void fs.exit().catch(() => undefined);
      return;
    }
    const video = this.theaterVideo;
    const request = fs.supported
      ? fs.request(document.documentElement)
      : video
        ? fs.requestVideo(video)
        : null;
    this.fullscreenByUs = request !== null;
    request?.catch((err: unknown) => {
      this.fullscreenByUs = false;
      this.d.log.warn('fullscreen failed', errorMessage(err));
    });
  }

  /** For tests: who presents, whether we share, and what the wall shows. */
  describe(): { presenter: string | null; sharing: boolean; wall: string; video: number[] } {
    const v = this.wall?.video;
    return {
      presenter: this.presenter,
      sharing: this.local !== null,
      wall: this.wallKey.split(':')[0] ?? '',
      video: v ? [v.videoWidth, v.videoHeight] : [],
    };
  }

  dispose(): void {
    this.closeTheater();
    if (this.local) for (const track of this.local.stream.getTracks()) track.stop();
    this.local = null;
    this.releaseWall();
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'room':
        this.setPresenter(m.room.presenter);
        return;
      case 'presentRequest':
        this.onRequest(m.from);
        return;
      case 'left':
        this.d.store.setState((s) => ({
          presentRequests: s.presentRequests.filter((r) => r.id !== m.id),
        }));
        return;
      case 'error':
        // We captured, but someone else got the screen first.
        if (m.code === 'busy' && this.local && !this.local.granted) {
          this.stopLocal();
          pushToast(this.d.store, 'share.busy', 'warn', { name: this.nameOf(this.presenter) });
        }
        return;
      default:
        return;
    }
  }

  private setPresenter(id: string | null): void {
    const { client, store, voice, sim } = this.d;
    const self = client.selfId;
    const before = this.presenter;
    this.presenter = id;
    const l = this.local;
    if (l && this.d.online()) {
      if (id === self && !l.granted) {
        l.granted = true;
        voice.publishScreen(l.stream, this.hint);
        pushToast(store, 'share.started');
      } else if (id !== self && l.granted) {
        // The host took over, or stopped our share.
        this.stopLocal();
        const key = id === null ? 'share.stoppedByHost' : 'share.takenOver';
        pushToast(store, key, 'warn', { name: this.nameOf(id) });
      }
    }
    if (id === null && before !== null && before !== self && this.requestPending()) {
      this.requestedAt = Number.NEGATIVE_INFINITY;
      pushToast(store, 'share.yourTurn');
    }
    if (id === self) this.requestedAt = Number.NEGATIVE_INFINITY;
    store.setState({
      presenter:
        id === null
          ? null
          : { id: id === self ? sim.selfId : id, name: this.nameOf(id), self: id === self },
      ...(id === self ? {} : { presentRequests: [] }),
    });
    this.refresh();
  }

  private onRequest(from: string): void {
    if (!this.local?.granted) return;
    const name = this.nameOf(from);
    this.d.store.setState((s) => ({
      presentRequests: [
        ...s.presentRequests.filter((r) => r.id !== from),
        { id: from, name },
      ].slice(-MAX_REQUESTS),
    }));
  }

  private requestPending(): boolean {
    return this.d.platform.clock.now() - this.requestedAt < REQUEST_MS;
  }

  private wentOffline(): void {
    this.presenter = null;
    this.requestedAt = Number.NEGATIVE_INFINITY;
    // The room is gone, and with it everyone who watched.
    if (this.local) this.stopLocal();
    this.d.store.setState({ presenter: null, presentRequests: [] });
    this.refresh();
  }

  private stopLocal(): void {
    const l = this.local;
    if (!l) return;
    this.local = null;
    for (const track of l.stream.getTracks()) track.stop();
    this.d.voice.publishScreen(null, this.hint);
    this.d.store.setState({ sharing: false, presentRequests: [] });
    this.refresh();
  }

  /** Puts the right thing on the wall: our share, the presenter's stream, a card, or the deck. */
  private refresh(): void {
    const { voice, client } = this.d;
    const t = this.d.t();
    const l = this.local;
    const online = this.d.online();
    let stream: MediaStream | null = null;
    let card: [string, string] | null = null;
    let remote = false;
    if (l && (l.granted || !online)) {
      if (l.selfView) card = [t('share.selfTitle'), t('share.selfBody')];
      else stream = l.stream;
    } else if (online && this.presenter !== null && this.presenter !== client.selfId) {
      stream = voice.screenOf(this.presenter);
      remote = stream !== null;
      if (!stream) {
        const name = this.nameOf(this.presenter);
        card = [
          t('share.remoteTitle', { name }),
          t(voice.active ? 'share.connecting' : 'share.overCap'),
        ];
      }
    }
    const key = stream ? `video:${stream.id}` : card ? `card:${card.join('\n')}` : 'idle';
    if (key !== this.wallKey) {
      this.wallKey = key;
      this.releaseWall();
      const screen = this.d.renderer.screen;
      if (stream) {
        const video = this.d.platform.mediaElements.createVideo(stream, { muted: true });
        this.wall = { stream, video };
        screen?.showVideo(video);
      } else if (card) screen?.showSelfShare(card[0], card[1]);
      else this.d.restore();
    }
    voice.setScreenAudio(remote ? stream : null);
    this.syncTheater();
  }

  private releaseWall(): void {
    if (this.wall) this.d.platform.mediaElements.releaseVideo(this.wall.video);
    this.wall = null;
  }

  private theaterStream(): MediaStream | null {
    if (this.wall) return this.wall.stream;
    if (this.wallKey.startsWith('card:')) return null;
    return this.d.fallbackStream();
  }

  /** Theater Mode follows the wall: a new picture swaps in, an ended one closes it. */
  private syncTheater(): void {
    const v = this.theaterVideo;
    if (!v) return;
    const stream = this.theaterStream();
    if (stream === v.srcObject) return;
    this.closeTheater();
    if (stream) this.openTheater();
  }

  private nameOf(netId: string | null): string {
    if (netId === null) return '?';
    return this.d.client.players.get(netId)?.name ?? '?';
  }
}
