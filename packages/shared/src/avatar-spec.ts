/**
 * Compact avatar description (< 64 bytes). Every client rebuilds the same sculpted avatar from
 * it. Encoded as a fixed byte layout; decoding clamps each field so any input is safe.
 */
export const AVATAR_FIELDS = {
  /** slim, regular, athletic, soft */
  bodyType: 4,
  height: 9,
  skinTone: 12,
  /** round, oval, heart, square */
  faceShape: 4,
  /** round, almond, sleepy, bright */
  eyeStyle: 4,
  eyeColor: 8,
  /** soft, arched, straight, bold */
  browStyle: 4,
  /** smile, calm, grin, smirk */
  mouthStyle: 4,
  /** button, straight, round */
  noseStyle: 3,
  freckles: 2,
  /** bald, buzz, crop, side part, quiff, bob, long, curls, bun, ponytail, waves, pixie */
  hairStyle: 12,
  hairColor: 14,
  /** none, stubble, mustache, goatee, beard */
  facialHair: 5,
  /** none, beanie, cap, headband, headphones, bucket hat */
  headwear: 6,
  headwearColor: 16,
  /** none, round, rectangle, cat-eye, aviator, sunglasses */
  glasses: 6,
  /** tee, hoodie, sweater, blazer, polo, turtleneck */
  topStyle: 6,
  topColor: 16,
  /** none, stripes, dots, check, color block */
  topPattern: 5,
  patternColor: 16,
  /** jeans, chinos, skirt, shorts, joggers */
  bottomStyle: 5,
  bottomColor: 16,
  /** sneakers, boots, loafers, high-tops */
  shoeStyle: 4,
  shoeColor: 16,
  /** none, lanyard, neck headphones, scarf, watch, necklace */
  accessory: 6,
  accessoryColor: 16,
} as const;

export type AvatarField = keyof typeof AVATAR_FIELDS;
export type AvatarSpec = Record<AvatarField, number>;

const FIELD_ORDER = Object.keys(AVATAR_FIELDS) as AvatarField[];
const SPEC_VERSION = 2;

export const DEFAULT_AVATAR: AvatarSpec = {
  bodyType: 1,
  height: 4,
  skinTone: 4,
  faceShape: 0,
  eyeStyle: 0,
  eyeColor: 1,
  browStyle: 0,
  mouthStyle: 0,
  noseStyle: 0,
  freckles: 0,
  hairStyle: 3,
  hairColor: 1,
  facialHair: 0,
  headwear: 0,
  headwearColor: 0,
  glasses: 0,
  topStyle: 1,
  topColor: 0,
  topPattern: 0,
  patternColor: 2,
  bottomStyle: 0,
  bottomColor: 14,
  shoeStyle: 0,
  shoeColor: 2,
  accessory: 1,
  accessoryColor: 3,
};

export function clampSpec(input: Partial<Record<string, unknown>>): AvatarSpec {
  const out = { ...DEFAULT_AVATAR };
  for (const field of FIELD_ORDER) {
    const v = input[field];
    if (typeof v === 'number' && Number.isInteger(v)) {
      out[field] = Math.min(AVATAR_FIELDS[field] - 1, Math.max(0, v));
    }
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) =>
      i + k < text.length ? B64.indexOf(text[i + k] as string) : 0,
    );
    const n = ((c[0] ?? 0) << 18) | ((c[1] ?? 0) << 12) | ((c[2] ?? 0) << 6) | (c[3] ?? 0);
    bytes.push((n >> 16) & 255);
    if (i + 2 < text.length) bytes.push((n >> 8) & 255);
    if (i + 3 < text.length) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}

export function encodeAvatar(spec: AvatarSpec): string {
  const bytes = new Uint8Array(FIELD_ORDER.length + 1);
  bytes[0] = SPEC_VERSION;
  FIELD_ORDER.forEach((field, i) => {
    bytes[i + 1] = Math.min(AVATAR_FIELDS[field] - 1, Math.max(0, spec[field] | 0));
  });
  return toBase64Url(bytes);
}

/** Decodes a spec; unknown versions or malformed input fall back to the default avatar. */
export function decodeAvatar(encoded: string): AvatarSpec {
  if (encoded.length > 64) return { ...DEFAULT_AVATAR };
  const bytes = fromBase64Url(encoded);
  if (!bytes || bytes[0] !== SPEC_VERSION) return { ...DEFAULT_AVATAR };
  const raw: Record<string, number> = {};
  FIELD_ORDER.forEach((field, i) => {
    const v = bytes[i + 1];
    if (v !== undefined) raw[field] = v;
  });
  return clampSpec(raw);
}

/** Byte size of an encoded spec (for the < 64 bytes budget). */
export const AVATAR_SPEC_BYTES = FIELD_ORDER.length + 1;

/** Deterministic pseudo-random avatar, handy for bots and "shuffle" in the customizer. */
export function randomAvatar(random: () => number): AvatarSpec {
  const out = { ...DEFAULT_AVATAR };
  for (const field of FIELD_ORDER) out[field] = Math.floor(random() * AVATAR_FIELDS[field]);
  // Keep the crowd believable: most people wear no hat, fewer patterns, beards only sometimes.
  if (random() < 0.7) out.headwear = 0;
  if (random() < 0.55) out.glasses = 0;
  if (random() < 0.45) out.topPattern = 0;
  if (random() < 0.6) out.facialHair = 0;
  if (random() < 0.4) out.accessory = 0;
  if (out.hairStyle === 0 && random() < 0.7) out.hairStyle = 2;
  return out;
}
