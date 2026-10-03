import { actionBit, createInputFrame, type InputFrame } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { SeatOccupancy } from '../components.ts';
import { SimDriver } from '../loop/sim-driver.ts';
import { bakeWalkGrid } from '../nav/walk-grid.ts';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { Simulation } from '../simulation.ts';
import { makeTestRoom } from '../testing/fixtures.ts';
import { LocalSeatArbiter } from './seat-arbiter.ts';

function run(driver: SimDriver, seconds: number, mutate?: (f: InputFrame) => void): void {
  const frame = createInputFrame();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    mutate?.(frame);
    driver.frame(frame, 1 / 60);
    frame.pressed = 0;
  }
}

async function setup(arbiter?: LocalSeatArbiter) {
  const room = makeTestRoom();
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({
    room,
    physics,
    selfId: 'me',
    ...(arbiter ? { seatArbiter: arbiter } : {}),
  });
  sim.spawnLocalPlayer('Tester');
  sim.setWalkGrid(bakeWalkGrid(room));
  const driver = new SimDriver(sim);
  run(driver, 0.3);
  return { sim, driver };
}

describe('seats', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('walks to a far seat, sits, switches to the cinema camera, then stands up', async () => {
    const { sim, driver } = await setup();
    const events: string[] = [];
    sim.events.on('sat', (e) => events.push(`sat:${e.seatId}`));
    sim.events.on('stood', (e) => events.push(`stood:${e.seatId}`));
    sim.requestSit('chair-1.0');
    run(driver, 5);
    const occ = sim.world.get(sim.localPlayer!, SeatOccupancy)!;
    expect(occ.phase).toBe('seated');
    expect(sim.camera.mode).toBe('seated');
    const view = sim.view.localPlayer!;
    expect(view.position.x).toBeCloseTo(3, 1);
    expect(view.position.y).toBeCloseTo(0.45, 1);
    expect(view.sitBlend).toBe(1);
    expect(events).toEqual(['sat:chair-1.0']);

    run(driver, 0.05, (f) => {
      f.pressed = actionBit('jump');
    });
    run(driver, 1.2);
    expect(occ.phase).toBe('standing');
    expect(sim.camera.mode).toBe('follow');
    expect(events).toEqual(['sat:chair-1.0', 'stood:chair-1.0']);
    // Standing up puts us on the floor in front of the chair, free to move again.
    expect(view.position.y).toBeLessThan(0.1);
    const z0 = view.position.z;
    // The chair is behind us (it faces north), so walk forward, away from it.
    run(driver, 0.5, (f) => {
      f.moveY = 1;
    });
    expect(Math.abs(view.position.z - z0)).toBeGreaterThan(0.4);
  });

  it('respects the arbiter when the seat is taken', async () => {
    const arbiter = new LocalSeatArbiter();
    arbiter.occupyForOther('chair-1.0', 'someone-else');
    const { sim, driver } = await setup(arbiter);
    const denied: string[] = [];
    sim.events.on('seatDenied', (e) => denied.push(e.seatId));
    sim.requestSit('chair-1.0');
    run(driver, 5);
    expect(sim.world.get(sim.localPlayer!, SeatOccupancy)!.phase).toBe('standing');
    expect(denied).toEqual(['chair-1.0']);
  });

  it('shows a sit prompt near a free seat', async () => {
    const { sim, driver } = await setup();
    sim.walkTo({ x: 3, y: 0, z: 0.3 });
    run(driver, 3);
    expect(sim.view.prompt?.kind).toBe('seat');
    expect(sim.view.prompt?.id).toBe('chair-1.0');
  });
});
