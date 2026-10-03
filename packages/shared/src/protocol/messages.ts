import { z } from 'zod';
import { NET } from '../constants.ts';
import { iceServerSchema, signalDataSchema, VOICE_MODES } from './media.ts';
import { HELD_ITEMS } from './play.ts';

/** Things people can throw at each other (all harmless and silly). */
export const THROW_KINDS = ['paper', 'plane', 'tomato', 'duck', 'confetti', 'heart'] as const;
export type ThrowKind = (typeof THROW_KINDS)[number];

export function isThrowKind(v: string): v is ThrowKind {
  return (THROW_KINDS as readonly string[]).includes(v);
}

/**
 * Serious: reactions and hand-raise only. Casual: everything. Party: everything plus effects.
 * The host can switch at any time and can lock throwables separately.
 */
export const ROOM_MODES = ['serious', 'casual', 'party'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

/** Quick emoji reactions that float over someone's head (the only emoji the server relays). */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🔥', '💯'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const ERROR_CODES = [
  'version',
  'full',
  'passcode',
  'invalid',
  'rate',
  'kicked',
  'forbidden',
  'notJoined',
  /** Someone else holds the presenter slot. */
  'busy',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const coord = z.number().min(-1e4).max(1e4);
const vec3 = z.object({ x: coord, y: coord, z: coord });
const playerId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const seatId = z.string().min(1).max(64);
const name = z.string().max(64);
const avatar = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/);
const actionId = z.string().regex(/^[A-Za-z]{1,24}$/);
const throwKind = z.enum(THROW_KINDS);
const roomMode = z.enum(ROOM_MODES);
const voiceMode = z.enum(VOICE_MODES);
const time = z.number().min(0).max(1e15);
/** Per-thrower throw number (wraps at 65536): names one thrown object across clients. */
const throwSeq = z.number().int().min(0).max(65535);
/** Paper-plane wing tilt at release, -1 (bank left) .. 1 (bank right). */
const tilt = z.number().min(-1).max(1);
const heldItem = z.enum(HELD_ITEMS);
/** A hoop is named by its prop id. */
const hoopId = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** Room codes are 4-8 characters, A-Z and 0-9 (normalize user input with `normalizeRoomCode`). */
export const roomCodeSchema = z.string().regex(/^[A-Z0-9]{4,8}$/);
const resumeToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

const hostCommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('mode'), mode: roomMode }),
  z.object({ op: z.literal('lockThrows'), locked: z.boolean() }),
  z.object({ op: z.literal('kick'), target: playerId }),
  z.object({ op: z.literal('lowerHand'), target: playerId }),
  z.object({ op: z.literal('transfer'), target: playerId }),
  z.object({ op: z.literal('voiceMode'), mode: voiceMode }),
  /** Asks everyone else to mute (clients comply; it cannot force a microphone off). */
  z.object({ op: z.literal('muteAll') }),
  /** Ends whoever is presenting. */
  z.object({ op: z.literal('stopShare') }),
  /** Mops up every splat and thrown object for everyone. */
  z.object({ op: z.literal('clean') }),
  /** Puts every basketball score back to zero. */
  z.object({ op: z.literal('resetScores') }),
]);
export type HostCommand = z.infer<typeof hostCommandSchema>;

