import { createInputFrame, createRng, v3 } from '@huddle/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { Bot } from '../bots/bot-brain.ts';
import { SimDriver } from '../loop/sim-driver.ts';
import { bakeWalkGrid } from '../nav/walk-grid.ts';
import { initPhysics, PhysicsWorld } from '../physics/physics-world.ts';
import { Simulation } from '../simulation.ts';
import { makeHoopRoom } from '../testing/fixtures.ts';
import { MAX_LIVE, MAX_PER_THROWER, type ProjectileEvent } from './projectile-system.ts';
import { MAX_FLYING } from './throw-system.ts';
import { THROW_KINDS } from './throwables.ts';

/** The engine has no Node typings; vitest runs on Node, where `process.env` exists. */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** Simulated minutes of nonstop throwing (`HUDDLE_SOAK_MINUTES=30` for the full DoD soak). */
const MINUTES = Number(env?.HUDDLE_SOAK_MINUTES ?? 4);

describe('throwing soak (Rapier, headless)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it(
    `stays within every cap through ${MINUTES} minutes of mischief`,
    async () => {
      const room = makeHoopRoom();
      const physics = await PhysicsWorld.create();
      const sim = new Simulation({ room, physics });
      sim.spawnLocalPlayer('Me');
      sim.setWalkGrid(bakeWalkGrid(room));
      for (let i = 0; i < 5; i++) {
        const e = sim.spawnBot(`bot-${i}`, `Bot ${i}`, 400 + i * 31);
        const brain = sim.world.get(e, Bot);
        if (brain) brain.mischief = 1;
      }
      const driver = new SimDriver(sim);
      const counts = new Map<string, number>();
      sim.events.on('projectile', (e: ProjectileEvent) =>
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1),
      );
      const rng = createRng(99);
      const frame = createInputFrame();
      const b = room.bounds;
      const steps = Math.round(MINUTES * 60 * 60);
      let peak = 0;
      for (let i = 0; i < steps; i++) {
        driver.frame(frame, 1 / 60);
        // Every 0.4 s the local player throws something somewhere (or at someone).
        if (i % 24 === 0) {
          const kind = THROW_KINDS[Math.floor(rng.next() * THROW_KINDS.length)] ?? 'paper';
          const others = sim.view.players.filter((p) => !p.isLocal);
          const who = rng.next() < 0.3 ? others[Math.floor(rng.next() * others.length)] : undefined;
          const to = v3.vec3(
            b.min[0] + rng.next() * (b.max[0] - b.min[0]),
            rng.next() * 2.5,
            b.min[2] + rng.next() * (b.max[2] - b.min[2]),
          );
          sim.throwAt(kind, who ? who.position : to, who?.id ?? null);
        }
        if (i % 60 !== 0) continue;
        const views = sim.view.projectiles;
        peak = Math.max(peak, views.length);
        expect(views.length).toBeLessThanOrEqual(MAX_LIVE);
        const per = new Map<string, number>();
        for (const p of views) {
          per.set(p.throwerId, (per.get(p.throwerId) ?? 0) + 1);
          expect(v3.isFiniteVec(p.position)).toBe(true);
          expect(p.position.y).toBeGreaterThan(-5.1);
        }
        for (const [id, n] of per) {
          expect(n).toBeLessThanOrEqual(MAX_PER_THROWER);
          expect(sim.throws.projectiles.flying(id)).toBeLessThanOrEqual(MAX_FLYING);
        }
        // No leaked physics bodies: the room, the people and the live projectiles.
        expect(physics.world.bodies.len()).toBeLessThanOrEqual(1 + 6 + views.length);
        for (const p of sim.view.players) expect(v3.isFiniteVec(p.position)).toBe(true);
      }
      expect(counts.get('hit') ?? 0).toBeGreaterThan(10);
      expect(counts.get('splat') ?? 0).toBeGreaterThan(10);
      expect(peak).toBeGreaterThan(5);
      physics.dispose();
    },
    Math.max(60_000, MINUTES * 30_000),
  );
});
