/**
 * Rules of the playful layer that client and server share: what people can hold, which gestures
 * Serious mode allows, and how baskets score.
 */

/** Things people can hold in a hand; everyone sees them. */
export const HELD_ITEMS = [
  'mug',
  'water',
  'pizza',
  'phone',
  'plane',
  'signPlus',
  'signAsk',
  'signBrb',
  'signLove',
] as const;
export type HeldItem = (typeof HELD_ITEMS)[number];

/** Hand-held signs (a big glyph on a board, raised to answer without speaking). */
export const SIGN_ITEMS = ['signPlus', 'signAsk', 'signBrb', 'signLove'] as const;
export type SignItem = (typeof SIGN_ITEMS)[number];

export function isHeldItem(value: string): value is HeldItem {
  return (HELD_ITEMS as readonly string[]).includes(value);
}

export function isSignItem(value: string): value is SignItem {
  return (SIGN_ITEMS as readonly string[]).includes(value);
}

/** The upper-body action that uses a held item (null: it has no use; a plane is thrown). */
export const ITEM_USE: Readonly<Record<HeldItem, string | null>> = {
  mug: 'sip',
  water: 'sip',
  pizza: 'eat',
  phone: 'showPhone',
  plane: null,
  signPlus: 'signUp',
  signAsk: 'signUp',
  signBrb: 'signUp',
  signLove: 'signUp',
};

/** Bites in a pizza slice. */
export const PIZZA_BITES = 3;

/**
 * Serious mode: reactions, raised hands and quiet gestures only. Throwing is off and the
 * attention-grabbing emotes (dances, cheers, laughs) wait for Casual or Party.
 */
export const SERIOUS_ACTIONS = [
  'wave',
  'nod',
  'headShake',
  'thumbsUp',
  'clap',
  'think',
  'bow',
  'shrug',
  'sip',
  'eat',
  'showPhone',
  'signUp',
  'mop',
] as const;

/** True when an action (emote) may be shown in a room of the given mode. */
export function actionAllowed(mode: string, action: string): boolean {
  return mode !== 'serious' || (SERIOUS_ACTIONS as readonly string[]).includes(action);
}

/** Throwables that score when they drop through a hoop. */
export const SCORING_KINDS = ['paper', 'duck'] as const;

export function canScore(kind: string): boolean {
  return (SCORING_KINDS as readonly string[]).includes(kind);
}

/** A basket thrown from at least this far (meters, horizontal, from the rim) is worth three. */
export const THREE_POINT_RANGE = 4.5;

/** Points for a basket thrown from `from` into a rim centered at `rim` (XZ). */
export function basketPoints(from: { x: number; z: number }, rim: { x: number; z: number }): 2 | 3 {
  return Math.hypot(from.x - rim.x, from.z - rim.z) >= THREE_POINT_RANGE ? 3 : 2;
}

/** How long after a throw its thrower may still report a basket with it (ms). */
export const SCORE_WINDOW_MS = 6000;
