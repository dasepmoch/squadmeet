import { BOT_LINES, type ProjectileEvent, type Simulation, type ThrowKind } from '@huddle/engine';
import type { GameRenderer } from '@huddle/render';
import { NET, type Unsubscribe, type Vec3 } from '@huddle/shared';
import {
  pushChat,
  pushToast,
  type HudStore,
  type PopTone,
  type Translate,
  type WorldLabels,
} from '@huddle/ui';
import { accentFor } from './accents.ts';
import type { Sfx, SfxName } from './sfx.ts';

const POP: Record<ThrowKind, { key: string; tone: PopTone }> = {
  paper: { key: 'pop.bonk', tone: 'hit' },
  plane: { key: 'pop.bonk', tone: 'hit' },
  tomato: { key: 'pop.splat', tone: 'hit' },
  duck: { key: 'pop.quack', tone: 'hit' },
  confetti: { key: 'pop.yay', tone: 'party' },
  heart: { key: 'pop.love', tone: 'love' },
};

const HIT_SOUND: Record<ThrowKind, SfxName> = {
  paper: 'bonk',
  plane: 'tap',
  tomato: 'splat',
  duck: 'squeak',
  confetti: 'pop',
  heart: 'sparkle',
};

/** Sounds of actions, timed to the animation (seconds after it starts). */
const ACTION_SOUND: Partial<Record<string, { name: SfxName; gain: number; delay: number }>> = {
  clap: { name: 'clap', gain: 0.6, delay: 0 },
  cheer: { name: 'cheer', gain: 0.8, delay: 0 },
  sip: { name: 'sip', gain: 0.7, delay: 0.55 },
  eat: { name: 'crunch', gain: 0.8, delay: 0.6 },
  showPhone: { name: 'blip', gain: 0.4, delay: 0.35 },
  signUp: { name: 'paper', gain: 0.5, delay: 0.15 },
};

interface PendingReply {
  at: number;
  botId: string;
  line: number;
}

export interface SocialFeedDeps {
  sim: Simulation;
  renderer: GameRenderer;
  store: HudStore;
  labels: WorldLabels;
  sfx: Sfx;
  t: () => Translate;
}

/**
 * What people in the room say and feel: chat lines and bubbles, bot replies, throw sounds,
 * comic "Bonk!" pops over heads, particles and splats, and toasts when you get hit.
 */
export class SocialFeed {
  private readonly d: SocialFeedDeps;
  private readonly replies: PendingReply[] = [];

  constructor(deps: SocialFeedDeps) {
    this.d = deps;
  }

  attach(): Unsubscribe[] {
    const { sim } = this.d;
    return [
      sim.events.on('thrown', (e) => this.sound('whoosh', e.from, 0.55)),
      sim.events.on('projectile', (e) => this.onProjectile(e)),
      sim.events.on('action', (e) => {
        const s = ACTION_SOUND[e.id];
        if (s) this.d.sfx.play(s.name, this.positionOf(e.playerId), s.gain, s.delay);
      }),
      sim.events.on('handRaised', (e) => {
        if (!e.raised) return;
        this.sound('chime', this.positionOf(e.playerId), e.playerId === sim.selfId ? 0.8 : 0.45);
        this.system(this.d.t()('feed.hand', { name: this.nameOf(e.playerId) }));
      }),
      sim.events.on('botSay', (e) => this.botLine(e.playerId, e.line)),
    ];
  }

  /** The local player says something: history, bubble, and maybe a reply from a bot. */
  say(raw: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, NET.maxChatLength);
    if (!text) return;
    const { sim, labels } = this.d;
    pushChat(this.d.store, {
      playerId: sim.selfId,
      name: sim.view.localPlayer?.name ?? '',
      text,
      kind: 'chat',
      color: accentFor(sim.selfId),
    });
    labels.bubble(sim.selfId, text);
    this.sound('blip', null, 0.5);
    const bots = sim.view.players.filter((p) => p.isBot);
    if (bots.length === 0) return;
    const lower = text.toLowerCase();
    const mentioned = bots.find((b) => lower.includes(b.name.toLowerCase()));
    if (!mentioned && Math.random() > 0.55) return;
    const bot = mentioned ?? bots[Math.floor(Math.random() * bots.length)];
    if (bot)
      this.replies.push({
        at: sim.simTime + 1.1 + Math.random() * 1.8,
        botId: bot.id,
        line: Math.floor(Math.random() * BOT_LINES),
      });
  }

  /** A floating emoji over your head. */
  react(emoji: string): void {
    this.d.labels.reaction(this.d.sim.selfId, emoji);
    this.sound('blip', null, 0.35);
  }

  /** Delivers scheduled bot replies; call once per frame. */
  update(): void {
    const now = this.d.sim.simTime;
    for (let i = this.replies.length - 1; i >= 0; i--) {
      const r = this.replies[i] as PendingReply;
      if (now < r.at) continue;
      this.replies.splice(i, 1);
      const e = this.d.sim.entityOf(r.botId);
      if (e === undefined) continue;
      this.d.sim.social.act(e, Math.random() < 0.5 ? 'nod' : 'laugh');
      this.botLine(r.botId, r.line);
    }
  }

  private onProjectile(ev: ProjectileEvent): void {
    const { renderer, sim, labels, store } = this.d;
    renderer.handleProjectile(ev);
    const t = this.d.t();
    switch (ev.type) {
      case 'hit': {
        this.sound(HIT_SOUND[ev.kind], ev.point, 0.8);
        const pop = POP[ev.kind];
        labels.pop(ev.targetId, t(pop.key), pop.tone);
        const item = t(`throw.${ev.kind}`);
        if (ev.targetId === sim.selfId && ev.throwerId !== sim.selfId) {
          pushToast(store, 'feed.hitYou', 'info', { name: this.nameOf(ev.throwerId), item });
        } else if (ev.throwerId === sim.selfId) {
          this.system(t('feed.youHit', { name: this.nameOf(ev.targetId), item }));
        }
        break;
      }
      case 'splat':
        this.sound('splat', ev.point, 0.9);
        break;
      case 'burst':
        this.sound(ev.kind === 'heart' ? 'sparkle' : 'pop', ev.point, 0.85);
        break;
      case 'bounce':
        this.sound(ev.kind === 'duck' ? 'squeak' : 'tap', ev.point, Math.min(1, ev.speed / 6));
        break;
      case 'ghost':
        // "Don't hit me": it passed right through them.
        this.sound('shimmer', ev.point, 0.7);
        labels.pop(ev.targetId, t('pop.ghost'), 'love');
        break;
      case 'score':
        break;
    }
  }

  private botLine(botId: string, line: number): void {
    const text = this.d.t()(`bot.line.${line}`);
    this.d.labels.bubble(botId, text);
    pushChat(this.d.store, {
      playerId: botId,
      name: this.nameOf(botId),
      text,
      kind: 'chat',
      color: accentFor(botId),
    });
    this.sound('blip', this.positionOf(botId), 0.3);
  }

  private system(text: string): void {
    pushChat(this.d.store, { playerId: null, name: '', text, kind: 'system', color: '' });
  }

  private sound(name: SfxName, at: Vec3 | null, gain: number): void {
    this.d.sfx.play(name, at, gain);
  }

  private nameOf(id: string): string {
    const p = this.d.sim.view.findPlayer(id);
    if (!p) return '?';
    return p.isLocal ? this.d.t()('people.you') : p.name;
  }

  private positionOf(id: string): Vec3 | null {
    return this.d.sim.view.findPlayer(id)?.position ?? null;
  }
}
