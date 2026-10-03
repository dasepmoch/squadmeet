import { v3, type HeldItem, type Vec3 } from '@huddle/shared';
import { PathFollow, SeatOccupancy, Transform } from '../components.ts';
import { defineComponent, type Entity, type World } from '../ecs/world.ts';
import type { ThrowKind } from '../projectiles/throwables.ts';
import type { PlayerView } from '../world-view.ts';

export type BotPlan = 'idle' | 'walk' | 'toSeat' | 'seated';

export interface BotState {
  random: () => number;
  plan: BotPlan;
  /** Seconds until the next plan decision. */
  timer: number;
  /** Seconds until the next emote / throw / remark. */
  fidget: number;
  /** Simulation time at which a raised hand goes down again (0 = not raised). */
  handUntil: number;
  /** Someone to throw something back at, and when. */
  payback: { targetId: string; at: number } | null;
  /** 0..1 personality knobs. */
  mischief: number;
  chatty: number;
  restless: number;
}

export const Bot = defineComponent<BotState>('Bot');

/** What a bot can do; implemented by the simulation. */
export interface BotActions {
  walkTo(e: Entity, point: Vec3): boolean;
  sit(e: Entity, seatId: string): void;
  stand(e: Entity): void;
  emote(e: Entity, actionId: string): void;
  throwAt(e: Entity, kind: ThrowKind, targetId: string): void;
  /** A paper ball at a hoop in range; false when there is none. */
  shootHoop(e: Entity, random: () => number): boolean;
  heldBy(e: Entity): HeldItem | null;
  hold(e: Entity, item: HeldItem | null): void;
  useItem(e: Entity): void;
  setHand(e: Entity, raised: boolean): void;
  /** A canned remark (index into the localized bot lines). */
  say(e: Entity, line: number): void;
  freeSeats(): readonly string[];
  randomPoint(random: () => number, out: Vec3): Vec3 | null;
}

const SEATED_EMOTES = ['nod', 'laugh', 'clap', 'thumbsUp', 'think', 'nod', 'shrug'] as const;
const STANDING_EMOTES = ['wave', 'shrug', 'think', 'laugh', 'dance', 'cheer'] as const;
const THROW_TABLE: readonly [ThrowKind, number][] = [
  ['paper', 0.34],
  ['plane', 0.2],
  ['duck', 0.14],
  ['confetti', 0.12],
  ['heart', 0.12],
  ['tomato', 0.08],
];
/** Things bots bring along (they "fetched" them off screen). */
const BOT_ITEMS: readonly HeldItem[] = ['mug', 'mug', 'water', 'phone', 'pizza'];
/** Number of localized bot remarks (`bot.line.0` ..). */
export const BOT_LINES = 12;

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

function pickThrow(random: () => number): ThrowKind {
  let r = random();
  for (const [kind, w] of THROW_TABLE) {
    r -= w;
    if (r <= 0) return kind;
  }
  return 'paper';
}

/** Fresh bot state from a seeded random source. */
export function createBotState(random: () => number): BotState {
  return {
    random,
    plan: 'idle',
    timer: 0.5 + random() * 2.5,
    fidget: 4 + random() * 8,
    handUntil: 0,
    payback: null,
    mischief: 0.25 + random() * 0.75,
    chatty: random(),
    restless: random(),
  };
}

/**
 * Tiny office-mate AI: wanders, takes seats, nods along, raises a hand now and then, chats and
 * throws silly things (and throws back when hit). Runs on the fixed step; decisions are seeded,
 * so a room with the same bots behaves the same way every time.
 */
export class BotBrain {
  private readonly actions: BotActions;
  private readonly tmp = v3.vec3();

  constructor(actions: BotActions) {
    this.actions = actions;
  }

