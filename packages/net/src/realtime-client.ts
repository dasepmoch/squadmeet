import {
  binaryOp,
  decodeSnapshot,
  encodeMessage,
  encodeMove,
  errorMessage,
  EventBus,
  NET,
  OP_SNAPSHOT,
  parseServerMessage,
  type Clock,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type Logger,
  type RoomInfo,
  type ServerMessage,
  type SnapshotEntry,
  type SocketFactory,
  type SocketLike,
  type TimerHandle,
  type WirePose,
} from '@huddle/shared';
import { ClockSync } from './clock-sync.ts';
import { NetPlayers } from './net-players.ts';

export type ConnectionState =
  'idle' | 'connecting' | 'joined' | 'reconnecting' | 'closed' | 'failed';

export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;

export interface NetEvents {
  state: { state: ConnectionState; error: ErrorCode | 'replaced' | null; message: string | null };
  /** Joined (or re-joined) a room; `resumed` tells whether the old session survived. */
  welcome: WelcomeMessage;
  /** Every other server message, after the roster has been updated. */
  message: ServerMessage;
}

export interface JoinParams {
  /** Room code, or null for a fresh room. */
  room: string | null;
  name: string;
  avatar: string;
  passcode?: string;
}

export interface RealtimeClientOptions {
  url: string;
  sockets: SocketFactory;
  clock: Clock;
  logger: Logger;
  /** For reconnect jitter (inject a seeded one in tests). */
  random: () => number;
}

/** Errors after which reconnecting cannot help. */
const FATAL: ReadonlySet<ErrorCode> = new Set(['version', 'full', 'passcode', 'kicked']);
const CLOSE_LEAVE = 4000;
const CLOSE_REPLACED = 4001;
const CLOSE_KICKED = 4003;
const PING_MS = 2000;
const MAX_BACKOFF_MS = 10_000;

/**
 * The client side of the realtime protocol over any `SocketLike`: hello / welcome, typed events,
 * clock sync, throttled movement, snapshot buffering for interpolation, and reconnect with
 * exponential backoff that resumes the same session inside the server's grace window.
 */
export class RealtimeClient {
  readonly events = new EventBus<NetEvents>();
  readonly sync = new ClockSync();
  readonly players = new NetPlayers();
  state: ConnectionState = 'idle';
  selfId: string | null = null;
  selfSlot = -1;
  room: RoomInfo | null = null;
  /** STUN/TURN servers for WebRTC (TURN credentials are refreshed by the server). */
  ice: IceServer[] = [];
  private readonly o: RealtimeClientOptions;
  private socket: SocketLike | null = null;
  private params: JoinParams | null = null;
  private session: { id: string; token: string; room: string } | null = null;
  private fatal: { code: ErrorCode; message: string } | null = null;
  private attempt = 0;
  private retry: TimerHandle | null = null;
  private ping: TimerHandle | null = null;
  private seq = 0;
  private lastMove: WirePose | null = null;
  private lastMoveAt = Number.NEGATIVE_INFINITY;
  private readonly entries: SnapshotEntry[] = [];

  constructor(options: RealtimeClientOptions) {
    this.o = options;
  }

  get joined(): boolean {
    return this.state === 'joined';
  }

  /** Failed connection attempts since the last welcome (for "can't reach the server" UI). */
  get attempts(): number {
    return this.attempt;
  }

  /** Joins a room; later drops reconnect on their own until `leave()`. */
  connect(params: JoinParams): void {
    this.params = params;
    this.fatal = null;
    this.attempt = 0;
    this.open('connecting');
  }

  /** Says goodbye (the seat is freed right away) and stops reconnecting. */
  leave(): void {
    this.clearTimers();
    this.setState('closed', null, null);
    const s = this.socket;
    this.socket = null;
    s?.close(CLOSE_LEAVE, 'leave');
  }

  /** Sends a JSON message; false when not joined (it is dropped, not queued). */
  send(msg: ClientMessage): boolean {
    if (!this.joined || !this.socket?.isOpen) return false;
    this.socket.send(encodeMessage(msg));
    return true;
  }

  /**
   * Offers the local pose every frame; it is sent at up to `NET.moveHz` while it changes, and
   * once more when the player comes to rest.
   */
  sendMove(pose: WirePose): void {
    if (!this.joined || !this.socket?.isOpen) return;
    const now = this.o.clock.now();
    if (now - this.lastMoveAt < 1000 / NET.moveHz) return;
    const last = this.lastMove;
    if (
      last &&
      Math.abs(last.x - pose.x) < 0.004 &&
      Math.abs(last.y - pose.y) < 0.004 &&
      Math.abs(last.z - pose.z) < 0.004 &&
      Math.abs(last.yaw - pose.yaw) < 0.01 &&
      last.speed > 0.05 === pose.speed > 0.05 &&
      last.flags === pose.flags
    ) {
      return;
    }
    this.socket.send(encodeMove(this.seq++, pose));
    this.lastMove = { ...pose };
    this.lastMoveAt = now;
  }

