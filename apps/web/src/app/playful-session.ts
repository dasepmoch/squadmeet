import type { ProjectileEvent, Simulation, ThrowRefusal } from '@huddle/engine';
import type { RealtimeClient, WelcomeMessage } from '@huddle/net';
import type { GameRenderer, LightScene, ScoreRow } from '@huddle/render';
import {
  basketPoints,
  isHeldItem,
  type HeldItem,
  type RoomMode,
  type ServerMessage,
  type Unsubscribe,
} from '@huddle/shared';
import { pushChat, pushToast, type HudStore, type Translate, type WorldLabels } from '@huddle/ui';
import { accentFor } from './accents.ts';
import type { NetSession } from './net-session.ts';
import type { Sfx } from './sfx.ts';

/** Refused throws worth explaining (cooldowns only get a soft sound). */
const REFUSAL_HINTS: Partial<Record<ThrowRefusal, string>> = {
  flying: 'toast.tooManyFlying',
  shield: 'toast.shieldNoThrow',
};
/** Seconds before the same hint shows again. */
const HINT_GAP = 3;

type Basket = Extract<ProjectileEvent, { type: 'score' }>;

export interface PlayfulDeps {
  client: RealtimeClient;
  net: NetSession;
  sim: Simulation;
  renderer: GameRenderer;
  store: HudStore;
  labels: WorldLabels;
  sfx: Sfx;
  t: () => Translate;
  /** Changes the room lights (and tells the HUD). */
  setLightScene: (scene: LightScene) => void;
  /** Remembers "Don't hit me" for next time. */
  persistShield: (on: boolean) => void;
}

/**
 * The playful layer between simulation, network and HUD: hoop scores (validated by the server
 * online, counted here offline), what people hold, picked-up planes, "Don't hit me", the host's
 * clean-up with a mop, and Party mode's lights and effects.
 */
export class PlayfulSession {
  /** Bumps when anyone's points change (people panel). */
  version = 0;
  private readonly d: PlayfulDeps;
  private readonly points = new Map<string, number>();
  private readonly hinted = new Map<string, number>();
  private mode: RoomMode = 'casual';
  private sceneBeforeParty: LightScene | null = null;
  private shown = { held: null as HeldItem | null, shield: false, tilt: 0 };

  constructor(deps: PlayfulDeps) {
    this.d = deps;
  }

  pointsOf(playerId: string): number {
    return this.points.get(playerId) ?? 0;
  }

  /** Points by player id (debug tools). */
  scores(): Record<string, number> {
    return Object.fromEntries(this.points);
  }

  attach(): Unsubscribe[] {
    const { client, sim, store } = this.d;
    return [
      client.events.on('welcome', (m) => this.onWelcome(m)),
      client.events.on('message', (m) => this.onMessage(m)),
      sim.events.on('held', (e) => {
        // A picked-up plane travels as a pickup; everything else as what is in hand.
        if (e.playerId === sim.selfId && e.item !== 'plane')
          client.send({ t: 'hold', item: e.item });
      }),
      sim.events.on('pickedUp', (e) => {
        if (e.playerId !== sim.selfId) return;
        client.send({ t: 'pickup', owner: this.d.net.toNet(e.throwerId), n: e.seq });
        this.d.sfx.play('paper', null, 0.6);
      }),
      sim.events.on('shield', (e) => {
        if (e.playerId !== sim.selfId) return;
        client.send({ t: 'shield', on: e.on });
        this.d.persistShield(e.on);
      }),
      sim.events.on('projectile', (e) => {
        if (e.type === 'score') this.onBasket(e);
      }),
      sim.events.on('throwRefused', (e) => this.onRefused(e.reason)),
      sim.events.on('playerRemoved', (e) => {
        if (this.points.delete(e.id)) this.refresh();
      }),
      store.subscribe((s, prev) => {
        if (s.room?.mode !== prev.room?.mode) this.applyMode(s.room?.mode ?? 'casual');
        // Back to being alone: the online room's scores stay there.
        if (prev.room && !s.room) {
          this.points.clear();
          this.refresh();
        }
      }),
    ];
  }

