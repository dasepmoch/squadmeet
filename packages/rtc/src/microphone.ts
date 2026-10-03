import {
  CaptureError,
  type AudioContextProvider,
  type MediaDevicesProvider,
} from '@huddle/platform';
import { errorMessage, EventBus, type Logger } from '@huddle/shared';
import { rms, SpeakingDetector } from './speaking.ts';

export type MicState = 'off' | 'starting' | 'live' | 'denied' | 'unavailable' | 'failed';

export interface MicProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface MicEvents {
  /** The track to send changed (new device, restart, or null when stopped). */
  track: { track: MediaStreamTrack | null };
  state: { state: MicState };
}

interface Meter {
  stream: MediaStream;
  input: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
}

/**
 * The local microphone: capture with echo cancellation, noise suppression and auto gain
 * (toggleable), mute and push-to-talk (the track is disabled, so peers get silence and Opus DTX
 * sends next to nothing), device switching and hot-plug recovery. A cloned track feeds a level
 * meter that keeps working while muted (mic test, "you are muted" hints).
 */
export class LocalMic {
  readonly events = new EventBus<MicEvents>();
  readonly detector = new SpeakingDetector();
  state: MicState = 'off';
  deviceId: string | null = null;
  processing: MicProcessing = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  private readonly devices: MediaDevicesProvider;
  private readonly audio: AudioContextProvider;
  private readonly log: Logger;
  private stream: MediaStream | null = null;
  private meter: Meter | null = null;
  private muted = true;
  private pushed = false;
  private seq = 0;

  constructor(devices: MediaDevicesProvider, audio: AudioContextProvider, log: Logger) {
    this.devices = devices;
    this.audio = audio;
    this.log = log;
  }

  get track(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  /** The meter's copy of the input: always enabled, even while muted (mic test recordings). */
  get monitorStream(): MediaStream | null {
    return this.meter?.stream ?? null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Others hear us right now (live and unmuted, or push-to-talk held). */
  get transmitting(): boolean {
    return this.state === 'live' && (!this.muted || this.pushed);
  }

  /** Asks for the microphone (shows the browser prompt the first time). */
  async start(deviceId: string | null = this.deviceId): Promise<MicState> {
    if (!this.devices.supported) return this.setState('unavailable');
    const seq = ++this.seq;
    this.setState('starting');
    try {
      const stream = await this.devices.getMicrophone({ deviceId, ...this.processing });
      if (seq !== this.seq) {
        for (const t of stream.getTracks()) t.stop();
        return this.state;
      }
      this.deviceId = deviceId;
      this.adopt(stream);
      return this.setState('live');
    } catch (err: unknown) {
      if (seq !== this.seq) return this.state;
      const reason = err instanceof CaptureError ? err.reason : 'failed';
      // A remembered device that is gone: fall back to the system default.
      if (reason === 'no-device' && deviceId !== null) return this.start(null);
      this.log.warn('microphone failed', errorMessage(err));
      if (reason === 'denied' || reason === 'cancelled') return this.setState('denied');
      return this.setState(reason === 'failed' ? 'failed' : 'unavailable');
    }
  }

  stop(): void {
    this.seq++;
    this.release();
    this.events.emit('track', { track: null });
    this.setState('off');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyEnabled();
  }

  setPushToTalk(down: boolean): void {
    this.pushed = down;
    this.applyEnabled();
  }

  /** Restarts capture with new processing options (keeps the device). */
  async setProcessing(p: MicProcessing): Promise<void> {
    this.processing = { ...p };
    if (this.state === 'live') await this.start(this.deviceId);
  }

  /** Measures the input level once per frame (works while muted). */
  update(dt: number): void {
    const m = this.meter;
    if (!m) {
      this.detector.update(0, dt);
      return;
    }
    m.analyser.getFloatTimeDomainData(m.buf);
    this.detector.update(rms(m.buf), dt);
  }

  dispose(): void {
    this.stop();
    this.events.clear();
  }

  private adopt(stream: MediaStream): void {
    this.release();
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      // Unplugged device: try the default one.
      track.addEventListener(
        'ended',
        () => {
          if (this.stream === stream) void this.start(null);
        },
        { once: true },
      );
    }
    this.applyEnabled();
    this.meter = this.createMeter(stream);
    this.events.emit('track', { track: this.track });
  }

  private createMeter(stream: MediaStream): Meter | null {
    try {
      const ctx = this.audio.get();
      const clone = stream.clone();
      // A clone copies `enabled`: muting disabled the original first, so the meter (which must
      // keep listening while muted) would only ever hear silence.
      for (const t of clone.getAudioTracks()) t.enabled = true;
      const input = ctx.createMediaStreamSource(clone);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      input.connect(analyser);
      return { stream: clone, input, analyser, buf: new Float32Array(analyser.fftSize) };
    } catch (err: unknown) {
      this.log.warn('mic meter unavailable', errorMessage(err));
      return null;
    }
  }

  private release(): void {
    if (this.meter) {
      this.meter.input.disconnect();
      for (const t of this.meter.stream.getTracks()) t.stop();
      this.meter = null;
    }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.detector.reset();
  }

  private applyEnabled(): void {
    const track = this.track;
    if (track) track.enabled = !this.muted || this.pushed;
  }

  private setState(state: MicState): MicState {
    if (this.state !== state) {
      this.state = state;
      this.events.emit('state', { state });
    }
    return state;
  }
}
