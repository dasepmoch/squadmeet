import { actionBit, createInputFrame, v3, type ResolvedRoom } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot } from '../bots/bot-brain.ts';
import { SimDriver } from '../loop/sim-driver.ts';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { Simulation } from '../simulation.ts';
import { makeHoopRoom, makeTestRoom } from '../testing/fixtures.ts';
import { dropsThrough, MAX_PER_THROWER, type ProjectileEvent } from './projectile-system.ts';
import { MAX_FLYING } from './throw-system.ts';

async function setup(room: ResolvedRoom = makeTestRoom()) {
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({ room, physics });
  sim.spawnLocalPlayer('Thrower');
  const events: ProjectileEvent[] = [];
  sim.events.on('projectile', (e) => events.push(e));
  return { sim, driver: new SimDriver(sim), events };
}

function run(
  driver: SimDriver,
  seconds: number,
  setupFrame?: (f: ReturnType<typeof createInputFrame>) => void,
): void {
  const frame = createInputFrame();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    setupFrame?.(frame);
    driver.frame(frame, 1 / 60);
    frame.pressed = 0;
  }
}

/** A bot without a brain: a stand-in person that stays put (or sits down on `seatId`). */
function dummy(sim: Simulation, id: string, x: number, z: number, seatId?: string): void {
  const e = seatId
    ? sim.spawnBot(id, id, 7, { seatId })
    : sim.spawnBot(id, id, 7, { at: { position: v3.vec3(x, 0, z), yaw: 0 } });
  sim.world.remove(e, Bot);
}

