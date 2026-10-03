import type { PeerConnectionFactory } from '@huddle/platform';
import { errorMessage, type IceServer, type Logger, type SignalData } from '@huddle/shared';
import { withOpusDtx } from './sdp.ts';

/** Which of a peer's streams carries their voice and which their shared screen. */
export interface StreamMeta {
  mic: string | null;
  screen: string | null;
}

export interface PeerLinkHooks {
  signal(data: SignalData): void;
  /** The peer's voice and screen streams, whenever either changes (null = none). */
  streams(mic: MediaStream | null, screen: MediaStream | null): void;
  state(state: RTCPeerConnectionState): void;
}

export interface PeerLinkOptions {
  id: string;
  /** On offer glare the polite peer yields; exactly one side of each link is polite. */
  polite: boolean;
  factory: PeerConnectionFactory;
  iceServers: readonly IceServer[];
  hooks: PeerLinkHooks;
  log: Logger;
}

export interface LinkStats {
  state: RTCPeerConnectionState;
  rttMs: number | null;
  /** Packets lost of incoming audio, percent since the previous sample. */
  lossPct: number | null;
  inKbps: number;
  outKbps: number;
}

/** A link stuck in `disconnected` this long restarts ICE without waiting for `failed`. */
const DISCONNECT_RESTART_MS = 5000;

export function toRtcIce(servers: readonly IceServer[]): RTCIceServer[] {
  return servers.map((s) => ({
    urls: [...s.urls],
    ...(s.username === undefined ? {} : { username: s.username }),
    ...(s.credential === undefined ? {} : { credential: s.credential }),
  }));
}

/**
 * One WebRTC connection to one peer, negotiated with the "perfect negotiation" pattern from the
 * WebRTC spec: either side may renegotiate at any time, and on offer glare the polite peer rolls
 * back while the impolite one ignores the colliding offer. Incoming signals are applied strictly
 * in order. Tracks are attached once and swapped with `replaceTrack`, so muting, switching
 * microphones and re-sharing a screen need no renegotiation.
 */
export class PeerLink {
  readonly id: string;
  readonly pc: RTCPeerConnection;
  private readonly polite: boolean;
  private readonly hooks: PeerLinkHooks;
  private readonly log: Logger;
  private makingOffer = false;
  private ignoreOffer = false;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private micSender: RTCRtpSender | null = null;
  private readonly screenSenders: Record<'video' | 'audio', RTCRtpSender | null> = {
    video: null,
    audio: null,
  };
  private screenTune: { maxBitrate: number; hint: 'detail' | 'motion' } | null = null;
  private meta: StreamMeta = { mic: null, screen: null };
  private readonly remote = new Map<string, MediaStream>();
  /** What the hooks last reported; `tracks` counts tracks, so a late screen-audio track shows. */
  private shown: { mic: MediaStream | null; screen: MediaStream | null; tracks: number } = {
    mic: null,
    screen: null,
    tracks: 0,
  };
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTotals = { at: 0, inBytes: 0, outBytes: 0, lost: 0, received: 0 };

