import { createInputFrame, v3 } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { SeatOccupancy, Transform } from './components.ts';
import { SimDriver } from './loop/sim-driver.ts';
import { initPhysics, PhysicsWorld } from './physics/physics-world.ts';
import type { ProjectileEvent } from './projectiles/projectile-system.ts';
import { LocalSeatArbiter, SwitchableSeatArbiter } from './seats/seat-arbiter.ts';
import { Simulation } from './simulation.ts';
import { makeTestRoom } from './testing/fixtures.ts';

function run(driver: SimDriver, seconds: number): void {
  const frame = createInputFrame();
  for (let i = 0; i < Math.round(seconds * 60); i++) driver.frame(frame, 1 / 60);
}

async function setup(): Promise<{ sim: Simulation; driver: SimDriver; events: ProjectileEvent[] }> {
  const physics = await PhysicsWorld.create();
  const sim = new Simulation({
    room: makeTestRoom(),
    physics,
    seatArbiter: new SwitchableSeatArbiter(),
  });
  sim.spawnLocalPlayer('Me');
  const events: ProjectileEvent[] = [];
  sim.events.on('projectile', (e) => events.push(e));
  return { sim, driver: new SimDriver(sim), events };
}

describe('remote players', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('follow the network pose and animate seats the server assigned', async () => {
    const { sim, driver } = await setup();
    sim.remote.spawn('p1', 'Budi', v3.vec3(-2, 0, 2), 0);
    expect(sim.view.findPlayer('p1')?.isLocal).toBe(false);
    sim.remote.setPose('p1', { x: -1.5, y: 0, z: 1.5, yaw: 1, speed: 2, grounded: true });
    run(driver, 0.1);
    const e = sim.entityOf('p1');
    expect(e).toBeDefined();
    const t = sim.world.get(e!, Transform);
    expect(t?.position.x).toBeCloseTo(-1.5, 5);
    expect(sim.view.findPlayer('p1')?.speed).toBeCloseTo(2, 5);
    sim.remote.setSeat('p1', 'chair-1.0');
    run(driver, 1);
    expect(sim.world.get(e!, SeatOccupancy)?.phase).toBe('seated');
    sim.remote.setSeat('p1', null);
    run(driver, 1);
    expect(sim.world.get(e!, SeatOccupancy)?.phase).toBe('standing');
    sim.remote.remove('p1');
    expect(sim.view.findPlayer('p1')).toBeUndefined();
  });

  it('replayed throws never report hits; network hits do, with a flinch', async () => {
    const { sim, driver, events } = await setup();
    sim.remote.spawn('p1', 'Budi', v3.vec3(-3, 0, 2), 0);
    const me = sim.view.localPlayer;
    expect(me).not.toBeNull();
    const at = me?.position ?? v3.vec3();
    sim.remote.throwFrom('p1', 'paper', v3.vec3(-2.6, 1.4, 2), v3.vec3(at.x, 1.2, at.z));
    run(driver, 1.5);
    expect(events.some((ev) => ev.type === 'hit')).toBe(false);
    const actions: string[] = [];
    sim.events.on('action', (a) => actions.push(`${a.playerId}:${a.id}:${a.reaction}`));
    sim.remote.hit('p1', 'paper', sim.selfId);
    expect(events.at(-1)).toMatchObject({ type: 'hit', throwerId: 'p1', targetId: sim.selfId });
    expect(actions).toEqual([`${sim.selfId}:hit:true`]);
  });

  it('switches seat arbitration without losing results', () => {
    const arbiter = new SwitchableSeatArbiter();
    const results: string[] = [];
    arbiter.onResult = (seat, who, ok) => results.push(`${seat}:${who}:${ok}`);
    arbiter.requestSeat('a', 'me');
    const other = new LocalSeatArbiter();
    other.occupyForOther('a', 'them');
    arbiter.use(other);
    arbiter.requestSeat('a', 'me');
    expect(results).toEqual(['a:me:true', 'a:me:false']);
    expect(arbiter.occupantOf('a')).toBe('them');
  });
});
