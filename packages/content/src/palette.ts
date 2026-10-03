/**
 * Office palette: warm architectural neutrals, real wood and metal tones, muted designer accents
 * for upholstery, plus a few bright "fun" colors reserved for throwables and confetti.
 * Values are sRGB hex; the renderer converts to linear.
 */
export const PALETTE = {
  // Neutrals (walls, ceiling, stone)
  white: '#FFFFFF',
  offWhite: '#F2EFEA',
  linen: '#E7E1D7',
  warmGray: '#CFC8BD',
  greige: '#B3AA9C',
  stone: '#8C857B',
  graphite: '#3C3E43',
  charcoal: '#26272B',
  black: '#151518',
  // Woods
  walnut: '#5E3F2A',
  oak: '#B98E62',
  ash: '#D8C3A1',
  // Upholstery / accents
  navy: '#1E2B45',
  slate: '#4B5A6D',
  sage: '#8A9E86',
  forest: '#2E4A3B',
  terracotta: '#B8634A',
  mustard: '#C99A36',
  blush: '#DDAFA2',
  teal: '#2C7479',
  burgundy: '#672A35',
  sky: '#95BCDD',
  cream: '#EEE3CF',
  // Metals
  aluminum: '#C4C8CE',
  brass: '#C19A62',
  chrome: '#E6E8EB',
  // Light
  warmWhite: '#FFF1DE',
  neutralWhite: '#FFF8F0',
  coolWhite: '#EEF4FF',
  // Fun (throwables, confetti, UI accents)
  tomato: '#E0321C',
  duck: '#FFCC1A',
  paper: '#F6F4EF',
  orange: '#FF7A1F',
  blue: '#3070FF',
  magenta: '#FF3F8E',
  lime: '#9EE23B',
  violet: '#7C4DFF',
  yellow: '#FFD21F',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Colors used for confetti bursts and celebratory effects. */
export const CONFETTI_COLORS: readonly PaletteKey[] = [
  'orange',
  'blue',
  'magenta',
  'lime',
  'violet',
  'yellow',
  'teal',
];

export function isPaletteKey(value: string): value is PaletteKey {
  return Object.hasOwn(PALETTE, value);
}

/** Resolves a room color reference (`#RRGGBB` or palette key) to a hex string. */
export function resolveColorRef(ref: string, fallback: string = PALETTE.offWhite): string {
  if (ref.startsWith('#')) return ref;
  return isPaletteKey(ref) ? PALETTE[ref] : fallback;
}
