import { z } from 'zod';

/**
 * global: everyone hears everyone at full volume. proximity: voices fade with distance.
 * zones (default): global inside the room's global zones (the meeting area), proximity elsewhere.
 */
export const VOICE_MODES = ['global', 'proximity', 'zones'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

/** Media stream ids as browsers generate them (UUIDs, Firefox wraps them in braces). */
const streamId = z.string().regex(/^[A-Za-z0-9{}_-]{1,64}$/);

/**
 * One WebRTC signaling message between two peers, relayed by the server: a session description,
 * an ICE candidate (null = end of candidates), and/or which of the sender's streams carries what.
 */
export const signalDataSchema = z.object({
  description: z
    .object({
      type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
      sdp: z.string().max(40_000).optional(),
    })
    .optional(),
  candidate: z
    .object({
      candidate: z.string().max(1024),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    })
    .nullable()
    .optional(),
  streams: z.object({ mic: streamId.nullable(), screen: streamId.nullable() }).optional(),
});
export type SignalData = z.infer<typeof signalDataSchema>;

export const iceServerSchema = z.object({
  urls: z.array(z.string().max(256)).min(1).max(8),
  username: z.string().max(256).optional(),
  credential: z.string().max(256).optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

/**
 * Who exchanges media in a mesh: the `cap` longest-present people (join time, then id). Upload
 * grows with every viewer, so bigger rooms need an SFU. Server and clients use the same rule, so
 * both ends agree on who connects to whom without extra messages.
 */
export function mediaPeers(
  people: Iterable<{ id: string; since: number }>,
  cap: number,
): Set<string> {
  const sorted = [...people].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  return new Set(sorted.slice(0, Math.max(0, cap)).map((p) => p.id));
}
