import type { Unsubscribe } from '@huddle/shared';

export type CaptureFailure = 'denied' | 'cancelled' | 'unsupported' | 'no-device' | 'failed';

/** Typed error thrown by capture providers so the UI can show the right message. */
export class CaptureError extends Error {
  override name = 'CaptureError';
  readonly reason: CaptureFailure;
  constructor(reason: CaptureFailure, message?: string) {
    super(message ?? reason);
    this.reason = reason;
  }
}

export interface ScreenCaptureOptions {
  audio: boolean;
  width: number;
  height: number;
  frameRate: number;
  maxFrameRate: number;
}

export type CaptureSurface = 'monitor' | 'window' | 'browser' | 'unknown';

export interface ScreenCaptureResult {
  stream: MediaStream;
  surface: CaptureSurface;
  hasAudio: boolean;
  /** True when the capture may contain this app itself (hall-of-mirrors risk). */
  mayIncludeSelf: boolean;
}

/**
 * Screen capture. The web implementation uses `getDisplayMedia`; native shells can replace it,
 * e.g. Rust capture feeding frames into a `MediaStreamTrack` via canvas or `VideoFrame`.
 */
export interface ScreenCaptureProvider {
  readonly supported: boolean;
  readonly supportsSystemAudio: boolean;
  capture(options: ScreenCaptureOptions): Promise<ScreenCaptureResult>;
}

export interface MediaDeviceEntry {
  id: string;
  label: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
}

export interface MicrophoneConstraints {
  deviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface CameraConstraints {
  deviceId: string | null;
  width: number;
  height: number;
  frameRate: number;
}

export interface MediaDevicesProvider {
  readonly supported: boolean;
  list(): Promise<MediaDeviceEntry[]>;
  getMicrophone(constraints: MicrophoneConstraints): Promise<MediaStream>;
  getCamera(constraints: CameraConstraints): Promise<MediaStream>;
  onDeviceChange(callback: () => void): Unsubscribe;
}

export interface AudioContextProvider {
  /** Lazily creates the shared AudioContext. */
  get(): AudioContext;
  /** Must be called from a user gesture (e.g. the lobby Join button). */
  resume(): Promise<void>;
  isRunning(): boolean;
  onStateChange(callback: (running: boolean) => void): Unsubscribe;
  /** Routes the context output to a device when supported (`AudioContext.setSinkId`). */
  setOutputDevice(deviceId: string): Promise<boolean>;
}

/** Records short audio clips: the lobby's "hear yourself" mic test. */
export interface AudioClipRecorder {
  readonly supported: boolean;
  /**
   * Records `stream` for `ms` milliseconds (less if `signal` aborts) and resolves with the
   * encoded clip. Rejects with a `CaptureError` when recording is impossible.
   */
  record(stream: MediaStream, ms: number, signal?: AbortSignal): Promise<Blob>;
}

export interface PeerConnectionFactory {
  readonly supported: boolean;
  create(config: RTCConfiguration): RTCPeerConnection;
}

export interface AudioSink {
  dispose(): void;
}

/**
 * Creates media elements. Keeps DOM element creation inside the platform layer and hides
 * browser quirks such as Chromium requiring remote WebRTC audio to be attached to a (muted)
 * media element before Web Audio receives samples.
 */
export interface MediaElementFactory {
  createVideo(stream: MediaStream | null, options: { muted: boolean }): HTMLVideoElement;
  releaseVideo(video: HTMLVideoElement): void;
  attachAudioSink(stream: MediaStream): AudioSink;
}
