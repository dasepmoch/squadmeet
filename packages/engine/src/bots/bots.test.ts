import { createInputFrame, v3 } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimDriver } from '../loop/sim-driver.ts';
import { bakeWalkGrid } from '../nav/walk-grid.ts';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { Simulation } from '../simulation.ts';
import { makeTestRoom, makeTestRoomData } from '../testing/fixtures.ts';

function roomWithChairs() {
  const base = makeTestRoomData();
  return makeTestRoom({
    props: [
      ...base.props,
      { id: 'chair-2', type: 'chair', position: [-3, 0, 1], yaw: Math.PI },
      { id: 'chair-3', type: 'chair', position: [-1.5, 0, 3], yaw: Math.PI },
    ],
  });
}

async function setup(bots: number) {
  const room = roomWithChairs();
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({ room, physics });
  sim.spawnLocalPlayer('Me');
  sim.setWalkGrid(bakeWalkGrid(room));
  for (let i = 0; i < bots; i++) sim.spawnBot(`bot-${i}`, `Bot ${i}`, 1000 + i * 17);
  return { sim, driver: new SimDriver(sim) };
}

describe('bots (Rapier, headless)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('live their office life for a minute and a half without escaping the room', async () => {
    const { sim, driver } = await setup(4);
    const sat = new Set<string>();
    const actions: string[] = [];
    const walked = new Map<string, number>();
    sim.events.on('sat', (e) => {
      if (!e.isLocal) sat.add(e.playerId);
    });
    sim.events.on('action', (e) => actions.push(e.id));
    const frame = createInputFrame();
    const last = new Map<string, { x: number; z: number }>();
    for (let i = 0; i < 90 * 60; i++) {
      driver.frame(frame, 1 / 60);
      for (const p of sim.view.players) {
        const prev = last.get(p.id);
        if (prev)
          walked.set(
            p.id,
            (walked.get(p.id) ?? 0) + Math.hypot(p.position.x - prev.x, p.position.z - prev.z),
          );
        last.set(p.id, { x: p.position.x, z: p.position.z });
      }
    }
    const b = sim.room.bounds;
    for (const p of sim.view.players) {
      expect(v3.isFiniteVec(p.position)).toBe(true);
      expect(p.position.x).toBeGreaterThan(b.min[0]);
      expect(p.position.x).toBeLessThan(b.max[0]);
      expect(p.position.z).toBeGreaterThan(b.min[2]);
      expect(p.position.z).toBeLessThan(b.max[2]);
    }
    expect(sat.size).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(3);
    // Everyone moved around at some point.
    for (let i = 0; i < 4; i++) expect(walked.get(`bot-${i}`) ?? 0).toBeGreaterThan(1);
  });

  it('seat claims never double-book a seat', async () => {
    const { sim, driver } = await setup(6);
    const frame = createInputFrame();
    for (let i = 0; i < 40 * 60; i++) {
      driver.frame(frame, 1 / 60);
      const seated = sim.view.players.filter((p) => p.seatId !== null).map((p) => p.seatId);
      expect(new Set(seated).size).toBe(seated.length);
    }
  });

  it('removing a seated bot frees its seat', async () => {
    const { sim, driver } = await setup(0);
    const e = sim.spawnBot('sitter', 'Sitter', 3, { seatId: 'chair-2.0' });
    const frame = createInputFrame();
    for (let i = 0; i < 90; i++) driver.frame(frame, 1 / 60);
    expect(sim.seats.occupantOf('chair-2.0')).toBe('sitter');
    sim.removePlayer(e);
    expect(sim.seats.occupantOf('chair-2.0')).toBeNull();
    expect(sim.view.findPlayer('sitter')).toBeUndefined();
  });
});