  /** Once per frame: what the dock and the aim hint show about your hands. */
  update(): void {
    const play = this.d.sim.play;
    const s = this.shown;
    if (s.held === play.held && s.shield === play.shielded && s.tilt === play.planeTilt) return;
    this.shown = { held: play.held, shield: play.shielded, tilt: play.planeTilt };
    this.d.store.setState({ play: { ...this.shown } });
  }

  /** Puts something in your hand (null puts it away). Planes come from the floor only. */
  hold(item: string | null): void {
    const play = this.d.sim.play;
    if (item === null) play.hold(null);
    else if (isHeldItem(item) && item !== 'plane') {
      play.hold(item);
      this.d.sfx.play('tap', null, 0.4);
    }
  }

  /** Uses what is in hand; a paper plane gets ready to fly. */
  use(): void {
    const { sim, store } = this.d;
    const held = sim.play.held;
    if (held === 'plane') {
      if (!sim.throwsEnabled) pushToast(store, 'toast.throwsOff', 'warn');
      else {
        sim.setAim('plane');
        store.setState({ aim: sim.aim });
      }
      return;
    }
    if (!held) this.hint('toast.nothingHeld');
    else sim.play.use();
  }

  setShield(on: boolean): void {
    this.d.sim.play.setShield(on);
  }

  tilt(delta: number): void {
    this.d.sim.play.tilt(delta);
  }

  /** The broom: offline it is yours; online the host mops for everyone. */
  clean(): void {
    const { net, sim, store } = this.d;
    if (!net.online) this.mop(sim.selfId);
    else if (net.isHost(sim.selfId)) net.host({ op: 'clean' });
    else pushToast(store, 'toast.cleanHostOnly', 'warn');
  }

  resetScores(): void {
    if (this.d.net.online) {
      this.d.net.host({ op: 'resetScores' });
      return;
    }
    this.points.clear();
    this.refresh();
  }

  private onWelcome(m: WelcomeMessage): void {
    const { sim, client, net } = this.d;
    if (!net.online) return;
    this.points.clear();
    for (const p of m.players) {
      if (p.points > 0) this.points.set(net.toSim(p.id), p.points);
      if (p.id === m.self) continue;
      sim.remote.hold(p.id, p.held);
      sim.remote.setShield(p.id, p.shield);
    }
    if (!m.resumed) {
      // A fresh session: the room learns what we hold and whether we are protected.
      const held = sim.play.held;
      if (held) client.send({ t: 'hold', item: held });
      if (sim.play.shielded) client.send({ t: 'shield', on: true });
    }
    this.refresh();
  }

  private onMessage(m: ServerMessage): void {
    const { sim, net } = this.d;
    const self = this.d.client.selfId;
    switch (m.t) {
      case 'joined':
        sim.remote.hold(m.player.id, m.player.held);
        sim.remote.setShield(m.player.id, m.player.shield);
        if (m.player.points > 0) this.points.set(m.player.id, m.player.points);
        this.refresh();
        break;
      case 'profile':
        this.refresh();
        break;
      case 'hold':
        if (m.id !== self) sim.remote.hold(m.id, m.item);
        break;
      case 'pickup':
        if (m.id !== self) sim.remote.pickup(m.id, net.toSim(m.owner), m.n);
        break;
      case 'shield':
        if (m.id !== self) sim.remote.setShield(m.id, m.on);
        break;
      case 'score': {
        const id = net.toSim(m.id);
        this.points.set(id, m.total);
        this.celebrate(id, m.points);
        this.refresh();
        break;
      }
      case 'scoreReset':
        this.points.clear();
        this.system('feed.scoresReset', { name: this.nameOf(net.toSim(m.by)) });
        this.refresh();
        break;
      case 'clean':
        this.mop(net.toSim(m.by));
        break;
      default:
        break;
    }
  }

