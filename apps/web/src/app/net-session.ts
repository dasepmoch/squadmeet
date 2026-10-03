import {
  findFreeSpot,
  SPAWN_CLEARANCE,
  type SeatArbiter,
  type Simulation,
  type SwitchableSeatArbiter,
} from '@huddle/engine';
import type { ConnectionState, RealtimeClient, WelcomeMessage } from '@huddle/net';
import {
  REACTION_EMOJIS,
  type ChatLine,
  type ErrorCode,
  type HostCommand,
  type PlayerInfo,
  type RoomInfo,
  type ServerMessage,
  type Unsubscribe,
  type WirePose,
} from '@huddle/shared';
import { pushChat, pushToast, type HudStore, type Translate, type WorldLabels } from '@huddle/ui';
import { accentFor } from './accents.ts';
import { NetSeatArbiter } from './net-seat-arbiter.ts';
import type { Sfx } from './sfx.ts';

export interface NetSessionDeps {
  client: RealtimeClient;
  sim: Simulation;
  arbiter: SwitchableSeatArbiter;
  store: HudStore;
  labels: WorldLabels;
  sfx: Sfx;
  t: () => Translate;
  /** Sets someone's look from an encoded `AvatarSpec`. */
  setAvatar: (playerId: string, encoded: string) => void;
  /** The local player's encoded `AvatarSpec`. */
  localAvatar: () => string;
  /** Called with the room code once joined (for the address bar). */
  onJoined: (code: string) => void;
}

const UNREACHABLE_AFTER = 3;

/**
 * Glue between the realtime client and the simulation: remote people appear, move, sit, emote
 * and throw; local actions go out to the room; the HUD learns about the room and connection.
 * Server ids are used for remote players; the local player keeps the simulation's own id.
 */
