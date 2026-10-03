import { describe, expect, it } from 'vitest';
import { defineComponent, World } from './world.ts';

const Pos = defineComponent<{ x: number }>('Pos');
const Vel = defineComponent<{ v: number }>('Vel');
const Tag = defineComponent<true>('Tag');

describe('World', () => {
  it('creates, queries and destroys entities', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    w.add(a, Pos, { x: 1 });
    w.add(a, Vel, { v: 2 });
    w.add(b, Pos, { x: 3 });
    expect(w.query(Pos)).toHaveLength(2);
    expect(w.query(Pos, Vel)).toEqual([a]);
    w.destroy(a);
    expect(w.query(Pos, Vel)).toHaveLength(0);
    expect(w.query(Pos)).toEqual([b]);
    expect(w.isAlive(a)).toBe(false);
  });

  it('keeps cached queries in sync incrementally', () => {
    const w = new World();
    const q = w.query(Pos, Tag);
    const e = w.create();
    w.add(e, Pos, { x: 0 });
    expect(q).toHaveLength(0);
    w.add(e, Tag, true);
    expect(q).toEqual([e]);
    w.remove(e, Tag);
    expect(q).toHaveLength(0);
  });

  it('recycles entity ids and throws on missing required components', () => {
    const w = new World();
    const e = w.create();
    w.destroy(e);
    const f = w.create();
    expect(f).toBe(e);
    expect(() => w.req(f, Pos)).toThrow(/no Pos/);
  });
});