  constructor(o: PeerLinkOptions) {
    this.id = o.id;
    this.polite = o.polite;
    this.hooks = o.hooks;
    this.log = o.log;
    const pc = o.factory.create({ iceServers: toRtcIce(o.iceServers), bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.onnegotiationneeded = () => {
      void this.negotiate();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.hooks.signal({ candidate: e.candidate.toJSON() as SignalCandidate });
    };
    pc.ontrack = (e) => this.onTrack(e);
    pc.onconnectionstatechange = () => this.onState();
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyScreenTune();
    };
  }

  /** Applies one signal from the peer (after any still being applied). */
  handle(data: SignalData): void {
    this.queue = this.queue
      .then(() => this.apply(data))
      .catch((err: unknown) =>
        this.log.warn('signal failed', { peer: this.id, err: errorMessage(err) }),
      );
  }

  /** Our voice track (null = stop sending; the connection stays). */
  setMic(track: MediaStreamTrack | null, stream: MediaStream): void {
    if (this.closed) return;
    if (this.micSender) this.replace(this.micSender, track);
    else if (track) this.micSender = this.pc.addTrack(track, stream);
  }

  /** Our shared screen (null tracks = not sharing). */
  setScreen(
    video: MediaStreamTrack | null,
    audio: MediaStreamTrack | null,
    stream: MediaStream,
  ): void {
    if (this.closed) return;
    for (const [kind, track] of [
      ['video', video],
      ['audio', audio],
    ] as const) {
      const sender = this.screenSenders[kind];
      if (sender) this.replace(sender, track);
      else if (track) this.screenSenders[kind] = this.pc.addTrack(track, stream);
    }
  }

  /** Tells the peer which stream is which (sent before the tracks that need it). */
  announce(meta: StreamMeta): void {
    if (!this.closed) this.hooks.signal({ streams: meta });
  }

  /** Bitrate cap and what to sacrifice under load: resolution for motion, frame rate for text. */
  tuneScreen(maxBitrate: number, hint: 'detail' | 'motion'): void {
    this.screenTune = { maxBitrate, hint };
    void this.applyScreenTune();
  }

  setIceServers(servers: readonly IceServer[]): void {
    if (this.closed) return;
    try {
      this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers: toRtcIce(servers) });
    } catch (err: unknown) {
      this.log.warn('ice update failed', errorMessage(err));
    }
  }

  async stats(): Promise<LinkStats> {
    const report = await this.pc.getStats();
    let rtt: number | null = null;
    let inBytes = 0;
    let outBytes = 0;
    let lost = 0;
    let received = 0;
    report.forEach((s: RTCStats & Record<string, unknown>) => {
      if (
        s.type === 'candidate-pair' &&
        s.nominated === true &&
        typeof s.currentRoundTripTime === 'number'
      )
        rtt = s.currentRoundTripTime * 1000;
      if (s.type === 'inbound-rtp') {
        inBytes += Number(s.bytesReceived ?? 0);
        if (s.kind === 'audio') {
          lost += Number(s.packetsLost ?? 0);
          received += Number(s.packetsReceived ?? 0);
        }
      }
      if (s.type === 'outbound-rtp') outBytes += Number(s.bytesSent ?? 0);
    });
    const now = Date.now();
    const prev = this.lastTotals;
    const secs = prev.at > 0 ? (now - prev.at) / 1000 : 0;
    const dLost = lost - prev.lost;
    const dTotal = dLost + (received - prev.received);
    this.lastTotals = { at: now, inBytes, outBytes, lost, received };
    return {
      state: this.pc.connectionState,
      rttMs: rtt,
      lossPct: dTotal > 0 ? (100 * Math.max(0, dLost)) / dTotal : null,
      inKbps: secs > 0 ? ((inBytes - prev.inBytes) * 8) / 1000 / secs : 0,
      outKbps: secs > 0 ? ((outBytes - prev.outBytes) * 8) / 1000 / secs : 0,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    const pc = this.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.close();
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.sendLocalDescription();
    } catch (err: unknown) {
      this.log.warn('offer failed', { peer: this.id, err: errorMessage(err) });
    } finally {
      this.makingOffer = false;
    }
  }

  private async apply(data: SignalData): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    if (data.streams) {
      this.meta = data.streams;
      this.publishStreams();
    }
    const d = data.description;
    if (d) {
      const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      // A polite peer's own pending offer is rolled back implicitly here.
      await pc.setRemoteDescription({
        type: d.type,
        ...(d.sdp === undefined ? {} : { sdp: withOpusDtx(d.sdp) }),
      });
      if (d.type === 'offer') {
        await pc.setLocalDescription();
        this.sendLocalDescription();
      }
    }
    if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err: unknown) {
        // Candidates of an offer we ignored fail harmlessly.
        if (!this.ignoreOffer) throw err;
      }
    }
  }

  private sendLocalDescription(): void {
    const l = this.pc.localDescription;
    if (l && !this.closed) this.hooks.signal({ description: { type: l.type, sdp: l.sdp } });
  }

  private replace(sender: RTCRtpSender, track: MediaStreamTrack | null): void {
    if (sender.track === track) return;
    sender.replaceTrack(track).catch((err: unknown) => {
      this.log.warn('replaceTrack failed', { peer: this.id, err: errorMessage(err) });
    });
  }

  private onTrack(e: RTCTrackEvent): void {
    for (const stream of e.streams) {
      this.remote.set(stream.id, stream);
      stream.onaddtrack = () => this.publishStreams();
      stream.onremovetrack = () => this.publishStreams();
    }
    this.publishStreams();
  }

  /** Works out the voice and screen streams from the peer's announcement (or track kinds). */
  private publishStreams(): void {
    const byId = (id: string | null): MediaStream | null =>
      id === null ? null : (this.remote.get(id) ?? null);
    let mic = byId(this.meta.mic);
    let screen = byId(this.meta.screen);
    if (this.meta.mic === null && this.meta.screen === null) {
      // No announcement yet: guess from the track kinds.
      for (const s of this.remote.values()) {
        if (s.getVideoTracks().length > 0) screen ??= s;
        else mic ??= s;
      }
    }
    const tracks = (mic?.getTracks().length ?? 0) * 16 + (screen?.getTracks().length ?? 0);
    const s = this.shown;
    if (mic === s.mic && screen === s.screen && tracks === s.tracks) return;
    this.shown = { mic, screen, tracks };
    this.hooks.streams(mic, screen);
  }

  private onState(): void {
    const pc = this.pc;
    const state = pc.connectionState;
    this.hooks.state(state);
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (state === 'failed') {
      this.log.info('ice failed, restarting', { peer: this.id });
      pc.restartIce();
    } else if (state === 'disconnected' && !this.polite) {
      this.disconnectTimer = setTimeout(() => {
        if (!this.closed && pc.connectionState === 'disconnected') pc.restartIce();
      }, DISCONNECT_RESTART_MS);
    }
  }

  private async applyScreenTune(): Promise<void> {
    const sender = this.screenSenders.video;
    const tune = this.screenTune;
    if (!sender || !tune || this.closed || this.pc.signalingState !== 'stable') return;
    const params = sender.getParameters() as RTCRtpSendParameters & {
      degradationPreference?: string;
    };
    // Encodings exist only after negotiation; the next `stable` state tries again.
    if (params.encodings.length === 0) return;
    for (const enc of params.encodings) enc.maxBitrate = tune.maxBitrate;
    params.degradationPreference =
      tune.hint === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
    try {
      await sender.setParameters(params);
    } catch {
      // Older engines reject `degradationPreference`; the bitrate cap alone still helps.
      delete params.degradationPreference;
      await sender.setParameters(params).catch((err: unknown) => {
        this.log.warn('screen tune failed', { peer: this.id, err: errorMessage(err) });
      });
    }
  }
}

type SignalCandidate = NonNullable<SignalData['candidate']>;
