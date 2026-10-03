// Minimal in-memory RTCPeerConnection model for negotiation tests: signaling states, implicit
// offers/answers, implicit rollback on glare, negotiationneeded, remote tracks and replaceTrack.
// Session descriptions are JSON listing the sender's tracks.
import type { PeerConnectionFactory } from '@huddle/platform';

let nextId = 1;

export class FakeTrack {
  readonly id = `t${nextId++}`;
  readonly kind: 'audio' | 'video';
  enabled = true;
  contentHint = '';
  readyState = 'live';
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
  stop(): void {
    this.readyState = 'ended';
  }
}

export class FakeStream {
  readonly id: string;
  onaddtrack: (() => void) | null = null;
  onremovetrack: (() => void) | null = null;
  private readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = [], id = `s${nextId++}`) {
    this.tracks = tracks;
    this.id = id;
  }
  add(t: FakeTrack): void {
    this.tracks.push(t);
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

class FakeSender {
  params: { encodings: { maxBitrate?: number }[]; degradationPreference?: string } = {
    encodings: [],
  };
  track: FakeTrack | null;
  readonly streamId: string;
  readonly pc: FakePC;
  constructor(track: FakeTrack | null, streamId: string, pc: FakePC) {
    this.track = track;
    this.streamId = streamId;
    this.pc = pc;
  }
  replaceTrack(t: FakeTrack | null): Promise<void> {
    this.track = t;
    this.pc.replaced++;
    return Promise.resolve();
  }
  getParameters(): FakeSender['params'] {
    return { ...this.params, encodings: this.params.encodings.map((e) => ({ ...e })) };
  }
  setParameters(p: FakeSender['params']): Promise<void> {
    this.params = p;
    return Promise.resolve();
  }
}

interface Desc {
  type: 'offer' | 'answer';
  sdp: string;
}

interface SdpBody {
  tracks: { slot: number; streamId: string; kind: 'audio' | 'video' }[];
}

export class FakePC {
  signalingState: 'stable' | 'have-local-offer' | 'have-remote-offer' | 'closed' = 'stable';
  connectionState: 'new' | 'connected' | 'failed' | 'closed' = 'new';
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  offers = 0;
  replaced = 0;
  restarts = 0;
  private readonly senders: FakeSender[] = [];
  private needed = false;
  private readonly remoteStreams = new Map<string, FakeStream>();
  private readonly seen = new Set<string>();

  addTrack(track: FakeTrack, stream: FakeStream): FakeSender {
    const s = new FakeSender(track, stream.id, this);
    this.senders.push(s);
    this.markNeeded();
    return s;
  }

  setLocalDescription(): Promise<void> {
    if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: this.body() };
      this.setState('stable');
      this.negotiated();
    } else {
      this.offers++;
      this.needed = false;
      this.localDescription = { type: 'offer', sdp: this.body() };
      this.setState('have-local-offer');
    }
    queueMicrotask(() =>
      this.onicecandidate?.({
        candidate: {
          toJSON: () => ({
            candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
          }),
        },
      }),
    );
    return Promise.resolve();
  }

  setRemoteDescription(d: Desc): Promise<void> {
    if (d.type === 'offer') {
      if (this.signalingState === 'have-remote-offer')
        return Promise.reject(new Error('InvalidStateError'));
      if (this.signalingState === 'have-local-offer') {
        // Implicit rollback (the polite peer yields).
        this.localDescription = null;
        this.needed = true;
        this.setState('stable');
      }
      this.remoteDescription = d;
      this.setState('have-remote-offer');
    } else {
      if (this.signalingState !== 'have-local-offer')
        return Promise.reject(new Error('InvalidStateError'));
      this.remoteDescription = d;
      this.setState('stable');
      this.negotiated();
    }
    this.surfaceTracks(d.sdp);
    return Promise.resolve();
  }

  addIceCandidate(): Promise<void> {
    return this.remoteDescription
      ? Promise.resolve()
      : Promise.reject(new Error('no remote description'));
  }

  restartIce(): void {
    this.restarts++;
    this.markNeeded();
  }

  getConfiguration(): Record<string, unknown> {
    return {};
  }

  setConfiguration(): void {}

  getStats(): Promise<Map<string, unknown>> {
    return Promise.resolve(new Map<string, unknown>());
  }

  close(): void {
    this.signalingState = 'closed';
    this.connectionState = 'closed';
  }

  fail(): void {
    this.connectionState = 'failed';
    this.onconnectionstatechange?.();
  }

  private body(): string {
    const body: SdpBody = {
      tracks: this.senders.map((s, slot) => ({
        slot,
        streamId: s.streamId,
        kind: s.track?.kind ?? 'audio',
      })),
    };
    return JSON.stringify(body);
  }

  private surfaceTracks(sdp: string): void {
    const body = JSON.parse(sdp) as SdpBody;
    for (const t of body.tracks) {
      const key = `${t.streamId}:${t.slot}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      let stream = this.remoteStreams.get(t.streamId);
      if (!stream) {
        stream = new FakeStream([], t.streamId);
        this.remoteStreams.set(t.streamId, stream);
      }
      const track = new FakeTrack(t.kind);
      stream.add(track);
      this.ontrack?.({ track, streams: [stream] });
    }
  }

  private negotiated(): void {
    for (const s of this.senders) if (s.params.encodings.length === 0) s.params.encodings = [{}];
    if (this.connectionState === 'new') {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }
    if (this.needed) this.markNeeded();
  }

  private markNeeded(): void {
    this.needed = true;
    // Like browsers: a queued task, after the current operation's promise continuations.
    setTimeout(() => {
      if (this.needed && this.signalingState === 'stable') this.onnegotiationneeded?.();
    }, 0);
  }

  private setState(s: FakePC['signalingState']): void {
    this.signalingState = s;
    this.onsignalingstatechange?.();
  }
}

export function fakeFactory(created: FakePC[]): PeerConnectionFactory {
  return {
    supported: true,
    create: () => {
      const pc = new FakePC();
      created.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
  };
}
