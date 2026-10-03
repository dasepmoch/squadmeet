import type { PlayerView, WorldView } from '@huddle/engine';
import { clamp, encodeAvatar, wrapAngle, type AvatarSpec, type Vec3 } from '@huddle/shared';
import * as THREE from 'three';
import { AvatarAnimator, type AnimInput } from './animator.ts';
import type { AvatarMaterials } from './avatar-materials.ts';
import { AvatarProps } from './avatar-props.ts';
import { AvatarSplats } from './avatar-splats.ts';
import { createHeldModels, type HeldModels } from './held-models.ts';
import { resolveAction, type ActionSlot } from './held-props.ts';
import { ProceduralAvatar } from './procedural-avatar.ts';
import type { AvatarMeshData } from './sculpt/character.ts';

interface AvatarEntry {
  id: string;
  specKey: string;
  spec: AvatarSpec;
  avatar: ProceduralAvatar | null;
  animator: AvatarAnimator | null;
  anchor: THREE.Vector3;
  action: ActionSlot | null;
  /** Last engine action sequence seen (a change starts `PlayerView.action`). */
  actionSeq: number;
  /** Someone this avatar glances at (who just did something), until a render time. */
  glance: { id: string; until: number } | null;
  /** Held items, the mop, the "Don't hit me" shimmer. */
  props: AvatarProps | null;
  /** Local avatar looks at the camera (instead of along it) while viewed from the front. */
  eyeContact: boolean;
  /** Fade-in after the sculpted mesh arrives. */
  appear: number;
}

export interface AvatarSystemHooks {
  /** Avatar description for a player id (from presence data). */
  specFor(playerId: string): AvatarSpec;
  /** Voice amplitude 0..1 for a player id (0 until voice is connected). */
  talkFor(playerId: string): number;
  /** Builds sculpted mesh data for a spec (in a worker when available; cached by the host). */
  buildMesh(spec: AvatarSpec): Promise<AvatarMeshData>;
  /** Where a player is looking (world point), e.g. at whoever is talking; null = default. */
  lookTargetFor?(playerId: string): { x: number; y: number; z: number } | null;
  onError?(err: unknown): void;
}

const LOD_DISTANCE = 9;
const HIDE_DISTANCE = 0.6;
const GLANCE_RANGE = 7;

