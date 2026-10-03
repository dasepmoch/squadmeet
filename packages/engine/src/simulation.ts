import {
  actionBit,
  copyInputFrame,
  createInputFrame,
  v3,
  type InputFrame,
  type ResolvedRoom,
  type Vec3,
} from '@huddle/shared';
import { BotHost } from './bots/bot-host.ts';
import {
  createCameraContext,
  createCameraInput,
  fillCameraInput,
  followSeatPhase,
  syncCameraContext,
  writeCameraView,
} from './camera/camera-host.ts';
import { CameraRig, type CameraContext, type CameraMode } from './camera/camera-rig.ts';
import { Character, PlayerIdentity, Remote, SeatOccupancy } from './components.ts';
import { World, type Entity } from './ecs/world.ts';
import { EventBus } from './events.ts';
import { InteractionSystem, type PromptView } from './interaction/interaction-system.ts';
import { ItemSystem } from './items/held-items.ts';
import { LocalController } from './local-controller.ts';
import { LocalPlay } from './local-play.ts';
import { Navigator } from './nav/navigator.ts';
import type { WalkGrid } from './nav/walk-grid.ts';
import type { PhysicsWorld } from './physics/physics-world.ts';
import { placePlayer } from './players.ts';
import { AimPreview } from './projectiles/aim-preview.ts';
import { throwRoomOf } from './projectiles/launch.ts';
import type { ProjectileEvent } from './projectiles/projectile-system.ts';
import { ThrowSystem, type ThrowLaunch, type ThrowRefusal } from './projectiles/throw-system.ts';
import type { ThrowKind } from './projectiles/throwables.ts';
import { RemotePlayers, stepRemote } from './remote-players.ts';
import { PlayerRoster } from './roster.ts';
import { LocalSeatArbiter } from './seats/seat-arbiter.ts';
import { SeatSystem, type SeatSystemEvent } from './seats/seat-system.ts';
import type { BotSpawnOptions, SeatEvent, SimEvents, SimulationOptions } from './sim-events.ts';
import { handQueue, HIT_REACTION, SocialSystem } from './social.ts';
import { spawnPose, type SpawnContext } from './spawning.ts';
import { stepLocalMovement } from './systems/local-movement.ts';
import { WorldView, type PlayerView } from './world-view.ts';

const JUMP = actionBit('jump');
const SPRINT = actionBit('sprint');
const CAMERA_CYCLE = actionBit('cameraCycle');
const CAMERA_RESET = actionBit('cameraReset');
/** Sim event for each seat system event. */
const SEAT_EVENT = { sat: 'sat', stood: 'stood', denied: 'seatDenied' } as const;

/**
 * Platform-agnostic simulation. Owns the ECS world, physics, seats, navigation, throwing, bots,
 * social state, interaction and the camera rig, and publishes a read-only `WorldView` for
 * renderers. Advanced in fixed steps by `SimDriver`.
 */
export class Simulation {
  readonly world = new World();
  readonly events = new EventBus<SimEvents>();
  readonly view: WorldView;
  readonly camera = new CameraRig();
  readonly room: ResolvedRoom;
  readonly physics: PhysicsWorld;
  readonly seats: SeatSystem;
  readonly interaction: InteractionSystem;
  readonly nav: Navigator;
  readonly throws: ThrowSystem;
  readonly items: ItemSystem;
  readonly bots: BotHost;
  readonly social: SocialSystem;
  /** The local player's held item, "Don't hit me" protection and paper-plane tilt. */
  readonly play: LocalPlay;
  readonly selfId: string;
  /** Viewport aspect ratio, set by the host on resize. */
  aspect = 16 / 9;
  reducedMotion = false;
  /** When false, clicks and the interact key are ignored (e.g. while drawing on a whiteboard). */
  localControl = true;
  /** Off when the room (mode or host) disallows throwing; gates the local player only. */
  throwsEnabled = true;
  readonly roster: PlayerRoster;
  /** People on other clients (fed by the network layer). */
  readonly remote: RemotePlayers;
  private readonly controller: LocalController;
  private time = 0;
  private readonly cameraCtx: CameraContext;
  private readonly camInput = createCameraInput();
  private readonly seatEvents: SeatSystemEvent[] = [];
  private readonly projectileEvents: ProjectileEvent[] = [];
  private readonly launches: ThrowLaunch[] = [];
  private readonly seatEye = v3.vec3();
  private readonly pointer = { x: 0, y: 0, active: false };
  /** Step input with locomotion removed while a free/overview camera uses WASD. */
  private readonly still: InputFrame = createInputFrame();
  /** Bots walk along paths only. */
  private readonly idle: InputFrame = createInputFrame();
  private readonly aimPreview = new AimPreview();
  /** Scratch target for throws at a person (the system aims at their current chest). */
  private readonly aimTarget = v3.vec3();

