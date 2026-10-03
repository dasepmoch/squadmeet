import { describe, expect, it } from 'vitest';
import {
  AVATAR_FIELDS,
  AVATAR_SPEC_BYTES,
  decodeAvatar,
  DEFAULT_AVATAR,
  encodeAvatar,
  randomAvatar,
} from './avatar-spec.ts';
import { createRng } from './rng.ts';

describe('AvatarSpec', () => {
  it('fits the < 64 byte budget', () => {
    expect(AVATAR_SPEC_BYTES).toBeLessThan(64);
    expect(encodeAvatar(DEFAULT_AVATAR).length).toBeLessThan(64);
  });

  it('round-trips random specs', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const spec = randomAvatar(() => rng.next());
      expect(decodeAvatar(encodeAvatar(spec))).toEqual(spec);
    }
  });

  it('clamps out-of-range and rejects garbage', () => {
    const tampered = { ...DEFAULT_AVATAR, hairStyle: 250 };
    expect(decodeAvatar('AQAAAA')).toEqual(DEFAULT_AVATAR);
    const decoded = decodeAvatar(encodeAvatar(tampered));
    expect(decoded.hairStyle).toBe(AVATAR_FIELDS.hairStyle - 1);
    expect(decodeAvatar('!!not base64!!')).toEqual(DEFAULT_AVATAR);
    expect(decodeAvatar('x'.repeat(200))).toEqual(DEFAULT_AVATAR);
    expect(decodeAvatar('')).toEqual(DEFAULT_AVATAR);
  });
});