/** Keeps one sculpted avatar per player in sync with the engine `WorldView`. */
export class AvatarSystem {
  readonly group = new THREE.Group();
  /** Players whose avatar is hidden (e.g. the local one while drawing on the whiteboard). */
  readonly hidden = new Set<string>();
  private readonly entries = new Map<string, AvatarEntry>();
  private readonly materials: AvatarMaterials;
  private readonly hooks: AvatarSystemHooks;
  private version = -1;
  private readonly input: AnimInput = {
    dt: 0,
    time: 0,
    speed: 0,
    verticalVelocity: 0,
    grounded: true,
    sitBlend: 0,
    posture: null,
    seatHeight: 0.45,
    stride: 0,
    talk: 0,
    lookYaw: 0,
    lookPitch: 0,
    action: null,
    mood: 0.4,
  };
  private readonly actionInput = { id: '', t: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly attention: PlayerView[] = [];
  private lodDistance = LOD_DISTANCE;
  private readonly models: HeldModels;
  private readonly splats: AvatarSplats | null;
  private time = 0;

  constructor(materials: AvatarMaterials, hooks: AvatarSystemHooks) {
    this.materials = materials;
    this.hooks = hooks;
    this.group.name = 'avatars';
    this.models = createHeldModels(materials.project);
    this.splats = materials.splatAtlas ? new AvatarSplats(materials.splatAtlas) : null;
  }

  /** Tomato splats stuck on people right now. */
  get splatCount(): number {
    return this.splats?.count ?? 0;
  }

  /** A tomato burst on someone: it sticks to their shirt or face. */
  splat(playerId: string, point: Vec3, normal: Vec3): void {
    const avatar = this.entries.get(playerId)?.avatar;
    if (avatar) this.splats?.add(playerId, avatar, point, normal, this.time);
  }

  /** Something passed through a protected person: their bubble shimmers. */
  ghost(playerId: string): void {
    this.entries.get(playerId)?.props?.ghost(this.time);
  }

  /** Clean-up: splats on people fade away. */
  sweepSplats(): void {
    this.splats?.sweep(this.time);
  }

  /** Visits head-top anchors (world space) for name tags, speaking rings and chat bubbles. */
  forEachAnchor(visit: (playerId: string, anchor: THREE.Vector3) => void): void {
    for (const e of this.entries.values()) visit(e.id, e.anchor);
  }

  anchorOf(playerId: string): THREE.Vector3 | undefined {
    return this.entries.get(playerId)?.anchor;
  }

  /** The avatar object for a player (for attaching held props), when built. */
  avatarOf(playerId: string): ProceduralAvatar | null {
    return this.entries.get(playerId)?.avatar ?? null;
  }

  setLodDistance(d: number): void {
    this.lodDistance = d;
  }

  /** Starts an upper-body action directly (previews, photo tools); gameplay uses `PlayerView.action`. */
  playAction(playerId: string, actionId: string, time: number): void {
    const e = this.entries.get(playerId);
    if (e) e.action = { id: actionId, startedAt: time };
  }

  stopAction(playerId: string, actionId: string): void {
    const e = this.entries.get(playerId);
    if (e?.action?.id === actionId) e.action = null;
  }

  actionOf(playerId: string): string | null {
    return this.entries.get(playerId)?.action?.id ?? null;
  }

  /** Rebuilds an avatar whose spec changed (customizer, remote update). */
  refreshSpec(playerId: string): void {
    const e = this.entries.get(playerId);
    if (!e) return;
    const spec = this.hooks.specFor(playerId);
    const key = encodeAvatar(spec);
    if (key === e.specKey) return;
    e.specKey = key;
    e.spec = spec;
    this.requestBuild(e);
  }

  update(
    view: WorldView,
    camera: THREE.Camera,
    dt: number,
    time: number,
    seatHeights: (seatId: string) => number,
  ): void {
    this.time = time;
    if (view.playersVersion !== this.version) this.syncPlayers(view);
    const screen = view.room.screen;
    this.attention.length = 0;
    for (const p of view.players) {
      const e = this.entries.get(p.id);
      if (!e) continue;
      if (p.actionSeq !== e.actionSeq) {
        e.actionSeq = p.actionSeq;
        if (p.action) {
          e.action = { id: p.action, startedAt: time };
          e.props?.started(p.action, time);
          this.attention.push(p);
        }
      }
      e.action = resolveAction(e.action, p.handRaised, time);
      if (!e.avatar || !e.animator) {
        e.anchor.set(p.position.x, p.position.y + 1.85, p.position.z);
        continue;
      }
      const root = e.avatar.root;
      e.appear = Math.min(1, e.appear + dt * 3);
      const pop = 0.92 + 0.08 * Math.sin(Math.min(1, e.appear) * Math.PI * 0.5);
      root.scale.setScalar(pop);
      root.position.set(p.position.x, p.position.y, p.position.z);
      root.rotation.y = p.yaw;
      const i = this.input;
      i.dt = dt;
      i.time = time;
      i.speed = p.speed;
      i.verticalVelocity = p.verticalVelocity;
      i.grounded = p.grounded;
      i.sitBlend = p.sitBlend;
      i.posture = p.posture;
      i.seatHeight = p.seatId ? seatHeights(p.seatId) : 0.45;
      i.stride = p.stride;
      i.talk = this.hooks.talkFor(p.id);
      i.held = p.held;
      this.computeLook(e, p, view, screen.center, time, i);
      if (e.action) {
        this.actionInput.id = e.action.id;
        this.actionInput.t = time - e.action.startedAt;
        i.action = this.actionInput;
      } else {
        i.action = null;
      }
      e.animator.update(i);
      root.updateMatrixWorld(true);
      e.props?.update(p, i.action, time);
      e.avatar.headAnchor(e.anchor);
      const dist = camera.position.distanceTo(
        this.tmp.set(p.position.x, p.position.y + 1.3, p.position.z),
      );
      e.avatar.setVisible(!this.hidden.has(p.id) && !(p.isLocal && dist < HIDE_DISTANCE));
      e.avatar.setLod(dist > this.lodDistance ? 1 : 0);
    }
    for (const actor of this.attention) this.drawAttention(actor, view, time);
    this.splats?.update(time);
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.props?.dispose();
      e.avatar?.dispose();
    }
    this.entries.clear();
    this.splats?.dispose();
    this.models.dispose();
  }

