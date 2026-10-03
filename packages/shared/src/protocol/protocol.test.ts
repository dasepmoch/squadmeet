import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.ts';
import {
  decodeMove,
  decodeSnapshot,
  encodeMove,
  encodeSnapshot,
  MOVE_BYTES,
  type SnapshotEntry,
  type WirePose,
} from './binary.ts';
import { encodeMessage, parseClientMessage, parseServerMessage } from './messages.ts';
import { actionAllowed, basketPoints, canScore, isHeldItem } from './play.ts';
import { cleanName, generateRoomCode, normalizeRoomCode, sanitizeChat } from './sanitize.ts';

const pose = (): WirePose => ({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 });

describe('binary frames', () => {
  it('round-trips a move with quantized yaw and speed', () => {
    const out = pose();
    const bytes = encodeMove(70001, { x: 1.25, y: 0.02, z: -3.5, yaw: -2.9, speed: 2.7, flags: 3 });
    expect(bytes.byteLength).toBe(MOVE_BYTES);
    expect(decodeMove(bytes, out)).toBe(70001 & 0xffff);
    expect(out.x).toBeCloseTo(1.25, 5);
    expect(out.z).toBeCloseTo(-3.5, 5);
    expect(out.yaw).toBeCloseTo(-2.9, 3);
    expect(out.speed).toBeCloseTo(2.7, 1);
    expect(out.flags).toBe(3);
  });

  it('rejects malformed and non-finite moves', () => {
    const out = pose();
    expect(decodeMove(new Uint8Array(5), out)).toBeNull();
    const bad = encodeMove(1, { x: Number.NaN, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 });
    expect(decodeMove(bad, out)).toBeNull();
    const wrongOp = encodeMove(1, pose());
    wrongOp[0] = 9;
    expect(decodeMove(wrongOp, out)).toBeNull();
  });

  it('round-trips snapshots and reuses entry objects', () => {
    const entries: SnapshotEntry[] = [
      { slot: 1, x: 1, y: 0, z: 2, yaw: 3, speed: 5.2, flags: 1 },
      { slot: 40000, x: -7.5, y: 0.5, z: 4, yaw: -1, speed: 0, flags: 0 },
    ];
    const out: SnapshotEntry[] = [];
    const bytes = encodeSnapshot(123456.5, entries);
    expect(decodeSnapshot(bytes, out)).toBe(123456.5);
    expect(out.map((e) => e.slot)).toEqual([1, 40000]);
    expect(out[1]?.x).toBeCloseTo(-7.5, 5);
    const first = out[0];
    decodeSnapshot(encodeSnapshot(1, entries.slice(0, 1)), out);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(first);
    expect(decodeSnapshot(bytes.slice(0, bytes.byteLength - 1), out)).toBeNull();
  });
});

