import { canScore, v3, type ResolvedGoal, type Vec3 } from '@huddle/shared';
import type { PhysicsWorld } from '../physics/physics-world.ts';
import { ContactRules, type HitTarget, type Live } from './contacts.ts';
import { glideRotation, glideVelocity, stepGlide } from './glider.ts';
import { createThrowPlan, OPEN_SKY, planThrow, type ThrowRoom } from './launch.ts';
import { THROWABLES, type ThrowKind } from './throwables.ts';

export type { HitTarget } from './contacts.ts';

/** Render-facing state of one thrown object. Mutated in place; never reallocated while alive. */
export interface ProjectileView {
  readonly id: number;
  readonly kind: ThrowKind;
  readonly throwerId: string;
  /** The thrower's throw number (names this object across clients, e.g. for pickups). */
  readonly seq: number;
  position: Vec3;
  /** Orientation quaternion. */
  rotation: { x: number; y: number; z: number; w: number };
  velocity: Vec3;
  /** Seconds since launch. */
  age: number;
  /** 1 while alive, fading to 0 before despawning. */
  opacity: number;
  /** True once it touched anything (paper planes stop gliding). */
  landed: boolean;
  /** Landed and lying still (a paper plane can be picked up). */
  resting: boolean;
}

export type ProjectileEvent =
  | {
      type: 'hit';
      kind: ThrowKind;
      throwerId: string;
      targetId: string;
      point: Vec3;
      /** Throw number of the object (the thrower reports hits by it). */
      seq: number;
    }
  | {
      type: 'splat';
      kind: ThrowKind;
      throwerId: string;
      point: Vec3;
      normal: Vec3;
      targetId: string | null;
    }
  | { type: 'burst'; kind: ThrowKind; throwerId: string; point: Vec3 }
  | { type: 'bounce'; kind: ThrowKind; point: Vec3; speed: number }
  | {
      /** A ball dropped through a hoop. */
      type: 'score';
      kind: ThrowKind;
      throwerId: string;
      seq: number;
      goalId: string;
      point: Vec3;
      /** Where it was thrown from (two or three points). */
      from: Vec3;
      /** Someone else's throw replayed here: only its thrower reports the basket. */
      cosmetic: boolean;
    }
  | {
      /** Something passed through a protected ("Don't hit me") person. */
      type: 'ghost';
      kind: ThrowKind;
      throwerId: string;
      targetId: string;
      point: Vec3;
    };

export interface LaunchOptions {
  /** Someone else's throw: flies and lands here too, but never reports hits or baskets. */
  cosmetic?: boolean;
  /** Paper-plane release tilt, -1..1. */
  tilt?: number;
  /** The thrower's throw number. */
  seq?: number;
}

/** Objects in the room at once; the oldest resting ones make way first. */
export const MAX_LIVE = 60;
/** Objects one person can have in the room at once (their oldest resting ones make way). */
export const MAX_PER_THROWER = 12;
const FADE = 0.8;
const REST_SPEED = 0.05;
const REST_PICKUP = 0.4;

/** True when a ball moving from `a` to `b` dropped down through the rim circle of `goal`. */
export function dropsThrough(a: Vec3, b: Vec3, goal: ResolvedGoal, ballRadius: number): boolean {
  const y = goal.position[1];
  if (!(a.y > y && b.y <= y)) return false;
  const t = (a.y - y) / (a.y - b.y);
  const x = a.x + (b.x - a.x) * t - goal.position[0];
  const z = a.z + (b.z - a.z) * t - goal.position[2];
  return Math.hypot(x, z) <= goal.radius - ballRadius * 0.5;
}

/**
 * Thrown objects as Rapier dynamic bodies with continuous collision; paper planes fly a glider
 * model on top. Contacts become gameplay events: people hit (reactions), tomato splats (decals),
 * confetti/heart bursts, duck squeaks, baskets and ghostly pass-throughs. Purely cosmetic, so
 * every client simulates throws locally from a throw event.
 */
