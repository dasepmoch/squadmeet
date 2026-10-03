import type { PeerConnectionFactory } from '@huddle/platform';
import { EventBus, type IceServer, type Logger, type SignalData } from '@huddle/shared';
import { PeerLink, type LinkStats, type StreamMeta } from './peer-link.ts';

export type ScreenHint = 'detail' | 'motion';

export interface MediaEvents {
  /** A peer's voice and screen streams (null = none), whenever either changes. */
  remote: { peerId: string; mic: MediaStream | null; screen: MediaStream | null };
  peerState: { peerId: string; state: RTCPeerConnectionState };
  peerRemoved: { peerId: string };
}

/**
 * Media between people, independent of how it travels (`publishMic`, `publishScreen`, events).
 * The mesh implementation connects everyone directly; an SFU transport can replace it.
 */
export interface MediaTransport {
  readonly events: EventBus<MediaEvents>;
  setPeers(ids: Iterable<string>): void;
  handleSignal(from: string, data: SignalData): void;
  publishMic(track: MediaStreamTrack | null): void;
  publishScreen(stream: MediaStream | null, hint: ScreenHint): void;
  setScreenHint(hint: ScreenHint): void;
  setIceServers(servers: readonly IceServer[]): void;
  stats(): Promise<Map<string, LinkStats>>;
  dispose(): void;
}

export interface MeshTransportOptions {
  /** Our id on the server (decides politeness on each link). */
  selfId: string;
  factory: PeerConnectionFactory;
  sendSignal: (to: string, data: SignalData) => void;
  log: Logger;
  /** Creates the stream objects that label our outgoing tracks (injectable for tests). */
  createStream?: () => MediaStream;
}

/** Upload the presenter can spend on the screen, split across viewers (bits per second). */
const SCREEN_UPLOAD_BUDGET = 6_000_000;
const SCREEN_BITRATE = { min: 500_000, max: 2_500_000 } as const;

/**
 * Full-mesh WebRTC: one `PeerLink` per peer. Voice goes to everyone; the presenter's screen too.
 * Upload grows with every viewer, which is why rooms cap the mesh (see `mediaPeers`).
 */
export class MeshTransport implements MediaTransport {
  readonly events = new EventBus<MediaEvents>();
  private readonly o: MeshTransportOptions;
  private readonly links = new Map<string, PeerLink>();
  private allowed = new Set<string>();
  private ice: IceServer[] = [];
  private mic: MediaStreamTrack | null = null;
  private screen: { video: MediaStreamTrack | null; audio: MediaStreamTrack | null } | null = null;
  private hint: ScreenHint = 'detail';
  private micOut: MediaStream | null = null;
  private screenOut: MediaStream | null = null;

  constructor(options: MeshTransportOptions) {
    this.o = options;
  }

  get peerIds(): string[] {
    return [...this.links.keys()];
  }

  /** Connects to exactly these peers (links to anyone else are closed). */
  setPeers(ids: Iterable<string>): void {
    const next = new Set(ids);
    next.delete(this.o.selfId);
    this.allowed = next;
    for (const id of [...this.links.keys()]) if (!next.has(id)) this.drop(id);
    for (const id of next) this.link(id);
    this.retuneScreen();
  }

  handleSignal(from: string, data: SignalData): void {
    if (!this.allowed.has(from)) return;
    this.link(from).handle(data);
  }

  publishMic(track: MediaStreamTrack | null): void {
    this.mic = track;
    const out = this.micStream();
    for (const l of this.links.values()) {
      l.announce(this.meta());
      l.setMic(track, out);
    }
  }

  publishScreen(stream: MediaStream | null, hint: ScreenHint): void {
    this.hint = hint;
    this.screen = stream
      ? { video: stream.getVideoTracks()[0] ?? null, audio: stream.getAudioTracks()[0] ?? null }
      : null;
    if (this.screen?.video) this.screen.video.contentHint = hint;
    const out = this.screenStream();
    for (const l of this.links.values()) {
      l.announce(this.meta());
      l.setScreen(this.screen?.video ?? null, this.screen?.audio ?? null, out);
    }
    this.retuneScreen();
  }

  /** Text-heavy content keeps its resolution; video keeps its frame rate. */
  setScreenHint(hint: ScreenHint): void {
    this.hint = hint;
    if (this.screen?.video) this.screen.video.contentHint = hint;
    this.retuneScreen();
  }

  setIceServers(servers: readonly IceServer[]): void {
    this.ice = [...servers];
    for (const l of this.links.values()) l.setIceServers(servers);
  }

  async stats(): Promise<Map<string, LinkStats>> {
    const out = new Map<string, LinkStats>();
    await Promise.all(
      [...this.links].map(async ([id, l]) => {
        out.set(id, await l.stats());
      }),
    );
    return out;
  }

  dispose(): void {
    for (const id of [...this.links.keys()]) this.drop(id);
    this.events.clear();
  }

  private link(id: string): PeerLink {
    const existing = this.links.get(id);
    if (existing) return existing;
    const l = new PeerLink({
      id,
      polite: this.o.selfId > id,
      factory: this.o.factory,
      iceServers: this.ice,
      log: this.o.log,
      hooks: {
        signal: (data) => this.o.sendSignal(id, data),
        streams: (mic, screen) => this.events.emit('remote', { peerId: id, mic, screen }),
        state: (state) => this.events.emit('peerState', { peerId: id, state }),
      },
    });
    this.links.set(id, l);
    // Whatever we already send goes to the newcomer too (one negotiation).
    l.announce(this.meta());
    if (this.mic) l.setMic(this.mic, this.micStream());
    if (this.screen) l.setScreen(this.screen.video, this.screen.audio, this.screenStream());
    return l;
  }

  private drop(id: string): void {
    const l = this.links.get(id);
    if (!l) return;
    l.close();
    this.links.delete(id);
    this.events.emit('peerRemoved', { peerId: id });
  }

  private meta(): StreamMeta {
    return {
      mic: this.micStream().id,
      screen: this.screen ? this.screenStream().id : null,
    };
  }

  /** Stable labels for our outgoing tracks: tracks change, the remote stream objects do not. */
  private micStream(): MediaStream {
    this.micOut ??= this.newStream();
    return this.micOut;
  }

  private screenStream(): MediaStream {
    this.screenOut ??= this.newStream();
    return this.screenOut;
  }

  private newStream(): MediaStream {
    return this.o.createStream ? this.o.createStream() : new MediaStream();
  }

  private retuneScreen(): void {
    if (!this.screen?.video) return;
    const viewers = Math.max(1, this.links.size);
    const rate = Math.min(
      SCREEN_BITRATE.max,
      Math.max(SCREEN_BITRATE.min, Math.round(SCREEN_UPLOAD_BUDGET / viewers)),
    );
    for (const l of this.links.values()) l.tuneScreen(rate, this.hint);
  }
}
