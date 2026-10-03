import {
  PLAYER,
  type HeldItem,
  type PlayerInfo,
  type ThrowKind,
  type WirePose,
} from '@huddle/shared';
import { createRateLimits, type RateLimits } from './rate-limit.ts';

/** A recent throw that a reported hit or basket may refer to (by its number `n`). */
export interface ThrowRecord {
  n: number;
  kind: ThrowKind;
  at: number;
  /** Release point on the floor plan (three-pointers are measured from here). */
  x: number;
  z: number;
  /** Already landed on someone (a throw hits at most one person). */
  hit: boolean;
  scored: boolean;
}

/** One connection's outgoing side (a `ws` socket in production, a fake in tests). */
export interface Peer {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
  /** Bytes queued but not yet written (backpressure). */
  readonly buffered: number;
}

/** A person in a room, connected or inside the resume grace window. */
export interface Member {
  readonly id: string;
  readonly slot: number;
  readonly token: string;
  readonly joinedAt: number;
  name: string;
  avatar: string;
  pose: WirePose;
  /** Distance the player may still travel (meters), refilled over time at max speed. */
  moveBudget: number;
  lastMoveAt: number;
  /** Changed since the last snapshot. */
  dirty: boolean;
  seat: string | null;
  hand: number | null;
  peer: Peer | null;
  awaySince: number | null;
  limits: RateLimits;
  /** Recent throws, newest last. */
  throws: ThrowRecord[];
  /** Rejected moves, for logging abuse. */
  violations: number;
  muted: boolean;
  deafened: boolean;
  /** When this person's TURN credentials were last handed out. */
  iceAt: number;
  held: HeldItem | null;
  /** "Don't hit me": nothing thrown lands on them, and they don't throw. */
  shield: boolean;
  /** Basketball points in this room. */
  points: number;
}

export interface MemberInit {
  id: string;
  slot: number;
  token: string;
  name: string;
  avatar: string;
  pose: WirePose;
  peer: Peer;
  now: number;
}

export function createMember(m: MemberInit): Member {
  return {
    id: m.id,
    slot: m.slot,
    token: m.token,
    joinedAt: m.now,
    name: m.name,
    avatar: m.avatar,
    pose: { ...m.pose },
    moveBudget: MAX_BUDGET,
    lastMoveAt: m.now,
    dirty: true,
    seat: null,
    hand: null,
    peer: m.peer,
    awaySince: null,
    limits: createRateLimits(m.now),
    throws: [],
    violations: 0,
    // Everyone joins muted until their microphone is live.
    muted: true,
    deafened: false,
    iceAt: m.now,
    held: null,
    shield: false,
    points: 0,
  };
}

export function memberInfo(m: Member): PlayerInfo {
  return {
    id: m.id,
    slot: m.slot,
    name: m.name,
    avatar: m.avatar,
    away: m.peer === null,
    seat: m.seat,
    hand: m.hand,
    pos: { x: m.pose.x, y: m.pose.y, z: m.pose.z },
    yaw: m.pose.yaw,
    muted: m.muted,
    deafened: m.deafened,
    since: m.joinedAt,
    held: m.held,
    shield: m.shield,
    points: m.points,
  };
}

/** Top speed the server accepts (sprint with tolerance for jitter). */
const MAX_SPEED = PLAYER.sprintSpeed * PLAYER.speedTolerance;
/** Burst allowance (meters): covers bunched packets after a hiccup, not teleports. */
const MAX_BUDGET = 2.5;

export interface Bounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Applies a client's reported pose under a movement budget: the player may move at most
 * `MAX_SPEED` on average. Longer jumps are clamped along the direction of travel, so a
 * teleporting client walks there quickly for everyone else instead of popping. Positions are
 * clamped to the room bounds. Returns false when the move had to be clamped.
 */
export function applyMove(m: Member, next: WirePose, bounds: Bounds, now: number): boolean {
  const dt = Math.max(0, now - m.lastMoveAt) / 1000;
  m.lastMoveAt = now;
  m.moveBudget = Math.min(MAX_BUDGET, m.moveBudget + dt * MAX_SPEED);
  const margin = 0.5;
  const tx = clamp(next.x, bounds.min[0] - margin, bounds.max[0] + margin);
  const ty = clamp(next.y, bounds.min[1] - 1, bounds.max[1] + 2);
  const tz = clamp(next.z, bounds.min[2] - margin, bounds.max[2] + margin);
  const dx = tx - m.pose.x;
  const dz = tz - m.pose.z;
  const dist = Math.hypot(dx, dz);
  let ok = tx === next.x && ty === next.y && tz === next.z;
  if (dist <= m.moveBudget) {
    m.moveBudget -= dist;
    m.pose.x = tx;
    m.pose.z = tz;
  } else {
    const k = m.moveBudget / dist;
    m.pose.x += dx * k;
    m.pose.z += dz * k;
    m.moveBudget = 0;
    ok = false;
  }
  m.pose.y = ty;
  m.pose.yaw = Number.isFinite(next.yaw) ? next.yaw : m.pose.yaw;
  m.pose.speed = Math.min(next.speed, MAX_SPEED);
  m.pose.flags = next.flags & 0xff;
  m.dirty = true;
  if (!ok) m.violations++;
  return ok;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
