import {
  OPEN_SKY,
  sampleArc,
  type AimView,
  type ProjectileEvent,
  type ThrowKind,
  type ThrowRoom,
  type WorldView,
} from '@huddle/engine';
import { SIM_DT, v3, type Vec3 } from '@huddle/shared';
import * as THREE from 'three';
import type { DecalLayer } from './decals.ts';
import { ParticleLayer } from './particles.ts';
import { createThrowableModels, type ThrowableModels } from './throwable-models.ts';

const ARC_SAMPLES = 32;
const ARC_DOTS = 22;
const UP = { x: 0, y: 1, z: 0 };
/** Seconds a tomato splat stays on walls and floors before it fades. */
export const SPLAT_LIFE = 60;
/** Party trails: sparks per second per flying object, and how many objects trail at once. */
const TRAIL_RATE = 24;
const TRAIL_MAX = 10;
const TOMATO_INKS = [
  new THREE.Color('#C8231A'),
  new THREE.Color('#D93A22'),
  new THREE.Color('#B81C1C'),
];
const AIM_COLORS: Record<ThrowKind, string> = {
  paper: '#FFFFFF',
  plane: '#8FD3FF',
  tomato: '#FF5A3C',
  duck: '#FFD21F',
  confetti: '#FF2E93',
  heart: '#FF7FA3',
};

/**
 * Everything visible about throwing: projectile models (interpolated between fixed steps), the
 * dotted aiming arc with a landing reticle, particle bursts and tomato splat decals.
 */
export class ThrowFx {
  readonly group = new THREE.Group();
  readonly particles: ParticleLayer;
  reducedMotion = false;
  /** Party mode: flying things leave glowing trails and baskets pop confetti. */
  party = false;
  private room: ThrowRoom = OPEN_SKY;
  /** The aiming arc is re-planned only when the aim moves (planes simulate their glide). */
  private readonly arcKey = { kind: '', tilt: 0, from: v3.vec3(), to: v3.vec3() };
  private arcCount = 0;
  private trailClock = 0;
  private trailHue = 0;
  private readonly models: ThrowableModels;
  private readonly live = new Map<number, THREE.Object3D>();
  private version = -1;
  private readonly dots: THREE.InstancedMesh;
  private readonly dotMaterial: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Mesh;
  private readonly reticleMaterial: THREE.MeshBasicMaterial;
  private readonly arc: Vec3[] = Array.from({ length: ARC_SAMPLES }, () => v3.vec3());
  private readonly m4 = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();

