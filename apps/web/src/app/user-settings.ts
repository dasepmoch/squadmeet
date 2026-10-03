import type { KeyValueStorage } from '@huddle/platform';
import { cleanName, DEFAULT_BINDINGS, mergeBindings, type InputBindings } from '@huddle/shared';

export type QualityPref = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type LookPref = 'agx' | 'aces' | 'neutral';

export interface UserSettings {
  quality: QualityPref;
  look: LookPref;
  reducedMotion: boolean;
  locale: string | null;
  bindings: InputBindings;
  sfxVolume: number;
  /** Encoded `AvatarSpec`, or null for the default look. */
  avatar: string | null;
  name: string;
  /** Microphone and speaker device ids (null = system default). */
  micDevice: string | null;
  speakerDevice: string | null;
  micProcessing: MicProcessingPref;
  /** "Don't hit me": thrown things pass through you (and you don't throw). */
  dontHitMe: boolean;
  /** Room tone and footsteps, 0..1. */
  ambienceVolume: number;
}

export interface MicProcessingPref {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

const KEY = 'huddle.settings.v1';
const QUALITIES: readonly QualityPref[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const LOOKS: readonly LookPref[] = ['agx', 'aces', 'neutral'];
const DEFAULT_PROCESSING: MicProcessingPref = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Device ids are opaque browser strings; anything odd falls back to the default device. */
function deviceId(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : null;
}

function processing(v: unknown): MicProcessingPref {
  if (!isRecord(v)) return DEFAULT_PROCESSING;
  const flag = (k: keyof MicProcessingPref): boolean =>
    typeof v[k] === 'boolean' ? v[k] : DEFAULT_PROCESSING[k];
  return {
    echoCancellation: flag('echoCancellation'),
    noiseSuppression: flag('noiseSuppression'),
    autoGainControl: flag('autoGainControl'),
  };
}

/** Trims and bounds a display name; empty names fall back to `fallback`. */
export { cleanName };

/** Loads persisted settings, validating every field and falling back to defaults. */
export function loadUserSettings(
  storage: KeyValueStorage,
  reducedMotionDefault: boolean,
  onCorrupt: (err: unknown) => void,
): UserSettings {
  const defaults: UserSettings = {
    quality: 'auto',
    look: 'agx',
    reducedMotion: reducedMotionDefault,
    locale: null,
    bindings: DEFAULT_BINDINGS,
    sfxVolume: 0.7,
    avatar: null,
    name: '',
    micDevice: null,
    speakerDevice: null,
    micProcessing: DEFAULT_PROCESSING,
    dontHitMe: false,
    ambienceVolume: 0.5,
  };
  const raw = storage.getItem(KEY);
  if (!raw) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    onCorrupt(err);
    return defaults;
  }
  if (!isRecord(parsed)) return defaults;
  const q = parsed.quality;
  const l = parsed.look;
  const volume = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
  return {
    quality:
      typeof q === 'string' && (QUALITIES as readonly string[]).includes(q)
        ? (q as QualityPref)
        : defaults.quality,
    look:
      typeof l === 'string' && (LOOKS as readonly string[]).includes(l)
        ? (l as LookPref)
        : defaults.look,
    reducedMotion:
      typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : defaults.reducedMotion,
    locale: typeof parsed.locale === 'string' ? parsed.locale : null,
    bindings: isRecord(parsed.bindings)
      ? mergeBindings(
          DEFAULT_BINDINGS,
          parsed.bindings as Partial<Record<string, readonly string[]>>,
        )
      : DEFAULT_BINDINGS,
    sfxVolume: volume(parsed.sfxVolume, defaults.sfxVolume),
    avatar: typeof parsed.avatar === 'string' && parsed.avatar.length <= 64 ? parsed.avatar : null,
    name: typeof parsed.name === 'string' ? cleanName(parsed.name, '') : '',
    micDevice: deviceId(parsed.micDevice),
    speakerDevice: deviceId(parsed.speakerDevice),
    micProcessing: processing(parsed.micProcessing),
    dontHitMe: parsed.dontHitMe === true,
    ambienceVolume: volume(parsed.ambienceVolume, defaults.ambienceVolume),
  };
}

export function saveUserSettings(storage: KeyValueStorage, settings: UserSettings): void {
  storage.setItem(KEY, JSON.stringify(settings));
}
