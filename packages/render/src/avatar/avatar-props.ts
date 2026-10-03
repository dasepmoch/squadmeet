import type { PlayerView } from '@huddle/engine';
import { PIZZA_BITES } from '@huddle/shared';
import * as THREE from 'three';
import type { HeldModels, PropModelKind } from './held-models.ts';
import { BITE_AT, holdingSide, useProgress } from './item-actions.ts';
import type { ProceduralAvatar } from './procedural-avatar.ts';

type Euler3 = readonly [number, number, number];

/**
 * Avatar-space orientation (Euler YXZ) of each prop while carried and at the height of using it.
 * Props keep their own attitude (a mug stays upright while the arm swings) instead of inheriting
 * the hand's.
 */
const ORIENT: Record<PropModelKind, { carry: Euler3; use: Euler3 }> = {
  mug: { carry: [0, 0, 0], use: [-0.9, 0, 0] },
  water: { carry: [0, 0, 0], use: [-0.95, 0, 0] },
  pizza: { carry: [-1.0, 0.3, 0], use: [-1.9, 0.3, 0] },
  phone: { carry: [-0.5, 0, 0], use: [0.1, Math.PI, 0] },
  plane: { carry: [-0.12, 0, 0], use: [-0.12, 0, 0] },
  // Carried signs lean out over the shoulder (never in front of the face); used, held up high.
  signPlus: { carry: [0.25, 0, -0.5], use: [0, 0, 0] },
  signAsk: { carry: [0.25, 0, -0.5], use: [0, 0, 0] },
  signBrb: { carry: [0.25, 0, -0.5], use: [0, 0, 0] },
  signLove: { carry: [0.25, 0, -0.5], use: [0, 0, 0] },
  mop: { carry: [-0.55, 0, 0], use: [-0.55, 0, 0] },
};

const BUBBLE_IN = 0.07;
const BUBBLE_OUT = 0.65;

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qr = new THREE.Quaternion();
const qp = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const tmp = new THREE.Vector3();

let bubbleGeometry: THREE.SphereGeometry | null = null;
let bubbleBase: THREE.ShaderMaterial | null = null;

/** A fresnel-lit cyan shell (drawn additively) for the "Don't hit me" shimmer. */
function bubbleMaterial(alpha: { value: number }): THREE.ShaderMaterial {
  bubbleBase ??= new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0.32, 0.92, 1) } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        gl_FragColor = vec4(uColor * (0.04 + rim * 1.6) * uAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = bubbleBase.clone();
  // Uniform objects are captured when the program is set up: keep this one and mutate `value`.
  m.uniforms = { uAlpha: alpha, uColor: { value: new THREE.Color(0.32, 0.92, 1) } };
  return m;
}

/**
 * What one avatar shows in its hands (held items, the mop of a clean-up, pizza getting shorter
 * bite by bite) and the shimmer when something passes through a protected person.
 */
export class AvatarProps {
  private readonly avatar: ProceduralAvatar;
  private readonly models: HeldModels;
  private held: THREE.Object3D | null = null;
  private heldKind: PropModelKind | null = null;
  private mop: THREE.Object3D | null = null;
  private bites = 0;
  private biteAt = Number.POSITIVE_INFINITY;
  private bubble: THREE.Mesh | null = null;
  private readonly bubbleAlpha = { value: 0 };
  private ghostAt = Number.NEGATIVE_INFINITY;

  constructor(avatar: ProceduralAvatar, models: HeldModels) {
    this.avatar = avatar;
    this.models = models;
  }

  /** An action just started (counts pizza bites). */
  started(actionId: string, time: number): void {
    if (actionId === 'eat' && this.heldKind === 'pizza') this.biteAt = time + BITE_AT;
  }

  /** Something passed through this protected person. */
  ghost(time: number): void {
    this.ghostAt = time;
  }