describe('json messages', () => {
  it('accepts a valid hello and rejects junk', () => {
    const hello = { t: 'hello', v: 1, room: 'ABCD23', name: 'Ana', avatar: 'AQIDBA' };
    const ok = parseClientMessage(JSON.stringify(hello));
    expect(ok.ok).toBe(true);
    expect(parseClientMessage('{"t":"hello"').ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...hello, room: 'lower' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'nope' })).ok).toBe(false);
    expect(parseClientMessage('x'.repeat(20000)).ok).toBe(false);
  });

  it('validates host commands and throw targets', () => {
    const host = { t: 'host', cmd: { op: 'kick', target: 'p-1' } };
    expect(parseClientMessage(JSON.stringify(host)).ok).toBe(true);
    const badOp = { t: 'host', cmd: { op: 'nuke' } };
    expect(parseClientMessage(JSON.stringify(badOp)).ok).toBe(false);
    const far = {
      t: 'throw',
      kind: 'tomato',
      from: { x: 0, y: 1, z: 0 },
      to: { x: 1e9, y: 0, z: 0 },
      target: null,
      n: 4,
    };
    expect(parseClientMessage(JSON.stringify(far)).ok).toBe(false);
    const kind = { ...far, kind: 'brick', to: { x: 1, y: 1, z: 1 } };
    expect(parseClientMessage(JSON.stringify(kind)).ok).toBe(false);
    const plane = { ...far, kind: 'plane', to: { x: 3, y: 0, z: 1 }, tilt: 0.5 };
    expect(parseClientMessage(JSON.stringify(plane)).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ ...plane, tilt: 3 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...plane, n: 70000 })).ok).toBe(false);
  });

  it('validates the playful messages', () => {
    const ok = (m: unknown): boolean => parseClientMessage(JSON.stringify(m)).ok;
    expect(ok({ t: 'hold', item: 'mug' })).toBe(true);
    expect(ok({ t: 'hold', item: null })).toBe(true);
    expect(ok({ t: 'hold', item: 'sword' })).toBe(false);
    expect(ok({ t: 'score', n: 3, hoop: 'hoop' })).toBe(true);
    expect(ok({ t: 'score', n: 3, hoop: '../../etc' })).toBe(false);
    expect(ok({ t: 'pickup', owner: 'p-1', n: 9 })).toBe(true);
    expect(ok({ t: 'shield', on: true })).toBe(true);
    expect(ok({ t: 'host', cmd: { op: 'clean' } })).toBe(true);
    expect(ok({ t: 'hit', n: 2, target: 'p-1' })).toBe(true);
    expect(ok({ t: 'hit', kind: 'paper', target: 'p-1' })).toBe(false);
  });

  it('round-trips server messages', () => {
    const msg = encodeMessage({ t: 'hand', id: 'p-2', raised: true, at: 1000 });
    const r = parseServerMessage(msg);
    expect(r.ok && r.value.t === 'hand' && r.value.raised).toBe(true);
    const score = parseServerMessage(
      encodeMessage({ t: 'score', id: 'p-2', hoop: 'hoop', points: 3, total: 7 }),
    );
    expect(score.ok && score.value.t === 'score' && score.value.total).toBe(7);
  });
});

describe('playful rules', () => {
  it('scores two points up close and three from downtown', () => {
    const rim = { x: 7.7, z: 3.7 };
    expect(basketPoints({ x: 5, z: 3.7 }, rim)).toBe(2);
    expect(basketPoints({ x: 3, z: 3.7 }, rim)).toBe(3);
    expect(canScore('paper')).toBe(true);
    expect(canScore('tomato')).toBe(false);
  });

  it('keeps Serious mode to quiet gestures', () => {
    expect(actionAllowed('serious', 'nod')).toBe(true);
    expect(actionAllowed('serious', 'sip')).toBe(true);
    expect(actionAllowed('serious', 'dance')).toBe(false);
    expect(actionAllowed('serious', 'throw')).toBe(false);
    expect(actionAllowed('casual', 'dance')).toBe(true);
    expect(isHeldItem('signBrb')).toBe(true);
    expect(isHeldItem('banana')).toBe(false);
  });
});

describe('sanitizing', () => {
  it('strips control and bidi characters and caps chat length', () => {
    expect(sanitizeChat('  hi\u202e there\u0007  ')).toBe('hi there');
    expect(sanitizeChat('\u200b \n\t')).toBeNull();
    expect(Array.from(sanitizeChat('😀'.repeat(400)) ?? '')).toHaveLength(280);
  });

  it('cleans names with a fallback', () => {
    expect(cleanName('  Ana   Maria ', 'Guest')).toBe('Ana Maria');
    expect(cleanName('\u0000', 'Guest')).toBe('Guest');
    expect(cleanName('x'.repeat(50), 'Guest')).toHaveLength(24);
  });

  it('generates and normalizes room codes', () => {
    const rng = createRng(4);
    const code = generateRoomCode(() => rng.next());
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(normalizeRoomCode(' ab-cd 23 ')).toBe('ABCD23');
    expect(normalizeRoomCode('ab')).toBeNull();
  });
});
