import { throwRoomOf, type ProjectileEvent, type WorldView } from '@huddle/engine';
import type { CanvasFactory } from '@huddle/platform';
import type { Logger, ResolvedRoom } from '@huddle/shared';
import * as THREE from 'three';
import { AvatarMaterials } from './avatar/avatar-materials.ts';
import { AvatarSystem, type AvatarSystemHooks } from './avatar/avatar-system.ts';
import { isMesh, materialsOf } from './core/dispose.ts';
import { StatsMeter, type RenderStats } from './core/render-stats.ts';
import { RendererHost } from './core/renderer-host.ts';
import { MaterialLibrary } from './materials/library.ts';
import type { TextureBundle } from './materials/texture-bundle.ts';
import { PostPipeline, type ToneLook } from './post/pipeline.ts';
import { AutoScaler } from './quality/auto-scaler.ts';
import { detectGpuTier, type GpuInfo } from './quality/gpu-tier.ts';
import { QUALITY_PRESETS, type QualityChoice, type QualitySettings } from './quality/presets.ts';
import { roomProbeBox } from './scene/architecture.ts';
import type { BoardSurface } from './scene/board.ts';
import type { DecalLayer } from './scene/decals.ts';
import {
  captureRoomEnvironment,
  createSeedEnvironment,
  type LightScene,
} from './scene/lighting.ts';
import { Markers } from './scene/markers.ts';
import type { ScoreRow } from './scene/play-handles.ts';
import { buildRoomScene, type RoomScene } from './scene/room-builder.ts';
import type { MainScreen } from './scene/screen.ts';
import { ThrowFx } from './scene/throw-fx.ts';

export interface GameRendererOptions {
  canvas: HTMLCanvasElement;
  logger: Logger;
  /** Resolves room color references (palette keys or hex) to `#RRGGBB`. */
  resolveColor: (ref: string) => string;
  canvasFactory: CanvasFactory;
  textures: TextureBundle;
  mobile: boolean;
  deviceMemoryGb: number | null;
  avatarHooks: AvatarSystemHooks;
}

const PROBE_HEIGHT = 1.55;

/**
 * Orchestrates the three.js side: room scene, avatars, markers, post-FX and quality. Reads the
 * engine `WorldView` only; it never mutates simulation state.
 */