  constructor(options: SimulationOptions) {
    this.room = options.room;
    this.physics = options.physics;
    this.selfId = options.selfId ?? 'local';
    this.view = new WorldView(options.room);
    this.physics.addStaticColliders(options.room.colliders);
    this.seats = new SeatSystem(
      options.room.seats,
      options.seatArbiter ?? new LocalSeatArbiter(),
      this.physics,
    );
    this.interaction = new InteractionSystem(options.room, this.physics, this.seats);
    this.nav = new Navigator(this.world, this.seats);
    this.social = new SocialSystem(this.world, this.events);
    this.throws = new ThrowSystem(
      this.world,
      this.physics,
      (id) => this.roster.entityOf(id),
      throwRoomOf(options.room),
    );
    this.view.projectiles = this.throws.projectiles.views;
    const items = new ItemSystem({
      world: this.world,
      events: this.events,
      social: this.social,
      projectiles: this.throws.projectiles,
    });
    this.items = items;
    this.interaction.dynamic = () => items.pickupTargets();
    this.events.on('playerRemoved', (e) => items.forget(e.entity));
    this.play = new LocalPlay({
      items,
      social: this.social,
      local: () => this.roster.local,
      time: () => this.time,
      aim: (kind) => this.setAim(kind),
    });
    this.roster = new PlayerRoster({
      world: this.world,
      physics: this.physics,
      view: this.view,
      events: this.events,
      seats: this.seats,
      throws: this.throws,
    });
    this.remote = new RemotePlayers({
      world: this.world,
      roster: this.roster,
      seats: this.seats,
      social: this.social,
      throws: this.throws,
      items,
      events: this.events,
    });
    this.bots = new BotHost({
      world: this.world,
      seats: this.seats,
      nav: this.nav,
      players: () => this.view.players,
      act: (e, id) => this.social.act(e, id),
      throwAt: (e, kind, targetId) => {
        if (this.roster.has(targetId)) this.requestThrow(e, kind, this.aimTarget, targetId);
      },
      throwAtPoint: (e, kind, point) => this.requestThrow(e, kind, point, null),
      goals: options.room.goals,
      items,
      time: () => this.time,
      setHand: (e, raised) => this.social.setHand(e, raised, this.time),
      say: (e, line) => this.events.emit('botSay', { playerId: this.roster.idOf(e), line }),
    });
    this.controller = new LocalController({
      world: this.world,
      camera: this.camera,
      seats: this.seats,
      interaction: this.interaction,
      nav: this.nav,
      hooks: {
        onScreenClicked: (u, v) => this.events.emit('screenClicked', { u, v }),
        onInteract: (kind, id) => {
          if (kind === 'pickup') this.play.pickup(id);
          else this.events.emit('interact', { kind, id });
        },
        onFocusChanged: (focused) => this.events.emit('focusChanged', { focused }),
        onThrow: (kind, target, targetId) => this.throwAt(kind, target, targetId),
        onPlayerClicked: (id) => this.events.emit('playerClicked', { id }),
        onBoardClicked: (id) =>
          this.events.emit('boardClicked', { id, u: this.view.hover.u, v: this.view.hover.v }),
      },
    });
    this.cameraCtx = createCameraContext(options.room, this.physics);
  }

  get localPlayer(): Entity | null {
    return this.roster.local;
  }

  get simTime(): number {
    return this.time;
  }

  get navReady(): boolean {
    return this.nav.walkGrid !== null;
  }

  get prompt(): PromptView | null {
    return this.interaction.prompt;
  }

  get pathTarget(): Vec3 | null {
    return this.controller.pathTarget;
  }

  /** Item the local player is aiming (clicks throw it), or null. */
  get aim(): ThrowKind | null {
    return this.controller.aim;
  }

  setAim(kind: ThrowKind | null): void {
    this.controller.aim = this.throwsEnabled ? kind : null;
  }

  /** Installs the baked walk grid (baked off the main thread by the host). */
  setWalkGrid(grid: WalkGrid): void {
    this.nav.walkGrid = grid;
  }

  entityOf(playerId: string): Entity | undefined {
    return this.roster.entityOf(playerId);
  }

  /** Spawns the local avatar at a spawn point and makes the camera follow it. */
  spawnLocalPlayer(name: string, spawnIndex = 0): Entity {
    const { position, yaw } = spawnPose(this.spawnContext(), 0, { spawnIndex });
    const id = this.selfId;
    const e = this.roster.spawn({ id, name, isLocal: true, isBot: false, position, yaw });
    this.camera.yaw = yaw;
    return e;
  }

