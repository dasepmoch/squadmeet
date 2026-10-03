/** HUD view state for voice and screen sharing (part of `HudState`). */

export type MicStateUi = 'off' | 'starting' | 'live' | 'denied' | 'unavailable' | 'failed';

export interface DeviceUi {
  id: string;
  label: string;
}

export interface MicProcessingUi {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface VoiceUi extends MicProcessingUi {
  mic: MicStateUi;
  muted: boolean;
  deafened: boolean;
  /** Push-to-talk is held. */
  talking: boolean;
  /** Others hear you and you are speaking. */
  speaking: boolean;
  /** You are speaking while muted (shows a hint). */
  mutedSpeaking: boolean;
  /** Input level 0..1 for the mic test meter, sampled a few times a second. */
  level: number;
  inputs: DeviceUi[];
  outputs: DeviceUi[];
  inputId: string | null;
  outputId: string | null;
  /** The browser can play audio on another output device. */
  outputSupported: boolean;
  /** You are beyond the room's mesh cap: no voice or screen for you. */
  overCap: boolean;
  /** "Hear yourself": a few seconds are recorded, then played back. */
  echo: EchoTestUi;
  /** The browser can record clips (the echo test is offered). */
  echoSupported: boolean;
}

export type EchoTestUi = 'idle' | 'recording' | 'playing';

/** How long "hear yourself" records before it plays back. */
export const ECHO_TEST_MS = 3500;

export const INITIAL_VOICE: VoiceUi = {
  mic: 'off',
  muted: true,
  deafened: false,
  talking: false,
  speaking: false,
  mutedSpeaking: false,
  level: 0,
  inputs: [],
  outputs: [],
  inputId: null,
  outputId: null,
  outputSupported: false,
  overCap: false,
  echo: 'idle',
  echoSupported: false,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Who holds the big screen. */
export interface PresenterUi {
  id: string;
  name: string;
  self: boolean;
}

/** Someone asked the presenter for the screen. */
export interface PresentRequestUi {
  id: string;
  name: string;
}

/** Slides and text stay sharp; video stays smooth. */
export type ShareHintUi = 'detail' | 'motion';

export type VoiceModeUi = 'global' | 'proximity' | 'zones';
