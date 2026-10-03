import { voiceZoneAt, type VoiceMode, type VoiceZone } from '@huddle/shared';

/** How one voice reaches the listener: at full volume, or fading with distance. */
export type VoiceRoute = 'global' | 'proximity';

/**
 * Global and proximity modes apply to everyone. In zones mode, two people inside the same
 * global zone (the meeting area) hear each other at full volume; everywhere else voices fade.
 */
export function voiceRoute(
  mode: VoiceMode,
  zones: readonly VoiceZone[],
  listener: { x: number; z: number },
  speaker: { x: number; z: number },
): VoiceRoute {
  if (mode !== 'zones') return mode;
  const a = voiceZoneAt(zones, listener.x, listener.z);
  if (!a || a.mode !== 'global') return 'proximity';
  return voiceZoneAt(zones, speaker.x, speaker.z)?.id === a.id ? 'global' : 'proximity';
}

/** Distance falloff for proximity voices (Web Audio `inverse` model). */
export const PROXIMITY = { refDistance: 1.4, rolloffFactor: 1.6, maxDistance: 40 } as const;

/** Gain of a proximity voice at `distance` meters (what the `inverse` panner applies). */
export function proximityGain(distance: number): number {
  const d = Math.min(Math.max(distance, PROXIMITY.refDistance), PROXIMITY.maxDistance);
  const { refDistance: ref, rolloffFactor: k } = PROXIMITY;
  return ref / (ref + k * (d - ref));
}