  /**
   * Adds an AI office-mate with a seeded personality. With `seatId` it starts at that seat and
   * sits down right away; otherwise it appears near a spawn point.
   */
  spawnBot(id: string, name: string, seed: number, options: BotSpawnOptions = {}): Entity {
    const { position, yaw, seatId } = spawnPose(this.spawnContext(), seed, options);
    const e = this.roster.spawn({ id, name, isLocal: false, isBot: true, position, yaw });
    this.bots.attach(e, seed);
    if (seatId !== null) this.nav.sit(e, seatId);
    return e;
  }

  /** Renames a player (name tags pick it up from the view). */
  rename(playerId: string, name: string): void {
    this.roster.rename(playerId, name);
  }

  removePlayer(e: Entity): void {
    this.roster.remove(e);
  }

  /** Programmatic sit (UI buttons, tests, debug hooks). */
  requestSit(seatId: string): void {
    if (this.localPlayer !== null) this.controller.sit(this.localPlayer, seatId);
  }

  requestStand(): void {
    if (this.localPlayer !== null) this.seats.requestStand(this.world, this.localPlayer);
  }

  /** Click-to-move entry point for hosts (e.g. tap on a minimap). */
  walkTo(point: Vec3): boolean {
    return this.localPlayer !== null && this.controller.walkTo(this.localPlayer, point, null);
  }

  toggleFocus(): void {
    this.controller.toggleFocus(this.localSeated);
  }

  /** Plays an emote on the local avatar (and tells everyone). */
  emote(actionId: string): void {
    if (this.localPlayer !== null) this.social.act(this.localPlayer, actionId);
  }

  /** Raises or lowers the local hand (toggles without an argument). */
  raiseHand(raised?: boolean): void {
    const e = this.localPlayer;
    if (e !== null) this.social.setHand(e, raised ?? !this.social.handRaised(e), this.time);
  }

  /** People with a raised hand, first come first served. */
  handQueue(): PlayerView[] {
    return handQueue(this.view.players);
  }

  /** Local throw at a point (or at a person). Returns false while cooling down or mid-transition. */
  throwAt(kind: ThrowKind, target: Vec3, targetId: string | null = null): boolean {
    return this.localPlayer !== null && this.requestThrow(this.localPlayer, kind, target, targetId);
  }

  /** Seconds until the local player can throw again. */
  get throwCooldown(): number {
    return this.throws.cooldownLeft(this.selfId, this.time);
  }

  /** Why the last throw request was refused (cooldown, in-flight cap, protection), or null. */
  get throwRefusal(): ThrowRefusal | null {
    return this.throws.refusal;
  }

  /** Instantly moves the local player (spawn, reconnect, debug tools). Stands up first. */
  teleport(x: number, y: number, z: number, yaw: number): void {
    const e = this.localPlayer;
    if (e === null) return;
    this.seats.reset(this.world, e);
    if (!placePlayer(this.world, e, { x, y, z }, yaw)) return;
    this.camera.yaw = yaw;
    if (this.camera.mode !== 'follow') this.camera.setMode('follow', true);
  }

  /** True while the local player sits (or is sitting down). */
  get localSeated(): boolean {
    const e = this.localPlayer;
    const phase = e === null ? undefined : this.world.get(e, SeatOccupancy)?.phase;
    return phase === 'seated' || phase === 'sittingDown';
  }

  /** Next camera view (the host's camera button). */
  cycleCamera(): void {
    this.camera.cycle(this.localSeated);
  }

  /** Switches view; `follow` means the avatar camera (the cinema view while seated). */
  setCameraView(mode: Extract<CameraMode, 'follow' | 'overview' | 'free'>): void {
    this.camera.setMode(mode === 'follow' && this.localSeated ? 'seated' : mode, false, 0.7);
  }

  /** Default framing of the current view (the host's recenter button). */
  recenterCamera(): void {
    this.camera.recenter(this.view.localPlayer?.yaw ?? this.camera.yaw, this.localSeated);
  }

  /**
   * Per-frame camera input (look, pan, zoom and, for the free/overview cameras, WASD flying),
   * applied before fixed steps so movement uses the latest camera yaw.
   */
  applyLook(input: InputFrame, frameDt = 1 / 60): void {
    if (input.pressed & CAMERA_CYCLE) this.cycleCamera();
    if (input.pressed & CAMERA_RESET) this.recenterCamera();
    const cam = fillCameraInput(input, this.camera.capturesMovement, this.camInput);
    // While aiming a paper plane the wheel tilts its wings instead of zooming.
    if (this.controller.aim === 'plane' && cam.zoom !== 0) cam.zoom = this.play.wheel(cam.zoom);
    this.camera.applyInput(cam, frameDt);
  }

