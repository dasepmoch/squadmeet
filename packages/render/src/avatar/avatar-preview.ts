import type { AvatarSpec } from '@huddle/shared';
import { encodeAvatar } from '@huddle/shared';
import * as THREE from 'three';
import { isMesh, materialsOf } from '../core/dispose.ts';
import { AvatarAnimator, type AnimInput } from './animator.ts';
import { AvatarMaterials } from './avatar-materials.ts';
import { ProceduralAvatar } from './procedural-avatar.ts';
import type { AvatarMeshData } from './sculpt/character.ts';

export type AvatarMeshBuilder = (spec: AvatarSpec) => Promise<AvatarMeshData>;

/**
 * Turntable preview for the avatar editor. Owns a small separate WebGL context with soft studio
 * lighting, so it can be disposed as soon as the editor closes. Camera can frame the full body or
 * zoom to the face.
 */
export class AvatarPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 30);
  private readonly materials = new AvatarMaterials(null);
  private readonly turntable = new THREE.Group();
  private readonly build: AvatarMeshBuilder;
  private avatar: ProceduralAvatar | null = null;
  private animator: AvatarAnimator | null = null;
  private pendingKey = '';
  private time = 0;
  private spin = 0.35;
  private dragVelocity = 0;
  private actionAt = -10;
  private actionId = 'wave';
  private framing = 0;
  private framingTarget = 0;
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
    lookPitch: 0.08,
    action: null,
    mood: 0.7,
  };

  constructor(canvas: HTMLCanvasElement, build: AvatarMeshBuilder) {
    this.build = build;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const hemi = new THREE.HemisphereLight('#f4f1ea', '#5a4e44', 1.1);
    const key = new THREE.DirectionalLight('#fff3e2', 2.6);
    key.position.set(2.2, 3.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.2;
    key.shadow.camera.right = 1.2;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -0.4;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    const rim = new THREE.DirectionalLight('#bcd4ff', 2.2);
    rim.position.set(-2.5, 2.4, -3);
    const fill = new THREE.DirectionalLight('#ffe4d0', 0.7);
    fill.position.set(-3, 1.2, 2);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 64),
      new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.6 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.006, 6, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#7FA8FF') }),
    );
    ring.rotation.x = Math.PI / 2;
    this.turntable.add(floor, ring);
    this.scene.add(hemi, key, rim, fill, this.turntable);
  }

  /** Rebuilds the avatar for a spec; keeps showing the previous one until the new mesh is ready. */
  setSpec(spec: AvatarSpec): void {
    const key = encodeAvatar(spec);
    this.pendingKey = key;
    void this.build(spec).then((data) => {
      if (this.pendingKey !== key) return;
      this.avatar?.dispose();
      const avatar = new ProceduralAvatar(data, spec, this.materials);
      this.turntable.add(avatar.root);
      this.avatar = avatar;
      this.animator = new AvatarAnimator(avatar, data.anchors.lidOpen);
    });
  }

  /** Plays an emote once (e.g. after a customization change). */
  play(actionId = 'wave'): void {
    this.actionId = actionId;
    this.actionAt = this.time;
  }

  /** 0 = full body, 1 = face close-up. */
  setFraming(target: number): void {
    this.framingTarget = Math.max(0, Math.min(1, target));
  }

  /** Drag-to-spin from the UI (pixels). */
  drag(deltaX: number): void {
    this.dragVelocity = deltaX * 0.012;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(2, pixelRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.time += dt;
    this.dragVelocity *= Math.exp(-dt * 3);
    this.spin += dt * 0.25 + this.dragVelocity;
    this.turntable.rotation.y = this.spin;
    this.framing += (this.framingTarget - this.framing) * Math.min(1, dt * 5);
    const f = this.framing;
    this.camera.position.set(0, 1.0 + f * 0.48, 5.2 - f * 3.6);
    this.camera.lookAt(0, 0.88 + f * 0.6, 0);
    if (this.animator) {
      const i = this.input;
      i.dt = dt;
      i.time = this.time;
      const t = this.time - this.actionAt;
      i.action = t < 3 ? { id: this.actionId, t } : null;
      this.animator.update(i);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.avatar?.dispose();
    this.materials.dispose();
    this.scene.traverse((o) => {
      if (!isMesh(o)) return;
      o.geometry.dispose();
      for (const m of materialsOf(o)) m.dispose();
    });
    this.renderer.dispose();
  }
}
