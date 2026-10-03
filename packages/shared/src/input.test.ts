import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, isBindableCode, mergeBindings } from './input.ts';

describe('input bindings', () => {
  it('never binds the left mouse button (every click and camera drag would fire it)', () => {
    expect(isBindableCode('Mouse0')).toBe(false);
    expect(isBindableCode('Mouse2')).toBe(true);
    expect(isBindableCode('KeyG')).toBe(true);
    const merged = mergeBindings(DEFAULT_BINDINGS, {
      throw: ['Mouse0'],
      jump: ['Mouse0', 'KeyJ'],
      chat: [],
    });
    // Only a reserved code: the default comes back. Mixed: the reserved one is dropped.
    expect(merged.throw).toEqual(DEFAULT_BINDINGS.throw);
    expect(merged.jump).toEqual(['KeyJ']);
    // An explicitly cleared binding stays cleared.
    expect(merged.chat).toEqual([]);
  });
});
