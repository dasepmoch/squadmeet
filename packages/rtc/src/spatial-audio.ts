import type { AudioContextProvider, AudioSink, MediaElementFactory } from '@huddle/platform';
import { rms, SpeakingDetector } from './speaking.ts';
import { PROXIMITY, type VoiceRoute } from './voice-routing.ts';

interface Voice {
  stream: MediaStream;
  sink: AudioSink;
  input: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  panner: PannerNode;
  buf: Float32Array<ArrayBuffer>;
  detector: SpeakingDetector;
  route: VoiceRoute;
  refDistance: number;
}

export interface VoiceOptions {
  /** Distance with full volume (bigger for the wall screen). */
  refDistance?: number;
}

/**
 * Positional voices: per source `MediaStreamAudioSourceNode → GainNode (per-person volume) →
 * PannerNode (HRTF) → master (deafen) → compressor → speakers`, plus an analyser per source for
 * speaking detection. The listener follows the local avatar's head.
 */
export class SpatialAudio {
  private readonly audio: AudioContextProvider;
  private readonly elements: MediaElementFactory;
  private graph: { ctx: AudioContext; master: GainNode } | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly volumes = new Map<string, number>();
  private deafened = false;

  constructor(audio: AudioContextProvider, elements: MediaElementFactory) {
    this.audio = audio;
    this.elements = elements;
  }

  /** Plays `stream` as source `id` (replacing a different stream under the same id). */
  add(id: string, stream: MediaStream, options: VoiceOptions = {}): void {
    if (this.voices.get(id)?.stream === stream) return;
    this.remove(id);
    if (stream.getAudioTracks().length === 0) return;
    const { ctx, master } = this.ensureGraph();
    // Chromium only feeds remote WebRTC audio into Web Audio while a media element plays it.
    const sink = this.elements.attachAudioSink(stream);
    const input = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const gain = ctx.createGain();
    gain.gain.value = this.volumes.get(id) ?? 1;
    const panner = ctx.createPanner();
    const refDistance = options.refDistance ?? PROXIMITY.refDistance;
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = PROXIMITY.maxDistance;
    panner.rolloffFactor = PROXIMITY.rolloffFactor;
    input.connect(analyser);
    input.connect(gain);
    gain.connect(panner);
    panner.connect(master);
    this.voices.set(id, {
      stream,
      sink,
      input,
      analyser,
      gain,
      panner,
      buf: new Float32Array(analyser.fftSize),
      detector: new SpeakingDetector(),
      route: 'proximity',
      refDistance,
    });
  }

  remove(id: string): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.input.disconnect();
    v.gain.disconnect();
    v.panner.disconnect();
    v.sink.dispose();
    this.voices.delete(id);
  }

  has(id: string): boolean {
    return this.voices.has(id);
  }

  ids(): string[] {
    return [...this.voices.keys()];
  }

  setPosition(id: string, x: number, y: number, z: number): void {
    const p = this.voices.get(id)?.panner;
    if (!p) return;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  /** Global voices keep full volume at any distance (direction still pans). */
  setRoute(id: string, route: VoiceRoute): void {
    const v = this.voices.get(id);
    if (!v || v.route === route) return;
    v.route = route;
    v.panner.rolloffFactor = route === 'global' ? 0 : PROXIMITY.rolloffFactor;
  }

  /** Per-person volume, 0..2 (kept when their stream is replaced). */
  setVolume(id: string, volume: number): void {
    const v = Math.min(2, Math.max(0, volume));
    this.volumes.set(id, v);
    const voice = this.voices.get(id);
    if (voice) voice.gain.gain.value = v;
  }

  volumeOf(id: string): number {
    return this.volumes.get(id) ?? 1;
  }

  setListener(x: number, y: number, z: number, forwardX: number, forwardZ: number): void {
    if (!this.graph) return;
    const l = this.graph.ctx.listener;
    const len = Math.hypot(forwardX, forwardZ) || 1;
    const fx = forwardX / len;
    const fz = forwardZ / len;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Silences every voice (and keeps measuring who speaks). */
  setDeafened(on: boolean): void {
    this.deafened = on;
    if (!this.graph) return;
    const { ctx, master } = this.graph;
    master.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.03);
  }

  /** Reads every analyser once per frame. */
  update(dt: number): void {
    for (const v of this.voices.values()) {
      v.analyser.getFloatTimeDomainData(v.buf);
      v.detector.update(rms(v.buf), dt);
    }
  }

  /** Smoothed voice level 0..1 (mouth flap). */
  level(id: string): number {
    return this.voices.get(id)?.detector.level ?? 0;
  }

  speaking(id: string): boolean {
    return this.voices.get(id)?.detector.speaking ?? false;
  }

  dispose(): void {
    for (const id of [...this.voices.keys()]) this.remove(id);
    this.graph?.master.disconnect();
    this.graph = null;
  }

  private ensureGraph(): { ctx: AudioContext; master: GainNode } {
    if (this.graph) return this.graph;
    const ctx = this.audio.get();
    const master = ctx.createGain();
    master.gain.value = this.deafened ? 0 : 1;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    this.graph = { ctx, master };
    return this.graph;
  }
}
