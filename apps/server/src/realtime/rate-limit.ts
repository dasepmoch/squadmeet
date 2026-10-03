/** Token bucket: `capacity` messages in a burst, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perSecond: number;

  constructor(capacity: number, perSecond: number, now: number) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.tokens = capacity;
    this.last = now;
  }

  /** Takes one token; false when the bucket is empty (drop the message). */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-message-type budgets (burst, per second). Movement is checked separately. */
export const MESSAGE_LIMITS = {
  move: [40, 30],
  chat: [5, 1],
  act: [4, 2],
  hand: [6, 2],
  seat: [6, 3],
  throw: [6, 4],
  hit: [10, 6],
  profile: [4, 0.5],
  host: [8, 2],
  ping: [4, 2],
  // Joining a full mesh negotiates with every peer at once: offers plus a burst of candidates.
  signal: [400, 120],
  voice: [10, 4],
  present: [6, 1],
  score: [6, 2],
  /** Holding, putting away and picking up things. */
  hold: [10, 3],
  shield: [4, 1],
} as const satisfies Record<string, readonly [number, number]>;

export type LimitedKind = keyof typeof MESSAGE_LIMITS;

export type RateLimits = Record<LimitedKind, TokenBucket>;

export function createRateLimits(now: number): RateLimits {
  const out = {} as Record<LimitedKind, TokenBucket>;
  for (const [kind, [burst, rate]] of Object.entries(MESSAGE_LIMITS)) {
    out[kind as LimitedKind] = new TokenBucket(burst, rate, now);
  }
  return out;
}