export class GameRenderer {
  readonly host: RendererHost;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.03, 200);
  readonly gpu: GpuInfo;
  readonly stats: RenderStats;
  readonly avatars: AvatarSystem;
  /** Thrown objects, aiming arc, particle bursts and splats. */
  readonly fx = new ThrowFx();
  private readonly logger: Logger;
  private readonly projected = new THREE.Vector3();
  private readonly options: GameRendererOptions;
  private readonly library: MaterialLibrary;
  private readonly avatarMaterials: AvatarMaterials;
  private readonly post: PostPipeline;
  private readonly scaler: AutoScaler;
  private room: RoomScene | null = null;
  private resolved: ResolvedRoom | null = null;
  private markers: Markers | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envSize = 0;
  private envBase = 1;
  private qualityChoice: QualityChoice = 'auto';
  private settings: QualitySettings;
  private readonly seatHeights = new Map<string, number>();
  private scores: readonly ScoreRow[] = [];
  private time = 0;
  private readonly meter: StatsMeter;
  private readonly targetFps: number;

  constructor(options: GameRendererOptions) {
    this.options = options;
    this.logger = options.logger.child('render');
    this.host = new RendererHost({
      canvas: options.canvas,
      logger: this.logger,
      onContextLost: () => undefined,
      onContextRestored: () => this.onContextRestored(),
    });
    // Post passes render the scene several times per frame (bloom selection, probes); shadow maps
    // are refreshed once per frame instead of on every one of those renders.
    this.host.renderer.shadowMap.autoUpdate = false;
    const gl = this.host.renderer.getContext() as WebGL2RenderingContext;
    this.gpu = detectGpuTier(gl, options.mobile, options.deviceMemoryGb);
    this.targetFps = options.mobile ? 30 : 60;
    this.settings = { ...QUALITY_PRESETS[this.gpu.tier] };
    this.scaler = new AutoScaler(this.gpu.tier, this.targetFps);
    this.library = new MaterialLibrary(options.textures, this.settings.anisotropy);
    this.avatarMaterials = new AvatarMaterials(this.library);
    this.avatars = new AvatarSystem(this.avatarMaterials, options.avatarHooks);
    this.scene.add(this.avatars.group, this.fx.group);
    this.post = new PostPipeline(this.host.renderer, this.scene, this.camera);
    this.meter = new StatsMeter(this.settings.level, this.gpu.renderer);
    this.stats = this.meter.stats;
    this.logger.info('gpu tier', {
      renderer: this.gpu.renderer,
      tier: this.gpu.tier,
      reason: this.gpu.reason,
    });
  }

  get screen(): MainScreen | null {
    return this.room?.screen ?? null;
  }

  get quality(): QualitySettings {
    return this.settings;
  }

  get decals(): DecalLayer | null {
    return this.room?.decals ?? null;
  }

  get lightScene(): LightScene {
    return this.room?.lights.scene ?? 'meeting';
  }

  board(id: string): BoardSurface | undefined {
    return this.room?.boards.get(id);
  }

  /** Starts an emote / reaction animation on a player's avatar (render clock). */
  playAction(playerId: string, actionId: string): void {
    this.avatars.playAction(playerId, actionId, this.time);
  }

  stopAction(playerId: string, actionId: string): void {
    this.avatars.stopAction(playerId, actionId);
  }

  /** Visual side of a projectile event (particles, splats on walls and people, the net). */
  handleProjectile(ev: ProjectileEvent): void {
    this.fx.handle(ev, this.time, this.room?.decals ?? null);
    if (ev.type === 'splat' && ev.targetId !== null)
      this.avatars.splat(ev.targetId, ev.point, ev.normal);
    else if (ev.type === 'ghost') this.avatars.ghost(ev.targetId);
    else if (ev.type === 'score') this.room?.play.hoops.get(ev.goalId)?.swish(this.time);
  }

  /** Mops the room: splats fade away in a wave from `origin` (where the mop is). */
  clearMess(origin: { x: number; y: number; z: number } | null = null): void {
    this.room?.decals.sweep(this.time, origin);
    this.avatars.sweepSplats();
  }

  /** What the hoop scoreboards show (kept across room rebuilds). */
  setScores(rows: readonly ScoreRow[]): void {
    this.scores = rows;
    for (const board of this.room?.play.scoreboards ?? []) board.draw(rows);
  }

  /** Party mode: trails behind thrown things, confetti on baskets. */
  get party(): boolean {
    return this.fx.party;
  }

  set party(on: boolean) {
    this.fx.party = on;
  }

  get renderTime(): number {
    return this.time;
  }

  setLightScene(scene: LightScene, instant = false): void {
    this.room?.lights.setScene(scene, instant);
    this.room?.screen.setGlowStrength(
      scene === 'presentation' ? 1.35 : scene === 'party' ? 1.6 : 1,
    );
  }

  /**
   * Builds the room, pre-compiles every shader in parallel (KHR_parallel_shader_compile) against
   * a seed probe of the final variant, then captures the real room light probe.
   */
  async loadRoom(room: ResolvedRoom): Promise<void> {
    this.buildRoom(room);
    const size = this.settings.envSize;
    const seed = createSeedEnvironment(
      this.host.renderer,
      new THREE.Color(0.16, 0.155, 0.15),
      size,
    );
    this.scene.environment = seed.texture;
    const t0 = performance.now();
    try {
      await this.host.renderer.compileAsync(this.scene, this.camera);
    } catch (err: unknown) {
      this.logger.warn('parallel shader compile failed; compiling on first frame', err);
    }
    this.logger.info('shaders compiled', { ms: Math.round(performance.now() - t0) });
    const finalSize = this.settings.envSize;
    this.captureEnvironment(finalSize, finalSize === size ? seed.texture : undefined);
    seed.dispose();
  }

  private buildRoom(room: ResolvedRoom): void {
    this.unloadRoom();
    this.resolved = room;
    const built = buildRoomScene({
      room,
      library: this.library,
      canvas: this.options.canvasFactory,
      resolveColor: this.options.resolveColor,
      logger: this.logger,
      areaLight: true,
    });
    this.room = built;
    this.scene.add(built.root);
    this.fx.setRoom(throwRoomOf(room));
    for (const board of built.play.scoreboards) board.draw(this.scores);
    this.envBase = room.data.lighting.envIntensity;
    this.markers = new Markers(room);
    this.scene.add(this.markers.group);
    this.seatHeights.clear();
    const props = new Map(room.data.props.map((p) => [p.id, p]));
    for (const s of room.seats) {
      const floorY = props.get(s.propId)?.position[1] ?? 0;
      this.seatHeights.set(s.id, s.position[1] - floorY);
    }
    this.post.setBloomObjects([...built.bloom, ...this.markers.bloom]);
    this.applySettings(this.settings, false);
  }

  setQuality(choice: QualityChoice): void {
    this.qualityChoice = choice;
    this.stats.qualityChoice = choice;
    const level = choice === 'auto' ? this.gpu.tier : choice;
    this.scaler.reset(level, this.targetFps);
    this.scaler.enabled = choice === 'auto';
    this.host.setResolutionScale(1);
    this.applySettings({ ...QUALITY_PRESETS[level] });
  }

  setLook(look: ToneLook, exposure = 1): void {
    this.post.setLook(look, exposure);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.host.setSize(width, height, pixelRatio);
    this.camera.aspect = this.host.aspect;
    this.camera.updateProjectionMatrix();
    this.syncPostSize();
  }

  /** Projects a world point to CSS pixels (last rendered camera); false when behind the camera. */
  project(
    world: { x: number; y: number; z: number },
    out: { x: number; y: number; depth: number },
  ): boolean {
    const v = this.projected.set(world.x, world.y, world.z);
    out.depth = this.camera.position.distanceTo(v);
    v.project(this.camera);
    const { width, height } = this.host.size;
    out.x = (v.x * 0.5 + 0.5) * width;
    out.y = (-v.y * 0.5 + 0.5) * height;
    return v.z < 1 && v.z > -1;
  }

  render(view: WorldView, dt: number, wallMs: number): void {
    if (this.host.isContextLost || !this.room) return;
    const t0 = performance.now();
    this.time += dt;
    const c = view.camera;
    this.camera.position.set(c.position.x, c.position.y, c.position.z);
    this.camera.lookAt(c.target.x, c.target.y, c.target.z);
    if (Math.abs(this.camera.fov - c.fov) > 0.01) {
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }
    this.room.update(dt, this.time, wallMs, this.camera);
    this.scene.environmentIntensity = this.envBase * this.room.lights.envLevel;
    this.room.screen.setHover(view.hover.kind === 'screen');
    this.markers?.update(view, this.time, dt);
    this.avatars.update(view, this.camera, dt, this.time, (id) => this.seatHeights.get(id) ?? 0.45);
    this.fx.eye.copy(this.camera.position);
    this.fx.update(view, dt, this.time);
    if (this.qualityChoice === 'auto') this.autoScale(dt);

    const r = this.host.renderer;
    r.info.reset();
    r.shadowMap.needsUpdate = true;
    this.post.render(dt);
    this.meter.update(this.host, dt, performance.now() - t0, this.room?.decals.activeDynamic ?? 0);
  }

  dispose(): void {
    this.unloadRoom();
    this.avatars.dispose();
    this.fx.dispose();
    this.avatarMaterials.dispose();
    this.post.dispose();
    this.library.dispose();
    this.host.dispose();
  }

  /** Re-captures the room light probe (after lighting or quality changes that alter the room). */
  private captureEnvironment(size: number, seed?: THREE.Texture): void {
    const room = this.resolved;
    if (!room || !this.room) return;
    const t0 = performance.now();
    const box = roomProbeBox(room);
    const probe = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      PROBE_HEIGHT,
      (box.min.z + box.max.z) / 2,
    );
    const avatarsVisible = this.avatars.group.visible;
    const markersVisible = this.markers?.group.visible ?? false;
    this.avatars.group.visible = false;
    this.fx.group.visible = false;
    if (this.markers) this.markers.group.visible = false;
    const previous = this.envTarget;
    // One shadow refresh serves all twelve cube faces of the capture.
    this.host.renderer.shadowMap.needsUpdate = true;
    // Reuse the current probe as the seed when re-capturing at the same size.
    const ownSeed = seed
      ? null
      : createSeedEnvironment(this.host.renderer, new THREE.Color(0.16, 0.155, 0.15), size);
    const target = captureRoomEnvironment(
      this.host.renderer,
      this.scene,
      probe,
      size,
      seed ?? ownSeed?.texture ?? null,
    );
    ownSeed?.dispose();
    previous?.dispose();
    this.envTarget = target;
    this.envSize = size;
    this.scene.environment = target.texture;
    this.library.envProjection.setBox(box.min, box.max, probe);
    this.avatars.group.visible = avatarsVisible;
    this.fx.group.visible = true;
    if (this.markers) this.markers.group.visible = markersVisible;
    this.logger.info('room light probe captured', { size, ms: Math.round(performance.now() - t0) });
  }

  private autoScale(dt: number): void {
    const d = this.scaler.sample(dt * 1000, dt);
    if (d.changed === 'none') return;
    this.host.setResolutionScale(d.resolutionScale);
    this.syncPostSize();
    if (d.changed === 'settings') this.applySettings(d.settings);
    this.logger.info('auto quality', {
      scale: d.resolutionScale,
      ao: d.settings.ao,
      bloom: d.settings.bloom,
    });
  }

  private applySettings(s: QualitySettings, capture = true): void {
    this.settings = s;
    this.stats.quality = s.level;
    this.host.setPixelRatioCap(s.pixelRatioCap);
    this.library.setAnisotropy(s.anisotropy);
    this.avatars.setLodDistance(s.lodDistance);
    this.avatarMaterials.setRichShading(s.richAvatars);
    const room = this.room;
    if (room) {
      room.lights.setQuality(s.level, s.shadowMapSize, s.shadowSoft);
      room.decals.setBudget(s.maxDecals);
      room.screen.setGlowMode(s.screenGlow);
      if (capture && this.envTarget && this.envSize !== s.envSize)
        this.captureEnvironment(s.envSize);
    }
    this.post.configure(s);
    this.syncPostSize();
  }

  private syncPostSize(): void {
    const { width, height } = this.host.size;
    const pr = this.host.pixelRatio;
    this.post.setSize(Math.round(width * pr), Math.round(height * pr));
  }

  private unloadRoom(): void {
    if (this.room) {
      this.scene.remove(this.room.root);
      this.room.dispose();
      this.room = null;
    }
    if (this.markers) {
      this.scene.remove(this.markers.group);
      this.markers.dispose();
      this.markers = null;
    }
    this.envTarget?.dispose();
    this.envTarget = null;
    this.envSize = 0;
    this.scene.environment = null;
  }

  private onContextRestored(): void {
    // GPU-side content (PMREM, render targets) is gone; rebuild what cannot be re-uploaded.
    const room = this.resolved;
    if (room) {
      this.loadRoom(room).catch((err: unknown) =>
        this.logger.error('room rebuild after context loss failed', err),
      );
    }
    this.scene.traverse((o) => {
      if (!isMesh(o)) return;
      for (const m of materialsOf(o)) m.needsUpdate = true;
    });
  }
}
