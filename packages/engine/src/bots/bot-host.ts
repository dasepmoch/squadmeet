import { createRng, v3, type HeldItem, type ResolvedGoal, type Vec3 } from '@huddle/shared';
import { PathFollow, PlayerIdentity, Transform } from '../components.ts';
import type { Entity, World } from '../ecs/world.ts';
import type { ItemSystem } from '../items/held-items.ts';
import type { Navigator } from '../nav/navigator.ts';
import type { ThrowKind } from '../projectiles/throwables.ts';
import type { SeatSystem } from '../seats/seat-system.ts';
import type { PlayerView } from '../world-view.ts';
import { Bot, BotBrain, createBotState, type BotActions } from './bot-brain.ts';

/** Wandering bots stop at least this far from anyone, so gestures don't reach into people. */
const PERSONAL_SPACE = 1.3;
/** Bots take a shot at a hoop from this close (and not from right under it). */
const HOOP_RANGE = { min: 1.4, max: 7.5 } as const;
/** How far (meters) a bot's shot may wander off the rim center: some swish, some clank. */
const HOOP_SPREAD = 0.22;

/** What bots need from the simulation beyond walking and sitting. */
export interface BotHostDeps {
  world: World;
  seats: SeatSystem;
  nav: Navigator;
  items: ItemSystem;
  goals: readonly ResolvedGoal[];
  players(): readonly PlayerView[];
  time(): number;
  act(e: Entity, actionId: string): void;
  throwAt(e: Entity, kind: ThrowKind, targetId: string): void;
  throwAtPoint(e: Entity, kind: ThrowKind, point: Vec3): boolean;
  setHand(e: Entity, raised: boolean): void;
  say(e: Entity, line: number): void;
}

/** Runs the bot brains and implements their actions on top of the shared player systems. */
export class BotHost implements BotActions {
  private readonly d: BotHostDeps;
  private readonly brain: BotBrain;
  private readonly free: string[] = [];
  private readonly claimed = new Set<string>();
  private readonly aim = v3.vec3();

  constructor(deps: BotHostDeps) {
    this.d = deps;
    this.brain = new BotBrain(this);
  }

  /** Gives a player entity a seeded brain. */
  attach(e: Entity, seed: number): void {
    const rng = createRng(seed);
    this.d.world.add(
      e,
      Bot,
      createBotState(() => rng.next()),
    );
  }

  get count(): number {
    return this.d.world.query(Bot).length;
  }

  /** Fixed-step thinking for every bot (before movement). */
  step(dt: number, time: number): void {
    const world = this.d.world;
    const players = this.d.players();
    for (const e of world.query(Bot, PlayerIdentity)) {
      this.brain.step(world, e, dt, time, players, world.req(e, PlayerIdentity).id);
    }
  }

  /** A bot got hit: it may throw something back. */
  onHit(e: Entity, throwerId: string, time: number): void {
    this.brain.onHit(this.d.world, e, throwerId, time);
  }

  walkTo(e: Entity, point: Vec3): boolean {
    return this.d.nav.walkTo(e, point, null) !== null;
  }

  sit(e: Entity, seatId: string): void {
    this.d.nav.sit(e, seatId);
  }

  stand(e: Entity): void {
    this.d.seats.requestStand(this.d.world, e);
  }

  emote(e: Entity, actionId: string): void {
    this.d.act(e, actionId);
  }

  throwAt(e: Entity, kind: ThrowKind, targetId: string): void {
    this.d.throwAt(e, kind, targetId);
  }

  /** A paper ball at the nearest hoop in range, give or take. False when there is none. */
  shootHoop(e: Entity, random: () => number): boolean {
    const t = this.d.world.get(e, Transform);
    if (!t) return false;
    let best: ResolvedGoal | null = null;
    let bestD: number = HOOP_RANGE.max;
    for (const g of this.d.goals) {
      const d = Math.hypot(g.position[0] - t.position.x, g.position[2] - t.position.z);
      if (d >= HOOP_RANGE.min && d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best) return false;
    const p = v3.set(
      this.aim,
      best.position[0] + (random() - 0.5) * 2 * HOOP_SPREAD,
      best.position[1] - 0.05,
      best.position[2] + (random() - 0.5) * 2 * HOOP_SPREAD,
    );
    return this.d.throwAtPoint(e, 'paper', p);
  }

  heldBy(e: Entity): HeldItem | null {
    return this.d.items.heldBy(e);
  }

  hold(e: Entity, item: HeldItem | null): void {
    this.d.items.hold(e, item);
  }

  useItem(e: Entity): void {
    this.d.items.use(e, this.d.time());
  }

  setHand(e: Entity, raised: boolean): void {
    this.d.setHand(e, raised);
  }

  say(e: Entity, line: number): void {
    this.d.say(e, line);
  }

  /** Seats nobody occupies or is already walking to. */
  freeSeats(): readonly string[] {
    const world = this.d.world;
    this.claimed.clear();
    for (const e of world.query(PathFollow)) {
      const action = world.req(e, PathFollow).arriveAction;
      if (action?.kind === 'seat') this.claimed.add(action.id);
    }
    this.free.length = 0;
    for (const s of this.d.seats.all) {
      if (this.d.seats.occupantOf(s.id) === null && !this.claimed.has(s.id)) this.free.push(s.id);
    }
    return this.free;
  }

  /** A wander target with personal space: away from everyone and everyone's destination. */
  randomPoint(random: () => number, out: Vec3): Vec3 | null {
    for (let i = 0; i < 8; i++) {
      const p = this.d.nav.randomPoint(random, out);
      if (!p) return null;
      if (!this.crowded(p)) return p;
    }
    return null;
  }

  private crowded(p: Vec3): boolean {
    for (const v of this.d.players()) {
      if (Math.hypot(v.position.x - p.x, v.position.z - p.z) < PERSONAL_SPACE) return true;
    }
    const world = this.d.world;
    for (const e of world.query(PathFollow)) {
      const points = world.req(e, PathFollow).points;
      const end = points[points.length - 1];
      if (end && Math.hypot(end.x - p.x, end.z - p.z) < PERSONAL_SPACE) return true;
    }
    return false;
  }
}