  /** Current server time (ms), from the clock sync. */
  serverNow(): number {
    return this.sync.serverNow(this.o.clock.now());
  }

  /** Server time at which remote players should be drawn (slightly in the past). */
  renderTime(): number {
    return this.serverNow() - NET.interpolationDelayMs;
  }

  /** Interpolated pose of a remote player at `renderTime()`. */
  poseOf(id: string, out: WirePose): boolean {
    return this.players.pose(id, this.renderTime(), out, NET.extrapolationCapMs);
  }

  dispose(): void {
    this.leave();
    this.events.clear();
  }

  private open(state: 'connecting' | 'reconnecting'): void {
    this.clearTimers();
    this.setState(state, null, null);
    let socket: SocketLike;
    try {
      socket = this.o.sockets(this.o.url);
    } catch (err) {
      this.o.logger.warn('socket failed to open', errorMessage(err));
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onOpen = () => this.hello(socket);
    socket.onMessage = (data) => {
      if (this.socket === socket) this.receive(data);
    };
    socket.onClose = (code, reason) => {
      if (this.socket === socket) this.closed(code, reason);
    };
    socket.onError = (message) => this.o.logger.debug('socket error', message);
  }

  private hello(socket: SocketLike): void {
    const p = this.params;
    if (!p || this.socket !== socket) return;
    const code = this.session?.room ?? p.room;
    socket.send(
      encodeMessage({
        t: 'hello',
        v: NET.protocolVersion,
        room: code,
        name: p.name,
        avatar: p.avatar,
        ...(p.passcode ? { passcode: p.passcode } : {}),
        ...(this.session ? { resume: { id: this.session.id, token: this.session.token } } : {}),
      }),
    );
  }

  private receive(data: string | Uint8Array): void {
    if (typeof data !== 'string') {
      if (binaryOp(data) !== OP_SNAPSHOT) return;
      const time = decodeSnapshot(data, this.entries);
      if (time !== null) this.players.pushSnapshot(time, this.entries, this.selfSlot);
      return;
    }
    const r = parseServerMessage(data);
    if (!r.ok) {
      this.o.logger.warn('invalid server message', r.error);
      return;
    }
    const msg = r.value;
    const now = this.o.clock.now();
    switch (msg.t) {
      case 'welcome':
        this.welcome(msg, now);
        return;
      case 'pong':
        this.sync.add(msg.c, msg.s, now);
        return;
      case 'room':
        this.room = msg.room;
        break;
      case 'ice':
        this.ice = msg.servers;
        break;
      case 'error':
        if (FATAL.has(msg.code)) this.fatal = { code: msg.code, message: msg.message ?? '' };
        break;
      default:
        this.players.apply(msg, this.sync.serverNow(now));
    }
    this.events.emit('message', msg);
  }

  private welcome(msg: WelcomeMessage, now: number): void {
    this.selfId = msg.self;
    this.selfSlot = msg.slot;
    this.room = msg.room;
    this.ice = msg.ice;
    this.session = { id: msg.self, token: msg.token, room: msg.room.code };
    this.attempt = 0;
    this.sync.seed(msg.now, now);
    this.players.reset(msg.players, msg.now);
    this.lastMove = null;
    this.lastMoveAt = Number.NEGATIVE_INFINITY;
    this.setState('joined', null, null);
    this.sendPing();
    this.ping = this.o.clock.setInterval(() => this.sendPing(), PING_MS);
    this.events.emit('welcome', msg);
  }

  private sendPing(): void {
    if (this.socket?.isOpen) this.socket.send(encodeMessage({ t: 'ping', c: this.o.clock.now() }));
  }

  private closed(code: number, reason: string): void {
    this.socket = null;
    this.clearTimers();
    if (this.state === 'closed') return;
    if (this.fatal) {
      this.setState('failed', this.fatal.code, this.fatal.message);
      return;
    }
    if (code === CLOSE_REPLACED || code === CLOSE_KICKED) {
      this.setState('failed', code === CLOSE_KICKED ? 'kicked' : 'replaced', reason || null);
      return;
    }
    this.o.logger.info('connection lost, reconnecting', { code, attempt: this.attempt });
    this.setState('reconnecting', null, null);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    const delay = base * (0.75 + 0.5 * this.o.random());
    this.attempt++;
    this.retry = this.o.clock.setTimeout(() => {
      this.retry = null;
      if (this.state === 'reconnecting' || this.state === 'connecting') this.open('reconnecting');
    }, delay);
    if (this.state !== 'reconnecting') this.setState('reconnecting', null, null);
  }

  private setState(
    state: ConnectionState,
    error: ErrorCode | 'replaced' | null,
    message: string | null,
  ): void {
    if (state === this.state && error === null) return;
    this.state = state;
    this.events.emit('state', { state, error, message });
  }

  private clearTimers(): void {
    if (this.retry) this.o.clock.clearTimeout(this.retry);
    if (this.ping) this.o.clock.clearInterval(this.ping);
    this.retry = null;
    this.ping = null;
  }
}