  step(
    world: World,
    e: Entity,
    dt: number,
    time: number,
    players: readonly PlayerView[],
    selfId: string,
  ): void {
    const s = world.get(e, Bot);
    const occ = world.get(e, SeatOccupancy);
    if (!s || !occ) return;
    const a = this.actions;
    s.timer -= dt;
    s.fidget -= dt;
    if (s.handUntil > 0 && time >= s.handUntil) {
      s.handUntil = 0;
      a.setHand(e, false);
    }
    if (s.payback && time >= s.payback.at) {
      const target = s.payback.targetId;
      s.payback = null;
      // People who asked not to be hit are left alone, even after they threw something.
      if (players.some((p) => p.id === target && !p.shield))
        a.throwAt(e, pickThrow(s.random), target);
    }

    switch (s.plan) {
      case 'idle':
        if (occ.phase === 'seated' || occ.phase === 'sittingDown') this.sitFor(s);
        else if (s.timer <= 0) this.decide(e, s);
        break;
      case 'walk':
        if (!world.has(e, PathFollow)) this.rest(s, 1.5 + s.random() * 4);
        else if (s.timer <= -25) this.rest(s, 1);
        break;
      case 'toSeat':
        if (occ.phase === 'seated') {
          this.sitFor(s);
        } else if (
          occ.phase === 'standing' &&
          (world.has(e, PathFollow) ? s.timer < 0 : s.timer < 18)
        ) {
          // The seat was taken, unreachable or the walk got stuck: think again soon.
          world.remove(e, PathFollow);
          this.rest(s, 1 + s.random() * 2);
        }
        break;
      case 'seated':
        if (occ.phase === 'standing') this.rest(s, 1 + s.random() * 2);
        else if (s.timer <= 0 && occ.phase === 'seated') {
          if (s.handUntil > 0) {
            s.handUntil = 0;
            a.setHand(e, false);
          }
          a.stand(e);
          this.rest(s, 1.5 + s.random() * 2);
        }
        break;
    }

    if (s.fidget <= 0 && s.plan !== 'walk') {
      s.fidget = 6 + s.random() * 12;
      this.fidget(world, e, s, occ.phase === 'seated', time, players, selfId);
    }
  }

  /** Someone hit this bot: a reaction now, maybe payback later. */
  onHit(world: World, e: Entity, throwerId: string, time: number): void {
    const s = world.get(e, Bot);
    if (!s || s.payback) return;
    if (s.random() < 0.25 + s.mischief * 0.45)
      s.payback = { targetId: throwerId, at: time + 0.9 + s.random() * 1.6 };
  }

  private rest(s: BotState, seconds: number): void {
    s.plan = 'idle';
    s.timer = seconds;
  }

  /** Settles in for a while; restless bots get up sooner. */
  private sitFor(s: BotState): void {
    s.plan = 'seated';
    s.timer = 18 + s.random() * 40 * (1.2 - s.restless);
  }

  private decide(e: Entity, s: BotState): void {
    const a = this.actions;
    const r = s.random();
    if (r < 0.58 - s.restless * 0.15) {
      const seats = a.freeSeats();
      if (seats.length > 0) {
        a.sit(e, pick(s.random, seats));
        s.plan = 'toSeat';
        s.timer = 20;
        return;
      }
    }
    if (r < 0.9) {
      const p = a.randomPoint(s.random, this.tmp);
      if (p && a.walkTo(e, p)) {
        s.plan = 'walk';
        s.timer = 0;
        return;
      }
    }
    a.emote(e, pick(s.random, STANDING_EMOTES));
    this.rest(s, 3 + s.random() * 4);
  }

  private fidget(
    world: World,
    e: Entity,
    s: BotState,
    seated: boolean,
    time: number,
    players: readonly PlayerView[],
    selfId: string,
  ): void {
    const a = this.actions;
    const r = s.random();
    const others = players.filter((p) => p.id !== selfId && !p.shield);
    if (r < 0.1 * s.mischief + 0.04 && others.length > 0) {
      const me = world.get(e, Transform);
      const near = me
        ? others.filter(
            (p) => Math.hypot(p.position.x - me.position.x, p.position.z - me.position.z) < 9,
          )
        : others;
      if (near.length > 0) {
        a.throwAt(e, pickThrow(s.random), pick(s.random, near).id);
        return;
      }
    }
    if (!seated && r < 0.1 * s.mischief + 0.14 && a.shootHoop(e, s.random)) return;
    if (seated && s.handUntil === 0 && r < 0.2) {
      s.handUntil = time + 5 + s.random() * 7;
      a.setHand(e, true);
      return;
    }
    if (r < 0.3) {
      // Coffee, water, a phone, a slice: sipped, checked, eaten, now and then put away.
      if (a.heldBy(e)) {
        if (s.random() < 0.75) a.useItem(e);
        else a.hold(e, null);
        return;
      }
      if (s.random() < 0.4) {
        a.hold(e, pick(s.random, BOT_ITEMS));
        return;
      }
    }
    if (r < 0.2 + s.chatty * 0.3) {
      a.say(e, Math.floor(s.random() * BOT_LINES));
      return;
    }
    a.emote(e, pick(s.random, seated ? SEATED_EMOTES : STANDING_EMOTES));
  }
}