  constructor() {
    this.group.name = 'throw-fx';
    this.models = createThrowableModels();
    this.particles = new ParticleLayer(this.models.heartGeometry);
    this.group.add(this.particles.group);
    // The preview is UI: drawn over everything (your own avatar would hide its first half).
    this.dotMaterial = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      toneMapped: false,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      this.dotMaterial,
      ARC_DOTS,
    );
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 20;
    this.dots.visible = false;
    this.reticleMaterial = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.15, 48), this.reticleMaterial);
    this.reticle.renderOrder = 21;
    this.reticle.visible = false;
    this.group.add(this.dots, this.reticle);
  }

  /** Camera position for the camera-facing target ring (set by the renderer each frame). */
  readonly eye = new THREE.Vector3();

  get projectileCount(): number {
    return this.live.size;
  }

  /** Hoops and ceiling of the current room (aim assist in the preview arc). */
  setRoom(room: ThrowRoom): void {
    this.room = room;
    this.arcKey.kind = '';
  }

  update(view: WorldView, dt: number, time: number): void {
    this.syncProjectiles(view);
    this.placeProjectiles(view);
    this.updateArc(view, time);
    if (this.party && !this.reducedMotion) this.emitTrails(view, dt);
    this.particles.update(dt);
  }

  /** Visual side of a projectile event: splat decals and juice, bursts, impact stars. */
  handle(ev: ProjectileEvent, time: number, decals: DecalLayer | null): void {
    const reduced = this.reducedMotion;
    switch (ev.type) {
      case 'splat': {
        this.particles.burst('juice', ev.point, ev.normal, reduced);
        if (ev.targetId === null && decals) {
          const p = ev.point;
          const n = ev.normal;
          const ink = TOMATO_INKS[Math.floor(Math.random() * TOMATO_INKS.length)] as THREE.Color;
          decals.add(
            [p.x, p.y, p.z],
            [n.x, n.y, n.z],
            0.24 + Math.random() * 0.18,
            Math.random() * Math.PI * 2,
            ink,
            Math.floor(Math.random() * 16),
            time,
            SPLAT_LIFE,
          );
          decals.enforceBudget(time);
        }
        break;
      }
      case 'burst':
        this.particles.burst(ev.kind === 'heart' ? 'hearts' : 'confetti', ev.point, UP, reduced);
        break;
      case 'hit':
        this.particles.burst('stars', ev.point, UP, reduced);
        if (ev.kind === 'paper' || ev.kind === 'plane')
          this.particles.burst('paper', ev.point, UP, reduced);
        break;
      case 'score':
        this.particles.burst('stars', ev.point, UP, reduced);
        if (this.party) this.particles.burst('confetti', ev.point, UP, reduced);
        break;
      case 'ghost':
        this.particles.burst('sparkle', ev.point, UP, reduced);
        break;
      case 'bounce':
        break;
    }
  }

  /** Removes flying objects and particles (room change, clean-up). */
  clear(): void {
    for (const o of this.live.values()) o.removeFromParent();
    this.live.clear();
    this.version = -1;
    this.particles.clear();
  }

  dispose(): void {
    this.clear();
    this.models.dispose();
    this.particles.dispose();
    this.dots.geometry.dispose();
    this.dotMaterial.dispose();
    this.reticle.geometry.dispose();
    this.reticleMaterial.dispose();
  }

  private syncProjectiles(view: WorldView): void {
    if (view.projectilesVersion === this.version) return;
    this.version = view.projectilesVersion;
    const alive = new Set<number>();
    for (const p of view.projectiles) {
      alive.add(p.id);
      if (this.live.has(p.id)) continue;
      const obj = this.models.create(p.kind);
      this.live.set(p.id, obj);
      this.group.add(obj);
    }
    for (const [id, obj] of this.live) {
      if (alive.has(id)) continue;
      obj.removeFromParent();
      this.live.delete(id);
    }
  }

  private placeProjectiles(view: WorldView): void {
    // Views hold the last fixed step; extrapolate along the velocity by the elapsed fraction.
    const lead = view.alpha * SIM_DT;
    for (const p of view.projectiles) {
      const obj = this.live.get(p.id);
      if (!obj) continue;
      obj.position.set(
        p.position.x + p.velocity.x * lead,
        p.position.y + p.velocity.y * lead,
        p.position.z + p.velocity.z * lead,
      );
      obj.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      // Pop out of the hand, shrink away when despawning.
      const pop = Math.min(1, 0.35 + p.age * 8);
      obj.scale.setScalar(pop * Math.max(0, p.opacity));
    }
  }

  private updateArc(view: WorldView, time: number): void {
    const aim = view.aim;
    this.dots.visible = aim !== null;
    this.reticle.visible = aim !== null;
    if (!aim) return;
    const n = this.arcPoints(aim);
    const color = aim.targetId ? '#FF3B3B' : AIM_COLORS[aim.kind];
    this.dotMaterial.color.set(color);
    this.reticleMaterial.color.set(color);
    // Dots march from the hand to the landing point.
    const phase = (time * 1.8) % 1;
    for (let i = 0; i < ARC_DOTS; i++) {
      const s = Math.min(0.999, (i + phase) / ARC_DOTS);
      const f = s * (n - 1);
      const k = Math.floor(f);
      const a = this.arc[k] as Vec3;
      const b = this.arc[Math.min(n - 1, k + 1)] as Vec3;
      const t = f - k;
      this.pos.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      // Constant on-screen size: dots far away are not specks, near ones not marbles.
      const r =
        (0.0042 + 0.0025 * Math.sin(s * Math.PI)) * Math.max(0.6, this.pos.distanceTo(this.eye));
      this.scl.set(r, r, r);
      this.m4.compose(this.pos, this.quat, this.scl);
      this.dots.setMatrixAt(i, this.m4);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    const pulse = 1 + Math.sin(time * 8) * (aim.targetId ? 0.18 : 0.08);
    const ring = this.reticle;
    if (aim.flat) {
      // Where it really comes down: a plane's glide (or a hoop lob) can end off the pointer.
      const end = this.arc[n - 1] ?? aim.to;
      ring.position.set(end.x, end.y + 0.015, end.z);
      ring.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      // People and walls: a ring facing the camera, around the point that will be hit.
      ring.position.set(aim.to.x, aim.to.y, aim.to.z);
      ring.lookAt(this.eye);
    }
    ring.scale.setScalar(
      pulse * (aim.targetId ? 1.6 : 1) * Math.max(0.7, ring.position.distanceTo(this.eye) / 4),
    );
  }

  /** Arc points for the aim, re-planned only when kind, tilt, hand or target moved. */
  private arcPoints(aim: AimView): number {
    const k = this.arcKey;
    const moved =
      k.kind !== aim.kind ||
      k.tilt !== aim.tilt ||
      v3.distance(k.from, aim.from) > 0.002 ||
      v3.distance(k.to, aim.to) > 0.002;
    if (moved) {
      k.kind = aim.kind;
      k.tilt = aim.tilt;
      v3.copy(k.from, aim.from);
      v3.copy(k.to, aim.to);
      this.arcCount = sampleArc(
        aim.kind,
        aim.from,
        aim.to,
        ARC_SAMPLES,
        this.arc,
        aim.tilt,
        this.room,
      );
    }
    return this.arcCount;
  }

  /** Party mode: a few glowing sparks behind everything in flight. */
  private emitTrails(view: WorldView, dt: number): void {
    this.trailClock += dt;
    if (this.trailClock < 1 / TRAIL_RATE) return;
    this.trailClock = 0;
    let n = 0;
    for (const p of view.projectiles) {
      if (p.landed || n >= TRAIL_MAX) continue;
      const obj = this.live.get(p.id);
      if (!obj) continue;
      this.particles.spark(obj.position, this.trailHue++);
      n++;
    }
  }
}
