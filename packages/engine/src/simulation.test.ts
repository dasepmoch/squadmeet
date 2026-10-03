import { actionBit, createInputFrame } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { SimDriver } from './loop/sim-driver.ts';
import { initPhysics, PhysicsWorld } from './physics/physics-world.ts';
import { Simulation } from './simulation.ts';
import { makeTestRoom } from './testing/fixtures.ts';

async function makeSim(): Promise<{ sim: Simulation; driver: SimDriver }> {
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({ room: makeTestRoom(), physics });
  sim.spawnLocalPlayer('Tester');
  return { sim, driver: new SimDriver(sim) };
}

function run(
  driver: SimDriver,
  seconds: number,
  setup: (f: ReturnType<typeof createInputFrame>) => void,
): void {
  const frame = createInputFrame();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    setup(frame);
    driver.frame(frame, 1 / 60);
    frame.pressed = 0;
  }
}

describe('Simulation (Rapier, headless)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('settles on the floor and walks forward relative to the camera', async () => {
    const { sim, driver } = await makeSim();
    run(driver, 0.5, () => undefined);
    const view = sim.view.localPlayer!;
    expect(view.position.y).toBeGreaterThan(-0.05);
    expect(view.position.y).toBeLessThan(0.1);
    const startZ = view.position.z;
    // Camera yaw PI faces -Z, so forward input should decrease z.
    run(driver, 0.6, (f) => {
      f.moveY = 1;
    });
    expect(view.position.z).toBeLessThan(startZ - 0.8);
    expect(view.speed).toBeGreaterThan(2);
  });

  it('collides with props and walls instead of passing through', async () => {
    const { sim, driver } = await makeSim();
    // Crate at z=-1 (half 0.5): walking north from z=2 must stop before z≈-0.5+radius.
    run(driver, 3, (f) => {
      f.moveY = 1;
    });
    const p = sim.view.localPlayer!.position;
    expect(p.z).toBeGreaterThan(-0.3);
    // Facing north (-Z), strafing right heads east into the wall at x=+6.
    run(driver, 4, (f) => {
      f.moveY = 0;
      f.moveX = 1;
    });
    expect(p.x).toBeLessThan(6);
    expect(p.x).toBeGreaterThan(5.4);
  });

  it('jumps and lands', async () => {
    const { sim, driver } = await makeSim();
    run(driver, 0.3, () => undefined);
    const view = sim.view.localPlayer!;
    let maxY = 0;
    const frame = createInputFrame();
    frame.pressed = actionBit('jump');
    driver.frame(frame, 1 / 60);
    frame.pressed = 0;
    for (let i = 0; i < 60; i++) {
      driver.frame(frame, 1 / 60);
      maxY = Math.max(maxY, view.position.y);
    }
    expect(maxY).toBeGreaterThan(0.3);
    expect(view.position.y).toBeLessThan(0.1);
  });

  it('spring arm keeps the camera inside the room', async () => {
    const { sim, driver } = await makeSim();
    sim.camera.distance = 9;
    // Face south so the camera arm points north... then back the player into the south wall.
    run(driver, 2.5, (f) => {
      f.moveY = -1;
    });
    const cam = sim.view.camera.position;
    expect(cam.z).toBeLessThan(5);
  });
});
