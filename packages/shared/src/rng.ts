/** Deterministic, seedable PRNG (mulberry32). Used for cosmetic sims that must match across clients. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('Rng.pick on empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
  };
}

/** 32-bit FNV-1a string hash, handy for deriving stable seeds from ids. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
