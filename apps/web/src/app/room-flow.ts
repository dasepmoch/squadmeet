import type { PlatformServices } from '@huddle/platform';
import { cleanName, normalizeRoomCode } from '@huddle/shared';
import { pushToast, type HudStore, type LobbyStepUi, type Translate } from '@huddle/ui';
import type { Runtime } from './runtime.ts';
import type { UserSettings } from './user-settings.ts';

/** What the lobby flow needs from the app (implemented by `GameApp`). */
export interface RoomFlowHost {
  readonly store: HudStore;
  readonly runtime: Runtime | null;
  readonly settings: UserSettings;
  readonly platform: PlatformServices;
  persist(patch: Partial<UserSettings>): void;
  translate(): Translate;
  /** Invites the AI office-mates (offline only). */
  inviteBots(): void;
  removeBots(): void;
}

export type RoomMode = 'lobby' | 'offline' | 'online';

/** Same-origin realtime endpoint (Vite proxies `/ws` to the server in development). */
export function realtimeUrl(loc: Location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
}

/**
 * Lobby → online room or offline play, the address bar (`?room=CODE` for invites) and the
 * URL shortcuts used by tests and demos: `?offline=1` (or `?bots=N`) skips the lobby,
 * `?autojoin=1&room=CODE&name=Ana` joins right away.
 */
export class RoomFlow {
  mode: RoomMode = 'lobby';
  private readonly host: RoomFlowHost;

  constructor(host: RoomFlowHost) {
    this.host = host;
  }

  begin(params: URLSearchParams): void {
    const room = normalizeRoomCode(params.get('room') ?? '') ?? '';
    if (params.get('offline') === '1' || params.has('bots')) {
      this.playOffline();
      return;
    }
    // An invite link skips the landing: straight to the green room for that room.
    this.openLobby(room, room ? 'ready' : 'start');
    if (params.get('autojoin') === '1') {
      this.join(room, params.get('name') ?? this.host.settings.name, params.get('passcode') ?? '');
    }
  }

  openLobby(room = '', step: LobbyStepUi = 'start'): void {
    const t = this.host.translate();
    this.mode = 'lobby';
    this.host.store.setState({
      lobby: {
        step,
        room,
        name: this.host.settings.name || t('player.defaultName'),
        needsPasscode: false,
        busy: false,
        error: null,
      },
      panel: null,
      emoteWheel: false,
    });
  }

  /** Landing ⇄ green room. A malformed code stays on the landing with an error. */
  setStep(step: LobbyStepUi, roomRaw: string): void {
    const store = this.host.store;
    const lobby = store.getState().lobby;
    if (!lobby || lobby.busy) return;
    if (step === 'start') {
      store.setState({ lobby: { ...lobby, step, error: null, needsPasscode: false } });
      return;
    }
    const typed = roomRaw.trim();
    const code = typed ? normalizeRoomCode(typed) : '';
    if (code === null) {
      store.setState({ lobby: { ...lobby, error: 'lobby.error.code' } });
      return;
    }
    store.setState({ lobby: { ...lobby, step, room: code, error: null, needsPasscode: false } });
  }

  /** The green room's name field, and the tag over your avatar (saved only when you join). */
  previewName(nameRaw: string): void {
    const rt = this.host.runtime;
    const store = this.host.store;
    const lobby = store.getState().lobby;
    if (!rt || !lobby) return;
    store.setState({ lobby: { ...lobby, name: nameRaw.slice(0, 24) } });
    rt.sim.rename(rt.sim.selfId, cleanName(nameRaw, this.host.translate()('player.defaultName')));
  }

  join(roomRaw: string, nameRaw: string, passcode: string): void {
    const rt = this.host.runtime;
    const store = this.host.store;
    if (!rt) return;
    const typed = roomRaw.trim();
    const code = typed ? normalizeRoomCode(typed) : null;
    const lobby = store.getState().lobby;
    if (typed && !code) {
      if (lobby) store.setState({ lobby: { ...lobby, error: 'lobby.error.code' } });
      return;
    }
    const name = cleanName(nameRaw, this.host.translate()('player.defaultName'));
    this.host.persist({ name });
    rt.sim.rename(rt.sim.selfId, name);
    store.setState({ playerName: name, typing: false });
    this.host.removeBots();
    this.mode = 'online';
    // The Join click is the user gesture that lets audio (and a granted microphone) start.
    void rt.voice.local.prepare();
    rt.net.join(code, name, passcode);
  }

  playOffline(): void {
    this.mode = 'offline';
    this.host.store.setState({ lobby: null, net: 'offline', room: null, typing: false });
    this.host.inviteBots();
  }

  /** Leaves the online room and shows the lobby again (prefilled with the same code). */
  leave(): void {
    const code = this.host.store.getState().room?.code ?? '';
    this.host.runtime?.net.leave();
    this.setAddressRoom(null);
    this.openLobby(code);
  }

  copyInvite(): void {
    const { store, platform } = this.host;
    const code = store.getState().room?.code;
    if (!code) return;
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('room', code);
    platform.clipboard.writeText(url.toString()).then(
      () => pushToast(store, 'toast.inviteCopied'),
      () => pushToast(store, 'toast.inviteFailed', 'warn', { code }),
    );
  }

  /** Puts the room code in the address bar, so a reload or a copied URL comes back here. */
  setAddressRoom(code: string | null): void {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    url.searchParams.delete('autojoin');
    url.searchParams.delete('passcode');
    window.history.replaceState(null, '', url);
  }
}