  /** A ball dropped through a hoop here: online its thrower reports it, offline we count. */
  private onBasket(ev: Basket): void {
    const { sim, client, net } = this.d;
    this.d.sfx.play('swish', ev.point, 0.9);
    if (ev.cosmetic) return;
    if (net.online) {
      if (ev.throwerId === sim.selfId) client.send({ t: 'score', n: ev.seq, hoop: ev.goalId });
      return;
    }
    const goal = sim.room.goals.find((g) => g.id === ev.goalId);
    if (!goal) return;
    const points = basketPoints(ev.from, { x: goal.position[0], z: goal.position[2] });
    this.points.set(ev.throwerId, this.pointsOf(ev.throwerId) + points);
    this.celebrate(ev.throwerId, points);
    this.refresh();
  }

  private celebrate(playerId: string, points: number): void {
    const t = this.d.t();
    this.d.labels.pop(playerId, t(points >= 3 ? 'pop.three' : 'pop.two'), 'party');
    this.system('feed.scored', { name: this.nameOf(playerId), points });
    if (points >= 3) this.d.sfx.play('cheer', null, 0.45);
  }

  /** Scoreboards and the people panel. */
  private refresh(): void {
    const rows: ScoreRow[] = [];
    for (const p of this.d.sim.view.players) {
      const points = this.points.get(p.id) ?? 0;
      if (points > 0) rows.push({ name: p.name, points, color: accentFor(p.id), self: p.isLocal });
    }
    this.d.renderer.setScores(rows);
    this.version++;
  }

  /** Someone mops the room: splats fade in a wave from them, thrown things are gone. */
  private mop(byId: string): void {
    const { sim, renderer, sfx, store } = this.d;
    const at = sim.view.findPlayer(byId)?.position ?? null;
    renderer.clearMess(at);
    sim.throws.clear();
    sfx.play('mop', at, 0.8);
    sfx.play('sparkle', null, 0.4, 0.9);
    if (byId === sim.selfId) {
      sim.emote('mop');
      pushToast(store, 'toast.cleaned');
    } else {
      this.system('feed.cleaned', { name: this.nameOf(byId) });
    }
  }

  /** Room mode presets: Party turns the party lights on and adds trails and confetti. */
  private applyMode(mode: RoomMode): void {
    const prev = this.mode;
    this.mode = mode;
    const { renderer } = this.d;
    renderer.party = mode === 'party';
    if (mode === 'party' && prev !== 'party') {
      this.sceneBeforeParty = renderer.lightScene;
      this.d.setLightScene('party');
    } else if (prev === 'party' && mode !== 'party') {
      const back = this.sceneBeforeParty;
      if (renderer.lightScene === 'party')
        this.d.setLightScene(back && back !== 'party' ? back : 'meeting');
      this.sceneBeforeParty = null;
    }
  }

  private onRefused(reason: ThrowRefusal): void {
    if (reason === 'cooldown') this.d.sfx.play('deny', null, 0.5);
    const key = REFUSAL_HINTS[reason];
    if (key) this.hint(key);
  }

  /** A warning toast, at most once every few seconds per message. */
  private hint(key: string): void {
    const now = this.d.sim.simTime;
    if (now - (this.hinted.get(key) ?? Number.NEGATIVE_INFINITY) < HINT_GAP) return;
    this.hinted.set(key, now);
    pushToast(this.d.store, key, 'warn');
  }

  private system(key: string, vars: Record<string, string | number>): void {
    pushChat(this.d.store, {
      playerId: null,
      name: '',
      text: this.d.t()(key, vars),
      kind: 'system',
      color: '',
    });
  }

  private nameOf(id: string): string {
    const p = this.d.sim.view.findPlayer(id);
    if (!p) return '?';
    return p.isLocal ? this.d.t()('people.you') : p.name;
  }
}
