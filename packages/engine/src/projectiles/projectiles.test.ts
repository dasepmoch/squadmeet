import { createInputFrame, v3 } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot } from '../bots/bot-brain.ts';
import { PathFollow, SeatOccupancy } from '../components.ts';
import { SimDriver } from '../loop/sim-driver.ts';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { Simulation } from '../simulation.ts';
import { makeTestRoom } from '../testing/fixtures.ts';
import type { ProjectileEvent } from './projectile-system.ts';

async function setup(): Promise<{ sim: Simulation; driver: SimDriver; events: ProjectileEvent[] }> {
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({ room: makeTestRoom(), physics });
  sim.spawnLocalPlayer('Thrower');
  const events: ProjectileEvent[] = [];
  sim.events.on('projectile', (e) => events.push(e));
  return { sim, driver: new SimDriver(sim), events };
}

function run(driver: SimDriver, seconds: number): void {
  const frame = createInputFrame();
  for (let i = 0; i < Math.round(seconds * 60); i++) driver.frame(frame, 1 / 60);
}

/** A bot without a brain: a stand-in person that stays put (or sits down on `seatId`). */
function dummy(sim: Simulation, id: string, x: number, z: number, seatId?: string): void {
  const e = seatId
    ? sim.spawnBot(id, id, 7, { seatId })
    : sim.spawnBot(id, id, 7, { at: { position: v3.vec3(x, 0, z), yaw: 0 } });
  sim.world.remove(e, Bot);
}

describe('throwing (Rapier, headless)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('a tomato splats on the wall it was thrown at, facing back into the room', async () => {
    const { sim, driver, events } = await setup();
    run(driver, 0.3);
    expect(sim.throwAt('tomato', v3.vec3(6, 1.4, 2))).toBe(true);
    run(driver, 2);
    const splat = events.find((e) => e.type === 'splat');
    expect(splat).toBeDefined();
    if (splat?.type !== 'splat') return;
    expect(splat.targetId).toBeNull();
    expect(splat.point.x).toBeGreaterThan(5.5);
    expect(splat.normal.x).toBeLessThan(-0.9);
    expect(sim.view.projectiles).toHaveLength(0);
  });

  it('paper thrown at a standing person hits them, and they flinch', async () => {
    const { sim, driver, events } = await setup();
    dummy(sim, 'bob', -3, 2);
    run(driver, 0.3);
    const actions: string[] = [];
    sim.events.on('action', (e) => actions.push(`${e.playerId}:${e.id}`));
    expect(sim.throwAt('paper', v3.vec3(-3, 1.2, 2), 'bob')).toBe(true);
    // Cooling down: a second throw right away is refused.
    expect(sim.throwAt('paper', v3.vec3(-3, 1.2, 2), 'bob')).toBe(false);
    run(driver, 1.6);
    const hit = events.find((e) => e.type === 'hit');
    expect(hit).toMatchObject({ type: 'hit', kind: 'paper', throwerId: 'local', targetId: 'bob' });
    expect(actions).toEqual(['local:throw', 'bob:hit']);
    expect(sim.view.findPlayer('bob')?.action).toBe('hit');
    // The paper ball stays in the room as a resting prop for a while.
    expect(sim.view.projectiles).toHaveLength(1);
  });

  it('throws lead a walking person, so the shot still lands', async () => {
    const { sim, driver, events } = await setup();
    dummy(sim, 'wes', -3, 4);
    const e = sim.entityOf('wes');
    expect(e).toBeDefined();
    sim.world.add(e!, PathFollow, { points: [v3.vec3(-3, 0, -4)], index: 0, arriveAction: null });
    run(driver, 1.2);
    expect(sim.throwAt('paper', v3.vec3(-3, 1.2, 0), 'wes')).toBe(true);
    run(driver, 1.4);
    expect(events.some((ev) => ev.type === 'hit' && ev.targetId === 'wes')).toBe(true);
  });

  it('seated people (no active capsule) still get hit', async () => {
    const { sim, driver, events } = await setup();
    dummy(sim, 'sam', 0, 0, 'chair-1.0');
    run(driver, 1.5);
    const e = sim.entityOf('sam');
    expect(e).toBeDefined();
    expect(sim.world.get(e!, SeatOccupancy)?.phase).toBe('seated');
    expect(sim.throwAt('duck', v3.vec3(3, 1, 1), 'sam')).toBe(true);
    run(driver, 1.8);
    expect(events.some((ev) => ev.type === 'hit' && ev.targetId === 'sam')).toBe(true);
  });

  it('confetti bursts in the air and the aim preview follows the pointer', async () => {
    const { sim, driver, events } = await setup();
    run(driver, 0.2);
    sim.setAim('confetti');
    const frame = createInputFrame();
    frame.pointerActive = true;
    driver.frame(frame, 1 / 60);
    expect(sim.view.aim?.kind).toBe('confetti');
    expect(sim.view.aim?.from.y).toBeGreaterThan(1.2);
    frame.clicked = true;
    driver.frame(frame, 1 / 60);
    frame.clicked = false;
    run(driver, 1.5);
    expect(events.some((ev) => ev.type === 'burst' && ev.kind === 'confetti')).toBe(true);
    // One throw per pick: the next click walks again.
    expect(sim.aim).toBeNull();
    driver.frame(frame, 1 / 60);
    expect(sim.view.aim).toBeNull();
  });
});
