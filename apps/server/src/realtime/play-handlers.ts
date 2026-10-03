import {
  actionAllowed,
  basketPoints,
  canScore,
  SCORE_WINDOW_MS,
  type ClientMessage,
} from '@huddle/shared';
import type { Member, ThrowRecord } from './member.ts';
import type { Room } from './room.ts';

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;

/** A throw must start near the thrower's last known position. */
const THROW_REACH = 3;
/** A reported hit must follow its throw within this window. */
const HIT_WINDOW_MS = 5000;
/** History for a busy thrower: the throw rate limit times the basket window, roughly. */
const MAX_TRACKED_THROWS = 24;

export function throwsAllowed(room: Room): boolean {
  return room.mode !== 'serious' && !room.throwsLocked;
}

/** Emotes and item use. Serious rooms keep to quiet gestures; the rest is dropped. */
export function act(room: Room, m: Member, msg: Msg<'act'>, now: number): void {
  if (!m.limits.act.take(now) || !actionAllowed(room.mode, msg.action)) return;
  room.broadcast({ t: 'act', id: m.id, action: msg.action }, m);
}

/**
 * Relays a throw for everyone to replay. Refused in Serious mode, while throwing is locked and
 * for protected people ("Don't hit me" works both ways). A protected target is dropped: the
 * object still flies, and passes through them.
 */
export function throwAt(room: Room, m: Member, msg: Msg<'throw'>, now: number): void {
  if (!m.limits.throw.take(now)) return;
  if (!throwsAllowed(room) || m.shield) {
    const message = m.shield ? 'You are protected, so you do not throw.' : 'Throwing is off.';
    room.send(m, { t: 'error', code: 'forbidden', message });
    return;
  }
  if (Math.hypot(msg.from.x - m.pose.x, msg.from.z - m.pose.z) > THROW_REACH) return;
  const aimed = msg.target === null ? undefined : room.members.get(msg.target);
  if (msg.target !== null && !aimed) return;
  m.throws.push({
    n: msg.n,
    kind: msg.kind,
    at: now,
    x: msg.from.x,
    z: msg.from.z,
    hit: false,
    scored: false,
  });
  if (m.throws.length > MAX_TRACKED_THROWS) m.throws.shift();
  room.broadcast(
    {
      t: 'throw',
      id: m.id,
      kind: msg.kind,
      from: msg.from,
      to: msg.to,
      target: aimed && !aimed.shield ? aimed.id : null,
      n: msg.n,
      tilt: msg.kind === 'plane' ? (msg.tilt ?? 0) : 0,
    },
    m,
  );
}

/** The thrower's newest throw numbered `n`, if it is recent enough (numbers wrap). */
function recentThrow(m: Member, n: number, now: number, windowMs: number): ThrowRecord | null {
  for (let i = m.throws.length - 1; i >= 0; i--) {
    const t = m.throws[i] as ThrowRecord;
    if (t.n === n) return now - t.at <= windowMs ? t : null;
  }
  return null;
}

/** A thrower-reported hit: one person per throw, never someone protected or oneself. */
export function hit(room: Room, m: Member, msg: Msg<'hit'>, now: number): void {
  if (!m.limits.hit.take(now)) return;
  const target = room.members.get(msg.target);
  const t = recentThrow(m, msg.n, now, HIT_WINDOW_MS);
  if (!target || target === m || target.shield || !t || t.hit) return;
  t.hit = true;
  room.broadcast({ t: 'hit', id: m.id, kind: t.kind, target: target.id });
}

/**
 * A basket reported by the thrower: a recent paper ball (or duck) through one of the room's hoops,
 * once per throw. Two points, three from beyond `THREE_POINT_RANGE`.
 */
export function score(room: Room, m: Member, msg: Msg<'score'>, now: number): void {
  if (!m.limits.score.take(now)) return;
  const goal = room.resolved.goals.find((g) => g.id === msg.hoop);
  const t = recentThrow(m, msg.n, now, SCORE_WINDOW_MS);
  if (!goal || !t || t.scored || !canScore(t.kind)) return;
  t.scored = true;
  const points = basketPoints(t, { x: goal.position[0], z: goal.position[2] });
  m.points += points;
  room.broadcast({ t: 'score', id: m.id, hoop: goal.id, points, total: m.points });
}

export function hold(room: Room, m: Member, msg: Msg<'hold'>, now: number): void {
  if (!m.limits.hold.take(now) || m.held === msg.item) return;
  m.held = msg.item;
  room.broadcast({ t: 'hold', id: m.id, item: msg.item }, m);
}

/** Someone picked up a landed paper plane: it leaves the floor everywhere and is now theirs. */
export function pickup(room: Room, m: Member, msg: Msg<'pickup'>, now: number): void {
  if (!m.limits.hold.take(now)) return;
  m.held = 'plane';
  room.broadcast({ t: 'pickup', id: m.id, owner: msg.owner, n: msg.n }, m);
}

export function shield(room: Room, m: Member, on: boolean, now: number): void {
  if (!m.limits.shield.take(now) || m.shield === on) return;
  m.shield = on;
  room.broadcast({ t: 'shield', id: m.id, on }, m);
}
