import type { IceServer } from '@huddle/shared';
import { createHmac } from 'node:crypto';

export interface IceConfig {
  /** `stun:` / `turn:` / `turns:` URLs. */
  urls: readonly string[];
  /** coturn `static-auth-secret`; without it TURN URLs are not handed out. */
  turnSecret: string | null;
  ttlSeconds: number;
}

/**
 * Short-lived TURN credentials in coturn's `use-auth-secret` scheme (the TURN REST API): the
 * username is `<expiry unix seconds>:<user>` and the password is base64(HMAC-SHA1(secret,
 * username)). coturn checks both without any shared state, and they expire on their own.
 */
export function turnCredentials(
  secret: string,
  user: string,
  ttlSeconds: number,
  nowMs: number,
): { username: string; credential: string } {
  const username = `${Math.floor(nowMs / 1000) + ttlSeconds}:${user}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/** ICE servers for one person: STUN as configured, TURN with fresh credentials. */
export function iceServersFor(c: IceConfig, user: string, nowMs: number): IceServer[] {
  const stun = c.urls.filter((u) => /^stuns?:/i.test(u));
  const turn = c.urls.filter((u) => /^turns?:/i.test(u));
  const out: IceServer[] = [];
  if (stun.length > 0) out.push({ urls: stun.slice(0, 8) });
  if (turn.length > 0 && c.turnSecret) {
    out.push({
      urls: turn.slice(0, 8),
      ...turnCredentials(c.turnSecret, user, c.ttlSeconds, nowMs),
    });
  }
  return out;
}
