import {
  createTranslator,
  LOCALES,
  pickLocale,
  resolveColorRef,
  type Locale,
} from '@huddle/content';
import {
  Simulation,
  SwitchableSeatArbiter,
  type PhysicsWorld,
  type WalkGrid,
} from '@huddle/engine';
import type { PlatformServices } from '@huddle/platform';
import {
  CLOTH_COLORS,
  EYE_COLORS,
  GameRenderer,
  HAIR_COLORS,
  SKIN_TONES,
  type TextureBundle,
} from '@huddle/render';
import {
  createInputFrame,
  decodeAvatar,
  DEFAULT_AVATAR,
  encodeAvatar,
  errorMessage,
  type AvatarSpec,
  type Logger,
  type ResolvedRoom,
} from '@huddle/shared';
import {
  createHudStore,
  mountHud,
  pushChat,
  type AvatarPreviewHandle,
  type HudStore,
  type Translate,
} from '@huddle/ui';
import { AvatarMeshService } from './avatar-meshes.ts';
import { mountAvatarPreview } from './avatar-preview-host.ts';
import { DemoCrew } from './demo-bots.ts';
import { DemoScreen } from './demo-screen.ts';
import { createHudCommands, type CommandHost } from './hud-commands.ts';
import { closeTopmost, wireKeyActions, type KeyHost } from './key-actions.ts';
import { LobbyCamera } from './lobby-camera.ts';
import { ENABLED_KINDS, isLightScene, wireRoomActions } from './room-actions.ts';
import { realtimeUrl, RoomFlow, type RoomFlowHost } from './room-flow.ts';
import { createRuntime, type Runtime } from './runtime.ts';
import {
  cleanName,
  loadUserSettings,
  saveUserSettings,
  type UserSettings,
} from './user-settings.ts';

export interface GameAppOptions {
  platform: PlatformServices;
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
}

/**
 * Composition root for the web client: wires platform services, simulation, renderer and HUD,
 * and runs the frame loop outside React.
 */
export class GameApp implements CommandHost, KeyHost, RoomFlowHost {
  readonly store: HudStore;
  readonly platform: PlatformServices;
  /** Lobby, online room or offline play. */
  readonly flow: RoomFlow;
  runtime: Runtime | null = null;
  /** Optional gaze override per player (photo mode, cinematics). */
  lookOverride: ((playerId: string) => { x: number; y: number; z: number } | null) | null = null;
  private readonly log: Logger;
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;
  private userSettings: UserSettings;
  private readonly demo: DemoScreen;
  private readonly crew = new DemoCrew((id, spec) => this.specs.set(id, spec));
  private readonly lobbyCam = new LobbyCamera();
  /** `?render=0` keeps simulation and networking but skips drawing (CI without a GPU). */
  private readonly renderEnabled =
    new URLSearchParams(window.location.search).get('render') !== '0';
  private frameId = 0;
  private last = 0;
  private visible = true;
  private readonly frame = createInputFrame();
  private readonly specs = new Map<string, AvatarSpec>();
  private readonly meshes: AvatarMeshService;
  private readonly translators = new Map<string, Translate>();
  private readonly disposers: (() => void)[] = [];