export class NetSession {
  /** Bumps when who is away or host may have changed (for the people panel). */
  version = 0;
  /** The offline arbiter, restored when leaving. */
  private readonly localArbiter: SeatArbiter;
  private readonly d: NetSessionDeps;
  private readonly arbiter: NetSeatArbiter;
  private readonly seatOwners = new Map<string, string>();
  private readonly pose: WirePose = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 };
  private lastChat = -1;
  private pingTimer = 0;

  constructor(deps: NetSessionDeps) {
    this.d = deps;
    this.localArbiter = deps.arbiter.current;
    this.arbiter = new NetSeatArbiter(deps.client, deps.sim.selfId);
  }

  get online(): boolean {
    const s = this.d.client.state;
    return s === 'joined' || s === 'reconnecting';
  }

  /** Our id on the server (null while offline). */
  get selfId(): string | null {
    return this.online ? this.d.client.selfId : null;
  }

  /** Median ping round trip (ms). */
  get rtt(): number {
    return this.d.client.sync.rtt;
  }

  attach(): Unsubscribe[] {
    const { client, sim } = this.d;
    return [
      client.events.on('state', (e) => this.onState(e.state, e.error)),
      client.events.on('welcome', (m) => this.onWelcome(m)),
      client.events.on('message', (m) => this.onMessage(m)),
      sim.events.on('action', (e) => {
        if (e.playerId === sim.selfId && !e.reaction) client.send({ t: 'act', action: e.id });
      }),
      sim.events.on('handRaised', (e) => {
        if (e.playerId === sim.selfId) client.send({ t: 'hand', raised: e.raised });
      }),
      sim.events.on('thrown', (e) => {
        if (e.throwerId !== sim.selfId) return;
        const target = e.targetId === null ? null : this.toNet(e.targetId);
        const { kind, from, to, seq: n } = e;
        client.send({ t: 'throw', kind, from, to, target, n, ...(e.tilt ? { tilt: e.tilt } : {}) });
      }),
      sim.events.on('projectile', (e) => {
        if (e.type !== 'hit' || e.throwerId !== sim.selfId || e.targetId === sim.selfId) return;
        client.send({ t: 'hit', n: e.seq, target: this.toNet(e.targetId) });
      }),
    ];
  }

  join(room: string | null, name: string, passcode: string): void {
    const s = this.d.store.getState();
    if (s.lobby) this.d.store.setState({ lobby: { ...s.lobby, busy: true, error: null } });
    this.d.client.connect({
      room,
      name,
      avatar: this.d.localAvatar(),
      ...(passcode ? { passcode } : {}),
    });
  }

  /** Back to being alone in the room. */
  leave(): void {
    this.d.client.leave();
    this.reset();
  }

  /** Chat goes through the server (it echoes back to everyone); false when offline. */
  say(text: string): boolean {
    return this.d.client.send({ t: 'chat', text });
  }

  react(emoji: string): void {
    const known = REACTION_EMOJIS.find((e) => e === emoji);
    if (known) this.d.client.send({ t: 'react', emoji: known });
  }

  profile(name: string, avatar: string): void {
    this.d.client.send({ t: 'profile', name, avatar });
  }

  host(cmd: HostCommand): void {
    const mapped = 'target' in cmd ? { ...cmd, target: this.toNet(cmd.target) } : cmd;
    this.d.client.send({ t: 'host', cmd: mapped });
  }

  isAway(playerId: string): boolean {
    return this.d.client.players.get(this.toNet(playerId))?.away ?? false;
  }

  isHost(playerId: string): boolean {
    const host = this.d.client.room?.host;
    return this.online && host !== null && host !== undefined && host === this.toNet(playerId);
  }

  /** Before the fixed steps: everyone else's interpolated pose. */
  beforeFrame(): void {
    if (!this.online) return;
    const { client, sim } = this.d;
    for (const id of sim.remote.ids()) {
      if (!client.poseOf(id, this.pose)) continue;
      const p = this.pose;
      sim.remote.setPose(id, { ...p, grounded: (p.flags & 1) !== 0 });
    }
  }

  /** After the fixed steps: our own pose (throttled by the client), ping for the stats. */
  afterFrame(dt: number): void {
    const { client, sim, store } = this.d;
    if (client.state !== 'joined') return;
    const me = sim.view.localPlayer;
    if (me) {
      const p = this.pose;
      p.x = me.position.x;
      p.y = me.position.y;
      p.z = me.position.z;
      p.yaw = me.yaw;
      p.speed = me.speed;
      p.flags = me.grounded ? 1 : 0;
      client.sendMove(p);
    }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0 && store.getState().debugOpen) {
      this.pingTimer = 1;
      store.setState((s) => ({ debug: { ...s.debug, pingMs: Math.round(client.sync.rtt) } }));
    }
  }

  private onState(state: ConnectionState, error: ErrorCode | 'replaced' | null): void {
    const { store, client } = this.d;
    if (state === 'reconnecting') this.arbiter.failPending();
    const lobby = store.getState().lobby;
    if (lobby) {
      const unreachable = state === 'reconnecting' && client.attempts >= UNREACHABLE_AFTER;
      if (state === 'failed' || unreachable) {
        if (unreachable) client.leave();
        store.setState({
          lobby: {
            ...lobby,
            busy: false,
            needsPasscode: lobby.needsPasscode || error === 'passcode',
            error: `lobby.error.${error ?? 'unreachable'}`,
          },
          net: 'offline',
        });
        return;
      }
    }
    store.setState({ net: state === 'idle' || state === 'closed' ? 'offline' : state });
    if (state === 'failed' && error === 'kicked') pushToast(store, 'lobby.error.kicked', 'warn');
  }

  private onWelcome(m: WelcomeMessage): void {
    const { sim, store, arbiter } = this.d;
    if (!this.online) return;
    arbiter.use(this.arbiter);
    const others = new Set(m.players.filter((p) => p.id !== m.self).map((p) => p.id));
    for (const id of sim.remote.ids()) if (!others.has(id)) sim.remote.remove(id);
    this.seatOwners.clear();
    for (const p of m.players) {
      if (p.seat) this.seatOwners.set(p.seat, p.id);
      if (p.id !== m.self) this.upsert(p);
    }
    const mine = m.players.find((p) => p.id === m.self);
    if (mine) sim.rename(sim.selfId, mine.name);
    const local = sim.localPlayer;
    if (!m.resumed && local !== null) {
      // A fresh session: the server knows nothing about our seat or hand yet, and everyone
      // arrives at the same spawn point, so step aside from whoever is standing there.
      sim.seats.reset(sim.world, local);
      if (sim.view.localPlayer?.handRaised) this.d.client.send({ t: 'hand', raised: true });
      const me = sim.view.localPlayer;
      if (me) {
        const spot = findFreeSpot(
          sim.world,
          sim.nav.walkGrid,
          me.position,
          m.slot,
          SPAWN_CLEARANCE,
          local,
        );
        sim.teleport(spot.x, spot.y, spot.z, me.yaw);
      }
    }
    for (const line of m.chat) this.showChat(line, false);
    this.applyRoom(m.room, true);
    // The lobby's fields unmount without a blur event: gameplay keys must come back on.
    store.setState({
      lobby: null,
      net: 'joined',
      typing: false,
      playerName: mine?.name ?? store.getState().playerName,
    });
    if (!m.resumed) this.system('feed.welcomeOnline', { code: m.room.code });
    this.d.onJoined(m.room.code);
    this.version++;
  }

  private onMessage(m: ServerMessage): void {
    const { sim, client } = this.d;
    const self = client.selfId;
    switch (m.t) {
      case 'joined':
        this.upsert(m.player);
        this.system('feed.joined', { name: m.player.name });
        this.d.sfx.play('chime', null, 0.35);
        break;
      case 'left': {
        const name = sim.view.findPlayer(m.id)?.name ?? '?';
        sim.remote.remove(m.id);
        for (const [seat, id] of this.seatOwners) if (id === m.id) this.seatOwners.delete(seat);
        if (m.reason !== 'kick' || m.id !== self) this.system('feed.left', { name });
        break;
      }
      case 'away':
        if (m.id !== self)
          this.system(m.away ? 'feed.away' : 'feed.back', { name: this.nameOf(m.id) });
        break;
      case 'profile':
        if (m.id === self) break;
        sim.rename(m.id, m.name);
        this.d.setAvatar(m.id, m.avatar);
        break;
      case 'seat':
        this.seatChanged(m.seat, m.id);
        break;
      case 'seatDenied':
        this.arbiter.denied(m.seat);
        break;
      case 'chat':
        this.showChat(m.line, true);
        break;
      case 'act':
        sim.remote.act(m.id, m.action);
        break;
      case 'react':
        this.d.labels.reaction(m.id, m.emoji);
        break;
      case 'hand':
        if (m.id !== self) sim.remote.hand(m.id, m.raised, this.simTimeOf(m.at));
        break;
      case 'throw':
        sim.remote.throwFrom(m.id, m.kind, m.from, m.to, m.tilt, m.n);
        break;
      case 'hit':
        if (m.id !== self) sim.remote.hit(m.id, m.kind, this.toSim(m.target));
        break;
      case 'room':
        this.applyRoom(m.room, false);
        break;
      case 'error':
        if (m.code === 'rate') pushToast(this.d.store, 'toast.slowDown', 'warn');
        else if (m.code === 'forbidden') pushToast(this.d.store, 'toast.forbidden', 'warn');
        break;
      default:
        break;
    }
    this.version++;
  }

  private upsert(p: PlayerInfo): void {
    const { sim } = this.d;
    this.d.setAvatar(p.id, p.avatar);
    if (!sim.remote.has(p.id)) sim.remote.spawn(p.id, p.name, p.pos, p.yaw);
    else sim.rename(p.id, p.name);
    sim.remote.setSeat(p.id, p.seat);
    sim.remote.hand(p.id, p.hand !== null, this.simTimeOf(p.hand ?? 0));
  }

  private seatChanged(seat: string, id: string | null): void {
    const self = this.d.client.selfId;
    const prev = this.seatOwners.get(seat);
    if (id === null) this.seatOwners.delete(seat);
    else this.seatOwners.set(seat, id);
    this.arbiter.seatChanged(seat, id);
    if (prev && prev !== self && prev !== id) this.d.sim.remote.setSeat(prev, null);
    if (id && id !== self) this.d.sim.remote.setSeat(id, seat);
  }

  private applyRoom(room: RoomInfo, first: boolean): void {
    const { sim, store, client } = this.d;
    const before = store.getState().room;
    const isHost = room.host !== null && room.host === client.selfId;
    store.setState({
      room: {
        code: room.code,
        mode: room.mode,
        voice: room.voice,
        throwsLocked: room.throwsLocked,
        locked: room.locked,
        isHost,
        capacity: room.capacity,
      },
    });
    sim.throwsEnabled = room.mode !== 'serious' && !room.throwsLocked;
    if (!sim.throwsEnabled && sim.aim) {
      sim.setAim(null);
      store.setState({ aim: null });
    }
    if (first || !before) return;
    if (isHost && !before.isHost) pushToast(store, 'toast.youAreHost');
    if (room.mode !== before.mode) {
      pushToast(store, 'toast.roomMode', 'info', { mode: this.d.t()(`host.mode.${room.mode}`) });
    }
    if (room.voice !== before.voice) {
      pushToast(store, 'toast.voiceMode', 'info', { mode: this.d.t()(`host.voice.${room.voice}`) });
    }
    if (
      !sim.throwsEnabled &&
      (before.throwsLocked !== room.throwsLocked || room.mode !== before.mode)
    )
      pushToast(store, 'toast.throwsOff', 'warn');
  }

  private showChat(line: ChatLine, live: boolean): void {
    if (line.n <= this.lastChat) return;
    this.lastChat = line.n;
    const from = this.toSim(line.from);
    const mine = from === this.d.sim.selfId;
    pushChat(this.d.store, {
      playerId: from,
      name: mine ? (this.d.sim.view.localPlayer?.name ?? line.name) : line.name,
      text: line.text,
      kind: 'chat',
      color: accentFor(from),
    });
    if (!live) return;
    this.d.labels.bubble(from, line.text);
    this.d.sfx.play('blip', null, mine ? 0.5 : 0.3);
  }

  private reset(): void {
    const { sim, store, arbiter } = this.d;
    for (const id of sim.remote.ids()) sim.remote.remove(id);
    this.seatOwners.clear();
    this.arbiter.failPending();
    arbiter.use(this.localArbiter);
    sim.throwsEnabled = true;
    this.lastChat = -1;
    store.setState({ net: 'offline', room: null });
    this.version++;
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
    return this.d.client.players.get(id)?.name ?? this.d.sim.view.findPlayer(id)?.name ?? '?';
  }

  /** Server time (ms) → simulation time (s), for ordering the hand queue. */
  private simTimeOf(serverMs: number): number {
    const { client, sim } = this.d;
    return sim.simTime - (client.serverNow() - serverMs) / 1000;
  }

  /** Server id → simulation id (the local player keeps the simulation's own id). */
  toSim(netId: string): string {
    return netId === this.d.client.selfId ? this.d.sim.selfId : netId;
  }

  toNet(simId: string): string {
    return simId === this.d.sim.selfId ? (this.d.client.selfId ?? simId) : simId;
  }
}
