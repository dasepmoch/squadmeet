export type HostPlatform = 'web' | 'tauri-desktop' | 'tauri-mobile' | 'capacitor';
export type HostOs = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'unknown';
export type HostBrowser = 'chromium' | 'firefox' | 'safari' | 'unknown';

/**
 * Computed once at boot. Features and UI read these flags and degrade gracefully
 * (e.g. viewer-only screen share on iOS, listen-only without a microphone).
 */
export interface Capabilities {
  readonly platform: HostPlatform;
  readonly os: HostOs;
  readonly browser: HostBrowser;
  readonly mobile: boolean;
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly webrtc: boolean;
  readonly getUserMedia: boolean;
  readonly getDisplayMedia: boolean;
  /** Chromium-only `systemAudio` hint for display capture. */
  readonly systemAudioCapture: boolean;
  readonly pointerLock: boolean;
  readonly gamepad: boolean;
  readonly touch: boolean;
  readonly fullscreen: boolean;
  /** `HTMLVideoElement.requestVideoFrameCallback` for efficient video textures. */
  readonly videoFrameCallback: boolean;
  readonly audioOutputSelection: boolean;
  readonly share: boolean;
  readonly clipboard: boolean;
  readonly vibration: boolean;
  readonly notifications: boolean;
  readonly reducedMotion: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
}

export type CapabilityKey = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never;
}[keyof Capabilities];

/** Human-readable list of missing hard requirements; empty means the app can run. */
export function missingRequirements(caps: Capabilities): string[] {
  const missing: string[] = [];
  if (!caps.webgl2) missing.push('webgl2');
  return missing;
}