  /** Once per frame, after the animator posed the skeleton. */
  update(p: PlayerView, action: { id: string; t: number } | null, time: number): void {
    const item = p.held;
    if (item !== this.heldKind) this.swap(item);
    const mopping = action?.id === 'mop';
    if (mopping && !this.mop) {
      this.mop = this.models.create('mop');
      this.avatar.socket('right').add(this.mop);
    }
    if (this.mop) this.mop.visible = mopping;
    if (this.mop && mopping) this.orient(this.mop, 'mop', 0);
    if (this.held && this.heldKind) {
      this.held.visible = !mopping;
      const progress = action ? useProgress(action.id, action.t) : 0;
      this.orient(this.held, this.heldKind, progress);
      if (time >= this.biteAt) {
        this.biteAt = Number.POSITIVE_INFINITY;
        this.bites = Math.min(PIZZA_BITES - 1, this.bites + 1);
        const bite = this.held.getObjectByName('bite');
        if (bite) bite.scale.z = 1 - this.bites * 0.3;
      }
    }
    this.updateBubble(p.sitBlend, time);
  }

  dispose(): void {
    this.held?.removeFromParent();
    this.mop?.removeFromParent();
    if (this.bubble) {
      this.bubble.removeFromParent();
      (this.bubble.material as THREE.Material).dispose();
    }
    this.held = this.mop = this.bubble = null;
  }

  private swap(item: PropModelKind | null): void {
    this.held?.removeFromParent();
    this.held = null;
    this.heldKind = item;
    this.bites = 0;
    this.biteAt = Number.POSITIVE_INFINITY;
    if (!item) return;
    this.held = this.models.create(item);
    this.avatar.socket(holdingSide(item) === 'L' ? 'left' : 'right').add(this.held);
  }

  /** Sets a prop's attitude in avatar space, whatever the hand is doing. */
  private orient(obj: THREE.Object3D, kind: PropModelKind, progress: number): void {
    const o = ORIENT[kind];
    qa.setFromEuler(euler.set(o.carry[0], o.carry[1], o.carry[2], 'YXZ'));
    if (progress > 0) {
      qb.setFromEuler(euler.set(o.use[0], o.use[1], o.use[2], 'YXZ'));
      qa.slerp(qb, progress);
    }
    const parent = obj.parent;
    if (!parent) return;
    this.avatar.root.getWorldQuaternion(qr);
    parent.getWorldQuaternion(qp);
    obj.quaternion.copy(qp.invert().multiply(qr.multiply(qa)));
  }

  private updateBubble(sitBlend: number, time: number): void {
    const age = time - this.ghostAt;
    const alpha =
      age < 0
        ? 0
        : age < BUBBLE_IN
          ? age / BUBBLE_IN
          : Math.max(0, 1 - (age - BUBBLE_IN) / BUBBLE_OUT);
    if (alpha <= 0) {
      if (this.bubble) this.bubble.visible = false;
      return;
    }
    if (!this.bubble) {
      bubbleGeometry ??= new THREE.SphereGeometry(1, 28, 18);
      this.bubble = new THREE.Mesh(bubbleGeometry, bubbleMaterial(this.bubbleAlpha));
      this.bubble.renderOrder = 6;
      this.bubble.castShadow = false;
      this.avatar.root.add(this.bubble);
    }
    const b = this.bubble;
    b.visible = true;
    this.bubbleAlpha.value = alpha;
    // Around the body, wherever it is (standing, seated, leaning).
    this.avatar.bone('spine').getWorldPosition(tmp);
    this.avatar.root.worldToLocal(tmp);
    const wobble = 1 + Math.sin(age * 38) * 0.05 * alpha;
    const height = 0.95 - 0.22 * sitBlend;
    b.position.set(tmp.x, tmp.y - 0.06, tmp.z + 0.04 * sitBlend);
    b.scale.set(0.5 * wobble, height * (2 - wobble), (0.5 + 0.1 * sitBlend) * wobble);
  }
}