  /** One fixed simulation step. */
  fixedUpdate(input: InputFrame, dt: number): void {
    this.time += dt;
    const local = this.localPlayer;
    const step = this.localInput(input);
    if (local !== null && this.localControl) this.controller.step(local, step, this.view.hover);
    this.bots.step(dt, this.time);
    const yaw = this.camera.movementYaw;
    for (const e of this.world.query(PlayerIdentity, SeatOccupancy, Character)) {
      const mine = e === local;
      const finished = this.world.has(e, Remote)
        ? stepRemote(this.world, e, dt)
        : stepLocalMovement(this.world, e, mine ? step : this.idle, mine ? yaw : 0, dt);
      if (finished) {
        if (mine) this.controller.arrived(e, finished.arriveAction);
        else this.nav.arrived(e, finished.arriveAction);
        this.events.emit('pathArrived', { entity: e });
      }
      this.seats.step(this.world, e, dt, this.seatEvents);
      for (const ev of this.seatEvents.splice(0)) this.onSeatEvent(e, ev);
    }
    this.seats.endStep();
    if (local !== null) followSeatPhase(this.camera, this.world.get(local, SeatOccupancy)?.phase);
    this.throws.release(this.time, this.launches);
    for (const launch of this.launches.splice(0)) this.events.emit('thrown', launch);
    this.throws.steer(dt);
    this.physics.step(dt);
    this.throws.collide(dt, this.projectileEvents);
    for (const ev of this.projectileEvents.splice(0)) this.onProjectileEvent(ev);
    this.items.step(this.time);
    this.view.projectilesVersion = this.throws.projectiles.version;
  }

  /** Interpolates render state, updates the camera, hover, prompt and aim. Once per rendered frame. */
  postStep(input: InputFrame, frameDt: number, alpha: number): void {
    this.view.time = this.time;
    this.view.alpha = alpha;
    this.roster.writeViews(alpha);

    const local = this.view.localPlayer;
    const ctx = this.cameraCtx;
    syncCameraContext(ctx, local, this.seats, input, this.seatEye);
    ctx.aspect = this.aspect;
    ctx.reducedMotion = this.reducedMotion;
    this.camera.update(frameDt, ctx);
    writeCameraView(this.camera, this.view.camera);

    this.pointer.x = input.pointerX;
    this.pointer.y = input.pointerY;
    this.pointer.active = input.pointerActive;
    this.interaction.updateHover(
      this.view.hover,
      this.camera.pose,
      this.aspect,
      this.pointer,
      this.selfId,
      this.view.players,
      this.controller.aim !== null,
    );
    this.view.prompt =
      local && this.localControl
        ? this.interaction.updatePrompt(
            local.position,
            local.yaw,
            local.seatId !== null,
            this.selfId,
          )
        : null;
    this.view.pathTarget = this.controller.pathTarget;
    this.view.aim =
      this.pointer.active && this.localControl
        ? this.aimPreview.update(this.controller.aim, local, this.view, this.play.planeTilt)
        : null;
  }

  dispose(): void {
    this.roster.removeAll();
    this.throws.clear();
    this.events.clear();
  }

  private spawnContext(): SpawnContext {
    return { world: this.world, room: this.room, seats: this.seats, grid: this.nav.walkGrid };
  }

  /** The free/overview cameras own WASD and Space; the avatar only follows clicks meanwhile. */
  private localInput(input: InputFrame): InputFrame {
    if (!this.camera.capturesMovement) return input;
    const step = this.still;
    copyInputFrame(step, input);
    step.moveX = 0;
    step.moveY = 0;
    step.held &= ~(JUMP | SPRINT);
    step.pressed &= ~JUMP;
    return step;
  }

  private requestThrow(e: Entity, kind: ThrowKind, target: Vec3, targetId: string | null): boolean {
    const local = e === this.localPlayer;
    if (local && !this.throwsEnabled) return false;
    const tilt = local ? this.play.planeTilt : 0;
    if (!this.throws.request(e, kind, target, targetId, this.time, tilt)) {
      if (local) this.events.emit('throwRefused', { reason: this.throws.refusal ?? 'busy' });
      return false;
    }
    this.social.act(e, 'throw');
    // A picked-up paper plane is the one that flies.
    if (kind === 'plane' && this.items.heldBy(e) === 'plane') this.items.hold(e, null);
    return true;
  }

  private onSeatEvent(e: Entity, ev: SeatSystemEvent): void {
    const isLocal = e === this.localPlayer;
    const payload: SeatEvent = { playerId: this.roster.idOf(e), seatId: ev.seatId, isLocal };
    this.events.emit(SEAT_EVENT[ev.type], payload);
  }

  private onProjectileEvent(ev: ProjectileEvent): void {
    if (ev.type === 'hit') {
      const target = this.roster.entityOf(ev.targetId);
      if (target !== undefined) {
        this.social.act(target, HIT_REACTION[ev.kind], true);
        this.bots.onHit(target, ev.throwerId, this.time);
      }
    }
    this.events.emit('projectile', ev);
  }
}
