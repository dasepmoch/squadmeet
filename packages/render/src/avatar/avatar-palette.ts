/** Colors referenced by AvatarSpec indices (sRGB hex). Kept here so every client agrees. */
export const SKIN_TONES = [
  '#FBE3D2',
  '#F4D0B5',
  '#EDBF9C',
  '#E2AD86',
  '#D39A70',
  '#C1855C',
  '#AD714B',
  '#955E3C',
  '#7C4A2E',
  '#663B24',
  '#52301D',
  '#3E2416',
] as const;

export const HAIR_COLORS = [
  '#16120F',
  '#2E1F16',
  '#4B3122',
  '#6E4630',
  '#8C4A2A',
  '#B3653A',
  '#C9955B',
  '#E3C48E',
  '#EFE3CD',
  '#9C9A98',
  '#E88BB0',
  '#5C7DD8',
  '#8B6BD6',
  '#3E9A7E',
] as const;

/** Clothing / accessory palette (16): office-friendly neutrals and a few confident accents. */
export const CLOTH_COLORS = [
  '#1F2A44',
  '#2B2D33',
  '#F2F0EB',
  '#E7DCC8',
  '#B98A5E',
  '#6B7250',
  '#2F4F3E',
  '#6D2E3A',
  '#C0573E',
  '#D6A13A',
  '#8FB3D9',
  '#A99BD1',
  '#101114',
  '#8E9196',
  '#3E5E86',
  '#E86F5A',
] as const;

export const EYE_COLORS = [
  '#3A2A1E',
  '#5C3B22',
  '#2E5E8C',
  '#3F6E4E',
  '#6B7B8C',
  '#8A6A2E',
  '#1E1E24',
  '#5A4E86',
] as const;

export function pick<T>(list: readonly T[], index: number): T {
  return list[Math.max(0, Math.min(list.length - 1, index))] as T;
}

/** Hex (#RRGGBB) to linear RGB (sRGB decode), without three.js so it works in workers. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