export class ProjectileSystem {
  readonly views: ProjectileView[] = [];
  /** Bumps whenever `views` changes structurally. */
  version = 0;
  private readonly physics: PhysicsWorld;
  private readonly room: ThrowRoom;
  private readonly rules: ContactRules;
  private readonly live = new Map<number, Live>();
  private readonly byCollider = new Map<number, Live>();
  private readonly plan = createThrowPlan();
  private nextId = 1;
  private seed = 1;

  constructor(physics: PhysicsWorld, room: ThrowRoom = OPEN_SKY) {
    this.physics = physics;
    this.room = room;
    this.rules = new ContactRules(physics);
  }

  get count(): number {
    return this.live.size;
  }

  /** Objects `throwerId` has in the air right now (not landed yet). */
  flying(throwerId: string): number {
    let n = 0;
    for (const l of this.live.values())
      if (l.view.throwerId === throwerId && !l.view.landed && !l.done) n++;
    return n;
  }

  /** Launches `kind` from `from` toward `to` (clamped to the throw range; see `planThrow`). */
  launch(
    kind: ThrowKind,
    throwerId: string,
    from: Vec3,
    to: Vec3,
    o: LaunchOptions = {},
  ): ProjectileView {
    this.makeRoom(throwerId);
    const def = THROWABLES[kind];
    const plan = planThrow(kind, from, to, o.tilt ?? 0, this.room, this.plan);
    const spin = {
      x: (this.rand() - 0.5) * def.spin,
      y: (this.rand() - 0.5) * def.spin,
      z: (this.rand() - 0.5) * def.spin,
    };
    const phys = this.physics.createProjectile(def.body, from, plan.velocity, spin);
    const view: ProjectileView = {
      id: this.nextId++,
      kind,
      throwerId,
      seq: o.seq ?? 0,
      position: { ...from },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { ...plan.velocity },
      age: 0,
      opacity: 1,
      landed: false,
      resting: false,
    };
    const g = plan.glide;
    const l: Live = {
      view,
      def,
      phys,
      cosmetic: o.cosmetic ?? false,
      hit: new Set(),
      restTime: 0,
      done: false,
      glide: plan.gliding ? { speed: g.speed, gamma: g.gamma, psi: g.psi, phi: g.phi } : null,
      prev: { ...from },
      origin: { ...from },
      scored: false,
    };
    if (l.glide) this.orient(l);
    this.live.set(view.id, l);
    this.byCollider.set(phys.collider.handle, l);
    this.views.push(view);
    this.version++;
    return view;
  }

  /** Before the physics step: gliding paper planes fly their flight model. */
  steer(dt: number): void {
    for (const l of this.live.values()) {
      if (!l.glide || l.done) continue;
      stepGlide(l.glide, dt);
      l.phys.body.setLinvel(glideVelocity(l.glide, l.view.velocity), true);
      this.orient(l);
    }
  }

  /** After the physics step: turns contacts into events and updates the views. */
  step(dt: number, out: ProjectileEvent[], people: readonly HitTarget[] = []): void {
    this.physics.drainCollisions((h1, h2, started) => {
      if (!started) return;
      const a = this.byCollider.get(h1);
      const b = this.byCollider.get(h2);
      if (a) this.rules.onContact(a, h2, out);
      if (b) this.rules.onContact(b, h1, out);
    });
    for (const l of this.live.values()) {
      if (l.done) continue;
      v3.copy(l.prev, l.view.position);
      this.sync(l, dt);
      const v = l.view;
      if (l.def.impact === 'burst' && v.age >= (l.def.burstAfter ?? 1)) {
        out.push({ type: 'burst', kind: v.kind, throwerId: v.throwerId, point: { ...v.position } });
        l.done = true;
        continue;
      }
      this.basket(l, out);
      this.rules.touchVolumes(l, people, out);
      // Resting objects linger a while, then fade out; anything that escaped the room goes too.
      const speed = Math.hypot(v.velocity.x, v.velocity.y, v.velocity.z);
      l.restTime = speed < REST_SPEED ? l.restTime + dt : 0;
      v.resting = v.landed && l.restTime > REST_PICKUP;
      const expired =
        v.age > Math.max(8, l.def.life) ||
        (v.landed && l.restTime > l.def.life) ||
        v.position.y < -5;
      if (expired) {
        v.opacity -= dt / FADE;
        if (v.opacity <= 0) l.done = true;
      }
    }
    for (const l of this.live.values()) if (l.done) this.remove(l);
  }

