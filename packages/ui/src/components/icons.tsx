import { REACTION_EMOJIS } from '@huddle/shared';
import type { ReactNode } from 'react';

/** One consistent line icon set: 24px grid, 1.75 stroke, round caps (original drawings). */
const PATHS = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  micOff: (
    <path d="M15 9.4V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5.5 11a6.5 6.5 0 0 0 10.6 5M18.4 12.6c.07-.5.1-1 .1-1.6M12 17.5V21M3.5 3.5l17 17" />
  ),
  headphones: (
    <>
      <path d="M4 14.5V12a8 8 0 0 1 16 0v2.5" />
      <rect x="3.5" y="13.5" width="4.5" height="7" rx="2" />
      <rect x="16" y="13.5" width="4.5" height="7" rx="2" />
    </>
  ),
  headphonesOff: (
    <>
      <path d="M4 14.5V12a8 8 0 0 1 13.4-5.9M19.6 9.5c.3.8.4 1.6.4 2.5v2.5" />
      <rect x="3.5" y="13.5" width="4.5" height="7" rx="2" />
      <path d="M16 15.5v3a2 2 0 0 0 2 2h.5a2 2 0 0 0 2-2v-3M3 3l18 18" />
    </>
  ),
  hand: (
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V12m0-4a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.9-2.6L4.6 14.8a1.5 1.5 0 0 1 2.4-1.8L8 14.4" />
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  /** Party popper: the playful things (throw, hold up, signs). */
  play: (
    <path d="M4 20 8.6 7.8l7.6 7.6ZM7 12.5l4.5 4.5M13 4.2c.6 1.6.2 3.2-1 4.1M19.8 11c-1.6-.6-3.2-.2-4.1 1M16 3.5h.01M20.5 7.5h.01M20.5 16h.01" />
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2.5" />
      <path d="M8.5 20h7M12 16.5V20M12 13V7.5M9.5 10 12 7.5l2.5 2.5" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M7.5 20.5l1.8-4M16.5 20.5l-1.8-4M7 12.5c2-3 3.5 1 5.5-2s3 0 4.5-1.5" />
    </>
  ),
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" />,
  leave: (
    <path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10M15 7.5l4.5 4.5-4.5 4.5M19.5 12H9" />
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.6M17.5 14.5a5 5 0 0 1 3 5" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20" />
      <circle cx="15" cy="7.5" r="2.5" />
      <circle cx="9" cy="16.5" r="2.5" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
      <path d="M15.5 8.5v-2A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" />
    </>
  ),
  chevronDown: <path d="M6.5 9.5 12 15l5.5-5.5" />,
  chevronRight: <path d="M9.5 6.5 15 12l-5.5 5.5" />,
  chevronLeft: <path d="M14.5 6.5 9 12l5.5 5.5" />,
  arrowLeft: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  send: <path d="M20.5 3.5 10.6 13.4M20.5 3.5l-6 17-3.9-7.1L3.5 9.5Z" />,
  expand: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  collapse: <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />,
  fill: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M7.5 12h9M7.5 12l2-2M7.5 12l2 2M16.5 12l-2-2M16.5 12l-2 2" />
    </>
  ),
  volume: <path d="M4 9.5h3l4.5-4v13L7 14.5H4ZM15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  volumeOff: <path d="M4 9.5h3l4.5-4v13L7 14.5H4ZM16 9.5l5 5M21 9.5l-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  pen: <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5ZM13.5 7l3 3" />,
  marker: <path d="M5 19.5 3.5 21l1.8-4.2L14 8l2 2-8.7 8.7ZM14 8l3-3 2 2-3 3" />,
  eraser: (
    <path d="M8.5 20H20M4.3 14.7 13.8 5.2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 20H8.3l-4-4a1 1 0 0 1 0-1.3ZM9 10l5 5" />
  ),
  trash: <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  shirt: (
    <path d="M8 4 3.5 6.5 5 11l2-.8V20h10v-9.8l2 .8 1.5-4.5L16 4c-.5 1.5-2 2.5-4 2.5S8.5 5.5 8 4Z" />
  ),
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="9.5" ry="4.5" />
      <circle cx="12" cy="12" r="2.2" />
    </>
  ),
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  broom: (
    <path d="M14 4.5 19.5 10M12.5 7.5l4 4-5.5 8.5c-2.5.5-6.5-1-8-4.5ZM7 14l3 3M9 12l1.5 1.5" />
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  crown: <path d="M4 8.5l4 3.5 4-6 4 6 4-3.5-1.5 10h-13Z" />,
  shuffle: (
    <path d="M3 7h3.5c5 0 6 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.8 0 3-1.3 4-3M13.5 10c1-1.7 2.2-3 4-3H21M18 4l3 3-3 3" />
  ),
  bulb: (
    <path d="M9 17.5h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z" />
  ),
  camera: (
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  arrowRight: <path d="M5 12h13.5M13 6l6 6-6 6" />,
  /** Ear: the "hear yourself" mic test. */
  ear: (
    <path d="M7 9.5a5 5 0 0 1 10 0c0 2.6-1.6 3.6-2.6 4.6-1 1-.9 2.4-1.9 3.9a3 3 0 0 1-5.2-.6M10 9.8a2 2 0 0 1 4 0c0 .9-.5 1.3-1 1.7" />
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
    </>
  ),
  /** The AI office-mates (solo practice). */
  sparkle: (
    <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5ZM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): ReactNode {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Emoji faces for the throwables (kind ids match the engine's). */
export const THROW_ICONS: readonly { kind: string; emoji: string }[] = [
  { kind: 'paper', emoji: '📄' },
  { kind: 'plane', emoji: '✈️' },
  { kind: 'tomato', emoji: '🍅' },
  { kind: 'duck', emoji: '🦆' },
  { kind: 'confetti', emoji: '🎉' },
  { kind: 'heart', emoji: '💖' },
];

export const EMOTES: readonly { id: string; emoji: string }[] = [
  { id: 'wave', emoji: '👋' },
  { id: 'clap', emoji: '👏' },
  { id: 'cheer', emoji: '🙌' },
  { id: 'thumbsUp', emoji: '👍' },
  { id: 'laugh', emoji: '😂' },
  { id: 'dance', emoji: '💃' },
  { id: 'bow', emoji: '🙇' },
  { id: 'nod', emoji: '😌' },
  { id: 'headShake', emoji: '🙅' },
  { id: 'think', emoji: '🤔' },
  { id: 'shrug', emoji: '🤷' },
  { id: 'facepalm', emoji: '🤦' },
];

/** The quick reactions are part of the protocol (the server only relays these). */
export const REACTIONS: readonly string[] = REACTION_EMOJIS;

/** How held items look in the HUD (signs show their glyph, like the real board). */
export const HELD_ICONS: Readonly<Record<string, { glyph: string; sign?: true }>> = {
  mug: { glyph: '☕' },
  water: { glyph: '🥤' },
  pizza: { glyph: '🍕' },
  phone: { glyph: '📱' },
  plane: { glyph: '✈️' },
  signPlus: { glyph: '+1', sign: true },
  signAsk: { glyph: '?', sign: true },
  signBrb: { glyph: 'BRB', sign: true },
  signLove: { glyph: '♥', sign: true },
};

/** A held item's face: an emoji, or the sign's glyph on a little board. */
export function HeldGlyph({ item }: { item: string }): ReactNode {
  const icon = HELD_ICONS[item] ?? { glyph: '?' };
  return (
    <span className={icon.sign ? 'held-glyph held-glyph--sign' : 'held-glyph'} aria-hidden="true">
      {icon.glyph}
    </span>
  );
}