  /** People near someone who just emoted, threw or got hit turn their heads for a moment. */
  private drawAttention(actor: PlayerView, view: WorldView, time: number): void {
    for (const p of view.players) {
      if (p === actor) continue;
      const e = this.entries.get(p.id);
      if (
        !e ||
        Math.hypot(p.position.x - actor.position.x, p.position.z - actor.position.z) > GLANCE_RANGE
      )
        continue;
      if (Math.random() < 0.75)
        e.glance = { id: actor.id, until: time + 1.2 + Math.random() * 1.6 };
    }
  }

  private requestBuild(e: AvatarEntry): void {
    const key = e.specKey;
    const spec = e.spec;
    this.hooks
      .buildMesh(spec)
      .then((data) => {
        if (!this.entries.has(e.id) || e.specKey !== key) return;
        e.props?.dispose();
        this.splats?.drop(e.id);
        e.avatar?.dispose();
        const avatar = new ProceduralAvatar(data, spec, this.materials);
        e.avatar = avatar;
        e.props = new AvatarProps(avatar, this.models);
        e.animator = new AvatarAnimator(avatar, data.anchors.lidOpen);
        e.appear = 0;
        this.group.add(avatar.root);
      })
      .catch((err: unknown) => this.hooks.onError?.(err));
  }

  private computeLook(
    e: AvatarEntry,
    p: PlayerView,
    view: WorldView,
    screen: readonly [number, number, number],
    time: number,
    out: AnimInput,
  ): void {
    let tx: number;
    let ty: number;
    let tz: number;
    const custom = this.hooks.lookTargetFor?.(p.id) ?? null;
    const glance = e.glance && e.glance.until > time ? this.entries.get(e.glance.id) : undefined;
    if (custom) {
      tx = custom.x;
      ty = custom.y;
      tz = custom.z;
    } else if (glance && !p.isLocal) {
      tx = glance.anchor.x;
      ty = glance.anchor.y - 0.4;
      tz = glance.anchor.z;
    } else if (p.seatId) {
      [tx, ty, tz] = screen;
    } else if (p.isLocal) {
      const c = view.camera;
      const lookRel = Math.abs(
        wrapAngle(Math.atan2(c.target.x - c.position.x, c.target.z - c.position.z) - p.yaw),
      );
      e.eyeContact = e.eyeContact ? lookRel > 1.8 : lookRel > 2.1;
      if (e.eyeContact) {
        tx = c.position.x;
        ty = c.position.y;
        tz = c.position.z;
      } else {
        tx = p.position.x + (c.target.x - c.position.x) * 4;
        ty = p.position.y + 1.5 + (c.target.y - c.position.y) * 2;
        tz = p.position.z + (c.target.z - c.position.z) * 4;
      }
    } else {
      out.lookYaw = 0;
      out.lookPitch = 0;
      return;
    }
    const dx = tx - p.position.x;
    const dz = tz - p.position.z;
    const dy = ty - (p.position.y + (p.seatId ? 1.15 : 1.5));
    out.lookYaw = clamp(wrapAngle(Math.atan2(dx, dz) - p.yaw), -1.3, 1.3);
    out.lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  private syncPlayers(view: WorldView): void {
    this.version = view.playersVersion;
    const ids = new Set(view.players.map((p) => p.id));
    for (const [id, e] of this.entries) {
      if (!ids.has(id)) {
        e.props?.dispose();
        this.splats?.drop(id);
        e.avatar?.dispose();
        this.entries.delete(id);
      }
    }
    for (const p of view.players) {
      if (this.entries.has(p.id)) continue;
      const spec = this.hooks.specFor(p.id);
      const entry: AvatarEntry = {
        id: p.id,
        specKey: encodeAvatar(spec),
        spec,
        avatar: null,
        animator: null,
        anchor: new THREE.Vector3(p.position.x, p.position.y + 1.85, p.position.z),
        action: null,
        actionSeq: p.actionSeq,
        glance: null,
        props: null,
        eyeContact: false,
        appear: 0,
      };
      this.entries.set(p.id, entry);
      this.requestBuild(entry);
    }
  }
}
