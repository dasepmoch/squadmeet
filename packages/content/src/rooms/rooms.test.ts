import { describe, expect, it } from 'vitest';
import { insideRoom, type ResolvedCollider } from '@huddle/shared';
import { loadRoom, ROOMS } from './index.ts';

function insideCollider(c: ResolvedCollider, x: number, z: number, pad: number): boolean {
  if (c.shape === 'cylinder') return Math.hypot(x - c.center[0], z - c.center[2]) < c.radius + pad;
  const dx = x - c.center[0];
  const dz = z - c.center[2];
  const cos = Math.cos(-c.yaw);
  const sin = Math.sin(-c.yaw);
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  return Math.abs(lx) < c.half[0] + pad && Math.abs(lz) < c.half[2] + pad;
}

describe('room content', () => {
  it.each(ROOMS.map((r) => r.id))('%s validates and resolves', async (id) => {
    const { resolved } = await loadRoom(id);
    expect(resolved.seats.length).toBeGreaterThan(0);
    for (const seat of resolved.seats) {
      expect(insideRoom(resolved, seat.position[0], seat.position[2], 0.2)).toBe(true);
    }
    for (const spawn of resolved.data.spawns) {
      expect(insideRoom(resolved, spawn.position[0], spawn.position[2], 0.5)).toBe(true);
    }
  });

  it('boardroom seats the whole team at the table plus lounge and bar spares', async () => {
    const { resolved } = await loadRoom('boardroom');
    const table = resolved.seats.filter((s) => s.propType === 'office-chair');
    expect(table).toHaveLength(11);
    expect(resolved.seats.length).toBeGreaterThanOrEqual(19);
    const kinds = new Set(resolved.interactables.map((i) => i.kind));
    for (const k of ['coffee', 'water', 'whiteboard', 'present', 'lights', 'pizza'])
      expect(kinds.has(k)).toBe(true);
    expect(resolved.boards).toHaveLength(1);
    expect(resolved.ceilingProps.has('ring')).toBe(true);
  });

  it('boardroom has a hoop by the door: rim out from the east wall, above head height', async () => {
    const { resolved } = await loadRoom('boardroom');
    const [hoop] = resolved.goals;
    expect(resolved.goals).toHaveLength(1);
    expect(hoop?.id).toBe('hoop');
    expect(hoop?.position[0]).toBeCloseTo(7.67, 2);
    expect(hoop?.position[1]).toBeGreaterThan(2);
    expect(hoop?.position[2]).toBeCloseTo(3.7, 3);
    // Twelve rim segments ring the goal at its radius (plus the tube).
    const rim = resolved.colliders.filter(
      (c) => c.source === 'hoop' && c.shape === 'box' && c.half[0] < 0.1,
    );
    expect(rim).toHaveLength(12);
    for (const c of rim) {
      const r = Math.hypot(
        c.center[0] - (hoop?.position[0] ?? 0),
        c.center[2] - (hoop?.position[2] ?? 0),
      );
      expect(r).toBeCloseTo(0.212, 2);
    }
  });

  it('table chairs stand up outside every prop collider', async () => {
    const { resolved } = await loadRoom('boardroom');
    const props = resolved.colliders.filter((c) => c.source !== 'arch');
    for (const seat of resolved.seats.filter((s) => s.propType === 'office-chair')) {
      const a = seat.approach;
      expect(a).not.toBeNull();
      if (!a) continue;
      // Leave room for the player capsule (radius 0.28).
      const blocked = props.some((c) => insideCollider(c, a[0], a[2], 0.2));
      expect(blocked, `approach of ${seat.id}`).toBe(false);
    }
  });
});
