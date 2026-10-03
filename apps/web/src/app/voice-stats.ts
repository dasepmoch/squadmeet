import type { LinkStats, MediaTransport, SpatialAudio } from '@huddle/rtc';
import type { HudStore } from '@huddle/ui';

/** Snapshot for tests and the console. */
export interface VoiceDebug {
  mic: string;
  muted: boolean;
  transmitting: boolean;
  overCap: boolean;
  peers: { id: string; state: string; inKbps: number; outKbps: number }[];
  /** Who we hear (and the screen), with their current level. */
  sources: { id: string; level: number; speaking: boolean }[];
}

/** Per-peer links and every audio source we hear (`VoiceSession.debugState`). */
export async function voiceDebugState(
  transport: MediaTransport | null,
  audio: SpatialAudio,
  base: Pick<VoiceDebug, 'mic' | 'muted' | 'transmitting' | 'overCap'>,
): Promise<VoiceDebug> {
  const stats = transport ? await transport.stats() : new Map<string, LinkStats>();
  return {
    ...base,
    peers: [...stats].map(([id, s]) => ({
      id,
      state: s.state,
      inKbps: Math.round(s.inKbps),
      outKbps: Math.round(s.outKbps),
    })),
    sources: audio.ids().map((id) => ({
      id,
      level: audio.level(id),
      speaking: audio.speaking(id),
    })),
  };
}

/**
 * The debug overlay's network numbers: packet loss, bitrate, per-peer link state and round
 * trip, and the level of everything we hear. `current` tells whether the transport is still in
 * use once the stats arrive.
 */
export async function sampleVoiceStats(
  transport: MediaTransport,
  audio: SpatialAudio,
  store: HudStore,
  nameOf: (sourceId: string) => string,
  current: () => boolean,
): Promise<void> {
  const stats = await transport.stats();
  if (!current()) return;
  let loss = 0;
  let lossCount = 0;
  let kbps = 0;
  const peers: { id: string; state: string }[] = [];
  for (const [id, s] of stats) {
    if (s.lossPct !== null) {
      loss += s.lossPct;
      lossCount++;
    }
    kbps += s.inKbps + s.outKbps;
    const rtt = s.rttMs === null ? '' : ` · ${Math.round(s.rttMs)} ms`;
    peers.push({ id: nameOf(id), state: `${s.state}${rtt}` });
  }
  const levels = audio.ids().map((id) => ({ id: nameOf(id), level: audio.level(id) }));
  store.setState((s) => ({
    debug: {
      ...s.debug,
      peers,
      audio: levels,
      packetLoss: lossCount > 0 ? loss / lossCount / 100 : null,
      bitrateKbps: stats.size > 0 ? kbps : null,
    },
  }));
}