  constructor(options: GameAppOptions) {
    this.platform = options.platform;
    this.canvas = options.canvas;
    this.uiRoot = options.uiRoot;
    this.flow = new RoomFlow(this);
    this.log = options.platform.logger.child('app');
    this.meshes = new AvatarMeshService(this.log.child('avatars'));
    this.demo = new DemoScreen(options.platform);
    const caps = options.platform.capabilities;
    this.userSettings = loadUserSettings(options.platform.storage, caps.reducedMotion, (err) =>
      this.log.warn('settings were corrupt, using defaults', errorMessage(err)),
    );
    const s = this.userSettings;
    const locale: Locale =
      s.locale === 'en' || s.locale === 'id'
        ? s.locale
        : pickLocale(options.platform.preferences.preferredLanguages());
    this.store = createHudStore({
      locale,
      bindings: s.bindings,
      touch: caps.touch && caps.mobile,
      quality: s.quality,
      look: s.look,
      reducedMotion: s.reducedMotion,
      sfxVolume: s.sfxVolume,
      ambienceVolume: s.ambienceVolume,
      avatarPalette: { skin: SKIN_TONES, hair: HAIR_COLORS, cloth: CLOTH_COLORS, eye: EYE_COLORS },
    });
    this.disposers.push(
      mountHud({
        element: this.uiRoot,
        store: this.store,
        commands: createHudCommands(this),
        translatorFor: (l) => this.translatorFor(l),
        locales: LOCALES,
      }),
    );
    // Browsers keep audio suspended until a user gesture.
    const unlock = (): void => this.runtime?.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.disposers.push(() => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    });
  }

  get settings(): UserSettings {
    return this.userSettings;
  }

  get sim(): Simulation | null {
    return this.runtime?.sim ?? null;
  }

  get renderer(): GameRenderer | null {
    return this.runtime?.renderer ?? null;
  }

  setLoading(key: string, progress: number): void {
    this.store.setState({ phase: 'loading', loadingKey: key, loadingProgress: progress });
  }

  fail(err: unknown): void {
    this.log.error('boot failed', errorMessage(err));
    this.store.setState({ phase: 'error', errorMessage: errorMessage(err) });
  }

  /** Builds the world once room data, physics and textures are ready. */
  async start(room: ResolvedRoom, physics: PhysicsWorld, textures: TextureBundle): Promise<void> {
    const p = this.platform;
    const t = this.translate();
    const arbiter = new SwitchableSeatArbiter();
    const sim = new Simulation({ room, physics, selfId: 'local', seatArbiter: arbiter });
    sim.reducedMotion = this.userSettings.reducedMotion;
    for (const kind of ENABLED_KINDS) sim.interaction.enabledKinds.add(kind);
    const name = cleanName(this.userSettings.name, t('player.defaultName'));
    this.specs.set(
      'local',
      this.userSettings.avatar ? decodeAvatar(this.userSettings.avatar) : DEFAULT_AVATAR,
    );
    sim.spawnLocalPlayer(name);
    sim.play.setShield(this.userSettings.dontHitMe);
    const renderer = new GameRenderer({
      canvas: this.canvas,
      logger: p.logger,
      resolveColor: (ref) => resolveColorRef(ref),
      canvasFactory: p.canvas,
      textures,
      mobile: p.capabilities.mobile,
      deviceMemoryGb: p.capabilities.deviceMemoryGb,
      avatarHooks: {
        specFor: (id) => this.specs.get(id) ?? DEFAULT_AVATAR,
        talkFor: (id) => this.runtime?.voice.talkLevel(id) ?? 0,
        buildMesh: (spec) => this.meshes.build(spec, spec === this.specs.get('local')),
        lookTargetFor: (id) => this.lookOverride?.(id) ?? null,
        onError: (err) => this.log.warn('avatar build failed', errorMessage(err)),
      },
    });
    renderer.setQuality(this.userSettings.quality);
    renderer.setLook(this.userSettings.look);
    renderer.fx.reducedMotion = this.userSettings.reducedMotion;
    this.setLoading('app.loadingLights', 0.94);
    await renderer.loadRoom(room);
    const applySize = (): void => {
      const size = p.viewport.getSize();
      renderer.resize(size.width, size.height, size.pixelRatio);
      sim.aspect = size.width / size.height;
    };
    applySize();

    const rt = createRuntime({
      platform: p,
      sim,
      renderer,
      canvas: this.canvas,
      uiRoot: this.uiRoot,
      store: this.store,
      log: this.log,
      settings: this.userSettings,
      t: () => this.translate(),
      restoreScreen: () => this.demo.show(),
      fallbackStream: () => this.demo.stream,
      serverUrl: realtimeUrl(window.location),
      arbiter,
      setAvatar: (id, encoded) => this.setAvatarSpec(id, decodeAvatar(encoded)),
      localAvatar: () => encodeAvatar(this.avatarSpec('local')),
      onJoined: (code) => this.flow.setAddressRoom(code),
      voicePrefs: () => this.userSettings,
      persist: (patch) => this.persist(patch),
      setLightScene: (scene) => this.setLightScene(scene),
    });
    const { input, labels, sfx, board, share, feed, net, voice, play } = rt;
    this.runtime = rt;
    this.disposers.push(
      p.viewport.onResize(applySize),
      ...feed.attach(),
      ...net.attach(),
      // After the network session: remote people exist before their hands and scores land.
      ...play.attach(),
      ...voice.attach(),
      ...share.attach(),
      rt.soundscape.attachClicks(this.uiRoot),
      ...wireRoomActions({
        sim,
        renderer,
        store: this.store,
        sfx,
        board,
        share,
        setLightScene: (scene) => this.setLightScene(scene),
      }),
      wireKeyActions(rt, this),
      p.lifecycle.onVisibilityChange((v) => {
        this.visible = v;
        this.last = p.clock.now();
      }),
      // Closing the tab says goodbye, so nobody sees a frozen "away" avatar for the grace window.
      p.lifecycle.onBeforeExit(() => net.leave()),
      () => {
        share.dispose();
        voice.dispose();
        input.dispose();
        labels.dispose();
      },
    );
    this.demo.start(renderer, window.location.search);
    this.store.setState({
      phase: 'ready',
      roomName: `room.${room.data.id}`,
      playerName: name,
      lightScene: renderer.lightScene,
    });
    pushChat(this.store, {
      playerId: null,
      name: '',
      text: t('feed.welcome', { room: t(`room.${room.data.id}`) }),
      kind: 'system',
      color: '',
    });
    this.flow.begin(new URLSearchParams(window.location.search));
    this.last = p.clock.now();
    this.frameId = p.frames.request(this.tick);
  }

  /**
   * Installs the walk grid (baked in a worker). Offline, the office-mates come once it is ready,
   * so they can path around the furniture. `null` when baking failed: bots come anyway.
   */
  installWalkGrid(grid: WalkGrid | null): void {
    const sim = this.runtime?.sim;
    if (!sim) return;
    if (grid) sim.setWalkGrid(grid);
    this.crew.gridReady = true;
    if (this.flow.mode === 'offline') this.inviteBots();
  }

  /** AI office-mates for offline play (they wait for the walk grid). */
  inviteBots(): void {
    if (this.runtime) this.crew.invite(this.runtime.sim, window.location.search);
  }

  /** Online rooms have real people instead. */
  removeBots(): void {
    if (this.runtime) this.crew.dismiss(this.runtime.sim);
  }

  avatarSpec(playerId: string): AvatarSpec {
    return this.specs.get(playerId) ?? DEFAULT_AVATAR;
  }

  /** Changes a player's look; the renderer rebuilds the sculpted mesh in the background. */
  setAvatarSpec(playerId: string, spec: AvatarSpec): void {
    this.specs.set(playerId, spec);
    this.runtime?.renderer.avatars.refreshSpec(playerId);
  }

  persist(patch: Partial<UserSettings>): void {
    this.userSettings = { ...this.userSettings, ...patch };
    saveUserSettings(this.platform.storage, this.userSettings);
  }

  say(text: string): void {
    const rt = this.runtime;
    if (rt && !(rt.net.online && rt.net.say(text))) rt.feed.say(text);
  }

  setLocale(locale: string): void {
    this.persist({ locale });
    this.store.setState({ locale });
    document.documentElement.lang = locale;
  }

  setLightScene(scene: string): void {
    const rt = this.runtime;
    if (!rt || !isLightScene(scene) || scene === rt.renderer.lightScene) return;
    rt.renderer.setLightScene(scene);
    rt.sfx.play('switch', null, 0.7);
    this.store.setState({ lightScene: scene });
  }

  clearMess(): void {
    this.runtime?.play.clean();
  }

  openAvatarEditor(open: boolean): void {
    if (!open) {
      // The name field disappears with the editor, possibly without a blur event.
      this.store.setState({ avatarOpen: false, typing: false });
      return;
    }
    const local = this.runtime?.sim.view.localPlayer;
    this.store.setState({
      avatarOpen: true,
      avatarSpec: this.avatarSpec('local'),
      playerName: local?.name ?? '',
    });
  }

  mountAvatarPreview(canvas: HTMLCanvasElement): AvatarPreviewHandle {
    return mountAvatarPreview(canvas, (spec) => this.meshes.build(spec, true), this.platform);
  }

  setLobbyInsets(left: number, bottom: number): void {
    this.lobbyCam.setInsets(left, bottom);
  }

  saveAvatar(spec: AvatarSpec, name: string): void {
    const sim = this.runtime?.sim;
    const clean = cleanName(
      name,
      sim?.view.localPlayer?.name ?? this.translate()('player.defaultName'),
    );
    this.setAvatarSpec('local', spec);
    this.persist({ avatar: encodeAvatar(spec), name: clean });
    sim?.rename(sim.selfId, clean);
    sim?.emote('wave');
    this.runtime?.net.profile(clean, encodeAvatar(spec));
    // The green room's name field shows the saved name too.
    const lobby = this.store.getState().lobby;
    this.store.setState({
      playerName: clean,
      ...(lobby ? { lobby: { ...lobby, name: clean } } : {}),
    });
  }

  retry(): void {
    window.location.reload();
  }

  back(): void {
    closeTopmost(this);
  }

  dispose(): void {
    this.platform.frames.cancel(this.frameId);
    this.runtime?.net.leave();
    for (const d of this.disposers.splice(0)) d();
    this.demo.dispose();
    this.runtime?.renderer.dispose();
    this.runtime?.sim.dispose();
    this.runtime = null;
    this.meshes.dispose();
  }

  translate(): Translate {
    return this.translatorFor(this.store.getState().locale);
  }

  private translatorFor(locale: string): Translate {
    let t = this.translators.get(locale);
    if (!t) {
      t = createTranslator(locale === 'id' ? 'id' : 'en');
      this.translators.set(locale, t);
    }
    return t;
  }

  private readonly tick = (): void => {
    const p = this.platform;
    const now = p.clock.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.runtime) this.step(this.runtime, dt);
    this.frameId = p.frames.request(this.tick);
  };

  private step(rt: Runtime, dt: number): void {
    const s = this.store.getState();
    rt.input.setGameplayEnabled(
      !(s.typing || s.settingsOpen || s.avatarOpen || s.theater !== null || s.lobby !== null),
    );
    const f = this.frame;
    rt.input.sample(f);
    rt.net.beforeFrame();
    this.lobbyCam.update(rt.sim, dt, s.lobby?.step ?? null);
    rt.driver.frame(f, dt);
    rt.net.afterFrame(dt);
    rt.board.update(f);
    rt.feed.update();
    rt.play.update();
    rt.soundscape.update(rt.sim.view);
    this.demo.update(dt);
    rt.bridge.sync(rt.sim, rt.renderer, dt, f, rt.board.boardId !== null, rt.presence);
    // After the bridge: name tags of newcomers exist before their voice state lands on them.
    rt.voice.update(dt);
    const cam = rt.sim.view.camera;
    rt.sfx.setListener(cam.position, cam.target);
    rt.labels.setVisible(s.theater === null);
    rt.labels.update(rt.sim.simTime);
    if (!this.visible || !this.renderEnabled) return;
    rt.renderer.render(rt.sim.view, dt, this.platform.clock.wallNow());
    rt.bridge.placeLabels(rt.sim.view, rt.renderer, rt.presence);
  }
}