/** Everything a client may send as a JSON text frame. Movement travels as binary `MOVE`. */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    /** Room to join; null asks the server for a fresh room (the joiner becomes host). */
    room: roomCodeSchema.nullable(),
    name,
    avatar,
    /** Sets the passcode of a new room, or unlocks an existing one. */
    passcode: z.string().max(64).optional(),
    resume: z.object({ id: playerId, token: resumeToken }).optional(),
  }),
  z.object({ t: z.literal('ping'), c: z.number() }),
  z.object({ t: z.literal('chat'), text: z.string().max(NET.maxChatLength * 2) }),
  z.object({ t: z.literal('act'), action: actionId }),
  z.object({ t: z.literal('react'), emoji: z.enum(REACTION_EMOJIS) }),
  z.object({ t: z.literal('hand'), raised: z.boolean() }),
  z.object({ t: z.literal('sit'), seat: seatId }),
  z.object({ t: z.literal('stand') }),
  z.object({
    t: z.literal('throw'),
    kind: throwKind,
    from: vec3,
    to: vec3,
    target: playerId.nullable(),
    n: throwSeq,
    tilt: tilt.optional(),
  }),
  /** The thrower's client decides hits (it saw throw `n` land on someone) and reports them. */
  z.object({ t: z.literal('hit'), n: throwSeq, target: playerId }),
  /** Throw `n` dropped through a hoop (the thrower's client saw it). */
  z.object({ t: z.literal('score'), n: throwSeq, hoop: hoopId }),
  /** What you hold in your hand now (null: empty hands). */
  z.object({ t: z.literal('hold'), item: heldItem.nullable() }),
  /** You picked up someone's landed paper plane (`owner`'s throw `n`). */
  z.object({ t: z.literal('pickup'), owner: playerId, n: throwSeq }),
  /** "Don't hit me": thrown things pass through you (and you don't throw). */
  z.object({ t: z.literal('shield'), on: z.boolean() }),
  z.object({ t: z.literal('profile'), name: name.optional(), avatar: avatar.optional() }),
  z.object({ t: z.literal('host'), cmd: hostCommandSchema }),
  /** WebRTC signaling for one peer (relayed only between media peers of the same room). */
  z.object({ t: z.literal('signal'), to: playerId, data: signalDataSchema }),
  z.object({ t: z.literal('voice'), muted: z.boolean(), deafened: z.boolean() }),
  /** Claims (or gives back) the presenter slot. While busy, the presenter is asked to hand over. */
  z.object({ t: z.literal('present'), on: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const playerInfoSchema = z.object({
  id: playerId,
  /** Small number naming this player in binary snapshots. */
  slot: z.number().int().min(0).max(65535),
  name,
  avatar,
  /** Disconnected but still inside the resume grace window. */
  away: z.boolean(),
  seat: seatId.nullable(),
  /** Server time the hand went up, or null. */
  hand: time.nullable(),
  pos: vec3,
  yaw: z.number(),
  muted: z.boolean(),
  deafened: z.boolean(),
  /** Server time this person joined (orders mesh media peers, see `mediaPeers`). */
  since: time,
  held: heldItem.nullable(),
  /** "Don't hit me" is on. */
  shield: z.boolean(),
  /** Basketball points in this room. */
  points: z.number().int().min(0),
});
export type PlayerInfo = z.infer<typeof playerInfoSchema>;

export const roomInfoSchema = z.object({
  code: roomCodeSchema,
  map: z.string().max(40),
  mode: roomMode,
  throwsLocked: z.boolean(),
  host: playerId.nullable(),
  capacity: z.number().int().min(1),
  locked: z.boolean(),
  voice: voiceMode,
  /** Who holds the big screen, or null. */
  presenter: playerId.nullable(),
  /** How many people exchange voice and screen in the mesh (see `mediaPeers`). */
  meshCap: z.number().int().min(2).max(64),
});
export type RoomInfo = z.infer<typeof roomInfoSchema>;

export const chatLineSchema = z.object({
  /** Per-room sequence number. */
  n: z.number().int().min(0),
  from: playerId,
  name,
  text: z.string().max(NET.maxChatLength),
  at: time,
});
export type ChatLine = z.infer<typeof chatLineSchema>;

/** Everything the server sends as a JSON text frame. Positions travel as binary `SNAPSHOT`. */
export const serverMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('welcome'),
    v: z.number().int(),
    self: playerId,
    slot: z.number().int(),
    /** Secret for resuming this session after a dropped connection. */
    token: resumeToken,
    resumed: z.boolean(),
    room: roomInfoSchema,
    players: z.array(playerInfoSchema),
    chat: z.array(chatLineSchema),
    now: time,
    /** STUN/TURN servers for WebRTC (TURN credentials are short-lived and per person). */
    ice: z.array(iceServerSchema).max(8),
  }),
  z.object({ t: z.literal('joined'), player: playerInfoSchema }),
  z.object({
    t: z.literal('left'),
    id: playerId,
    reason: z.enum(['leave', 'timeout', 'kick']),
  }),
  z.object({ t: z.literal('away'), id: playerId, away: z.boolean() }),
  z.object({ t: z.literal('profile'), id: playerId, name, avatar }),
  z.object({ t: z.literal('seat'), seat: seatId, id: playerId.nullable() }),
  z.object({ t: z.literal('seatDenied'), seat: seatId }),
  z.object({ t: z.literal('chat'), line: chatLineSchema }),
  z.object({ t: z.literal('act'), id: playerId, action: actionId }),
  z.object({ t: z.literal('react'), id: playerId, emoji: z.enum(REACTION_EMOJIS) }),
  z.object({ t: z.literal('hand'), id: playerId, raised: z.boolean(), at: time }),
  z.object({
    t: z.literal('throw'),
    id: playerId,
    kind: throwKind,
    from: vec3,
    to: vec3,
    target: playerId.nullable(),
    n: throwSeq,
    tilt,
  }),
  z.object({ t: z.literal('hit'), id: playerId, kind: throwKind, target: playerId }),
  /** A basket: `points` (2 or 3) for `id`, whose room total is now `total`. */
  z.object({
    t: z.literal('score'),
    id: playerId,
    hoop: hoopId,
    points: z.number().int().min(1).max(3),
    total: z.number().int().min(0),
  }),
  z.object({ t: z.literal('hold'), id: playerId, item: heldItem.nullable() }),
  z.object({ t: z.literal('pickup'), id: playerId, owner: playerId, n: throwSeq }),
  z.object({ t: z.literal('shield'), id: playerId, on: z.boolean() }),
  /** The host mopped the room: splats and thrown objects go away for everyone. */
  z.object({ t: z.literal('clean'), by: playerId }),
  /** The host reset the basketball scores. */
  z.object({ t: z.literal('scoreReset'), by: playerId }),
  z.object({ t: z.literal('room'), room: roomInfoSchema }),
  z.object({ t: z.literal('pong'), c: z.number(), s: time }),
  z.object({ t: z.literal('signal'), from: playerId, data: signalDataSchema }),
  z.object({ t: z.literal('voice'), id: playerId, muted: z.boolean(), deafened: z.boolean() }),
  /** To the presenter: someone would like the big screen. */
  z.object({ t: z.literal('presentRequest'), from: playerId }),
  /** The host asked everyone to mute. */
  z.object({ t: z.literal('muteRequest'), by: playerId }),
  /** Fresh TURN credentials before the previous ones expire. */
  z.object({ t: z.literal('ice'), servers: z.array(iceServerSchema).max(8) }),
  z.object({
    t: z.literal('error'),
    code: z.enum(ERROR_CODES),
    message: z.string().max(200).optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  if (text.length > NET.maxMessageBytes) return { ok: false, error: 'too large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'bad json' };
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.message };
}

export function parseClientMessage(text: string): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, text);
}

export function parseServerMessage(text: string): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, text);
}

/** JSON text frame for a message (both directions). */
export function encodeMessage(m: ClientMessage | ServerMessage): string {
  return JSON.stringify(m);
}