  /** The live object `throwerId` threw as number `seq`, if it is still around. */
  find(throwerId: string, seq: number): ProjectileView | undefined {
    for (const l of this.live.values())
      if (l.view.throwerId === throwerId && l.view.seq === seq && !l.done) return l.view;
    return undefined;
  }

  /** Takes a thrown object out of the room (a picked-up paper plane). False when it is gone. */
  take(throwerId: string, seq: number): boolean {
    for (const l of this.live.values()) {
      if (l.view.throwerId !== throwerId || l.view.seq !== seq || l.done) continue;
      this.remove(l);
      return true;
    }
    return false;
  }

  /** Removes everything (room change, the host's clean-up). */
  clear(): void {
    for (const l of [...this.live.values()]) this.remove(l);
  }

  private sync(l: Live, dt: number): void {
    const v = l.view;
    v.age += dt;
    const body = l.phys.body;
    const t = body.translation();
    const lv = body.linvel();
    v.position.x = t.x;
    v.position.y = t.y;
    v.position.z = t.z;
    v.velocity.x = lv.x;
    v.velocity.y = lv.y;
    v.velocity.z = lv.z;
    const r = body.rotation();
    v.rotation.x = r.x;
    v.rotation.y = r.y;
    v.rotation.z = r.z;
    v.rotation.w = r.w;
  }

  /** A ball that dropped through a rim scores (once). */
  private basket(l: Live, out: ProjectileEvent[]): void {
    if (l.scored || !canScore(l.view.kind)) return;
    for (const goal of this.room.goals) {
      if (!dropsThrough(l.prev, l.view.position, goal, l.def.body.radius)) continue;
      l.scored = true;
      const v = l.view;
      out.push({
        type: 'score',
        kind: v.kind,
        throwerId: v.throwerId,
        seq: v.seq,
        goalId: goal.id,
        point: { ...v.position },
        from: { ...l.origin },
        cosmetic: l.cosmetic,
      });
      return;
    }
  }

  /** A gliding plane points where it flies: heading, climb and bank. */
  private orient(l: Live): void {
    if (!l.glide) return;
    const q = l.view.rotation;
    glideRotation(l.glide, q);
    l.phys.body.setRotation(q, true);
    l.phys.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Keeps within the caps before a launch: one person's oldest object makes way at
   * `MAX_PER_THROWER`, the room's at `MAX_LIVE`, resting objects before flying ones.
   */
  private makeRoom(throwerId: string): void {
    let mine = 0;
    for (const l of this.live.values()) if (l.view.throwerId === throwerId) mine++;
    if (mine >= MAX_PER_THROWER) this.evict((l) => l.view.throwerId === throwerId);
    if (this.live.size >= MAX_LIVE) this.evict(() => true);
  }

  private evict(match: (l: Live) => boolean): void {
    let victim: Live | null = null;
    for (const l of this.live.values()) {
      if (!match(l)) continue;
      // Insertion order is age order: the first landed one, else the very oldest.
      if (l.view.landed) {
        victim = l;
        break;
      }
      victim ??= l;
    }
    if (victim) this.remove(victim);
  }

  private remove(l: Live): void {
    this.physics.removeProjectile(l.phys);
    this.byCollider.delete(l.phys.collider.handle);
    this.live.delete(l.view.id);
    const i = this.views.indexOf(l.view);
    if (i >= 0) this.views.splice(i, 1);
    this.version++;
  }

  /** Deterministic per-system randomness (spin), so replays and tests are stable. */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