describe('the playful layer (Rapier, headless)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('a paper plane glides there, rests, and can be picked up (E) and thrown again', async () => {
    const { sim, driver } = await setup();
    sim.interaction.enabledKinds.add('pickup');
    run(driver, 0.3);
    expect(sim.throwAt('plane', v3.vec3(-3, 0, -2))).toBe(true);
    run(driver, 4.5);
    const plane = sim.view.projectiles.find((p) => p.kind === 'plane');
    expect(plane?.resting).toBe(true);
    if (!plane) return;
    expect(Math.hypot(plane.position.x + 3, plane.position.z + 2)).toBeLessThan(1.2);
    // Walk up to it and press E.
    sim.teleport(plane.position.x + 0.6, 0, plane.position.z, -Math.PI / 2);
    run(driver, 0.2);
    expect(sim.prompt?.kind).toBe('pickup');
    const picked: string[] = [];
    sim.events.on('pickedUp', (e) => picked.push(`${e.playerId}:${e.throwerId}:${e.seq}`));
    run(driver, 1 / 60, (f) => {
      f.pressed = actionBit('interact');
    });
    expect(picked).toEqual([`${sim.selfId}:${sim.selfId}:${plane.seq}`]);
    expect(sim.play.held).toBe('plane');
    expect(sim.aim).toBe('plane');
    expect(sim.view.projectiles).toHaveLength(0);
    run(driver, 0.6);
    expect(sim.throwAt('plane', v3.vec3(2, 0, -2))).toBe(true);
    // The plane in hand is the one that flies.
    expect(sim.play.held).toBeNull();
  });

  it('paper balls drop through a hoop for a basket; replays see it but do not report', async () => {
    const { sim, driver, events } = await setup(makeHoopRoom());
    const [goal] = sim.room.goals;
    expect(goal).toBeDefined();
    if (!goal) return;
    run(driver, 0.3);
    const rim = v3.vec3(goal.position[0], goal.position[1] - 0.05, goal.position[2]);
    sim.teleport(2.5, 0, -2, Math.PI / 2);
    run(driver, 0.3);
    expect(sim.throwAt('paper', rim)).toBe(true);
    run(driver, 2);
    const score = events.find((e) => e.type === 'score');
    expect(score).toMatchObject({ type: 'score', goalId: 'hoop', cosmetic: false, kind: 'paper' });
    expect(events.filter((e) => e.type === 'score')).toHaveLength(1);
    // Someone else's ball replayed here: the same basket, reported by its thrower only.
    sim.remote.spawn('p1', 'Budi', v3.vec3(2, 0, -1), 0);
    sim.remote.throwFrom('p1', 'paper', v3.vec3(2.4, 1.42, -1.2), rim, 0, 5);
    run(driver, 2);
    expect(events.filter((e) => e.type === 'score').at(-1)).toMatchObject({
      throwerId: 'p1',
      seq: 5,
      cosmetic: true,
    });
    // Tomatoes splat on the backboard instead.
    run(driver, 0.5);
    sim.throwAt('tomato', rim);
    run(driver, 2);
    expect(events.filter((e) => e.type === 'score')).toHaveLength(2);
  });

  it('things pass through protected people with a shimmer, never a hit', async () => {
    const { sim, driver, events } = await setup();
    dummy(sim, 'gus', -3, 2);
    dummy(sim, 'sam', 0, 0, 'chair-1.0');
    run(driver, 1.5);
    for (const id of ['gus', 'sam']) {
      const e = sim.entityOf(id);
      if (e !== undefined) sim.social.setShield(e, true);
    }
    run(driver, 1 / 60);
    expect(sim.view.findPlayer('gus')?.shield).toBe(true);
    expect(sim.throwAt('paper', v3.vec3(-3, 1.2, 2), 'gus')).toBe(true);
    run(driver, 1.4);
    expect(sim.throwAt('duck', v3.vec3(3, 1, 1), 'sam')).toBe(true);
    run(driver, 1.8);
    expect(events.some((ev) => ev.type === 'hit')).toBe(false);
    const ghosts = events.filter((ev) => ev.type === 'ghost').map((ev) => ev.targetId);
    expect(ghosts).toEqual(['gus', 'sam']);
    // ... and protected people don't throw.
    sim.play.setShield(true);
    run(driver, 0.6);
    expect(sim.throwAt('paper', v3.vec3(0, 0, -3))).toBe(false);
    expect(sim.throwRefusal).toBe('shield');
  });

  it('caps what one person has in the air and in the room', async () => {
    const { sim, driver } = await setup();
    run(driver, 0.3);
    // Hearts float for four seconds before they burst: four up, then the hand waits.
    const thrown: boolean[] = [];
    for (let i = 0; i < MAX_FLYING + 2; i++) {
      thrown.push(sim.throwAt('heart', v3.vec3(-4 + i * 1.5, 3.2, -3)));
      run(driver, 0.55);
    }
    expect(thrown.filter(Boolean)).toHaveLength(MAX_FLYING);
    expect(sim.throwRefusal).toBe('flying');
    expect(sim.throws.projectiles.flying(sim.selfId)).toBeLessThanOrEqual(MAX_FLYING);
    run(driver, 5);
    // Paper balls stay on the floor for a while; one person's oldest make way past the cap.
    for (let i = 0; i < MAX_PER_THROWER + 4; i++) {
      expect(sim.throwAt('paper', v3.vec3(-5 + (i % 6) * 2, 0, -4 + Math.floor(i / 6)))).toBe(true);
      run(driver, 0.62);
      const mine = sim.view.projectiles.filter((p) => p.throwerId === sim.selfId).length;
      expect(mine).toBeLessThanOrEqual(MAX_PER_THROWER);
    }
  });

  it('detects a ball dropping through a rim only from above, inside the ring', () => {
    const goal = { id: 'h', position: [0, 2, 0] as [number, number, number], radius: 0.2, yaw: 0 };
    expect(dropsThrough(v3.vec3(0.05, 2.1, 0), v3.vec3(0.05, 1.95, 0), goal, 0.045)).toBe(true);
    expect(dropsThrough(v3.vec3(0.05, 1.95, 0), v3.vec3(0.05, 2.1, 0), goal, 0.045)).toBe(false);
    expect(dropsThrough(v3.vec3(0.3, 2.1, 0), v3.vec3(0.3, 1.95, 0), goal, 0.045)).toBe(false);
  });
});
