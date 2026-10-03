import { clamp, damp, smoothstep, type Posture } from '@huddle/shared';
import { applyAction, type FaceOut, type PoseMap } from './emotes.ts';
import { LID_EDGE } from './face-parts.ts';
import { applyHold, holdingSide } from './item-actions.ts';
import type { AvatarRig, BoneName } from './rig.ts';
import {
  HIP_ABOVE_SEAT,
  legMetrics,
  seatedLegs,
  type LegMetrics,
  type SeatedLegs,
} from './seated-legs.ts';

export { ACTION_LENGTH } from './emotes.ts';

export interface AnimInput {
  dt: number;
  time: number;
  speed: number;
  verticalVelocity: number;
  grounded: boolean;
  sitBlend: number;
  posture: Posture | null;
  /**
   * Seat surface height above its floor (plants the feet). While seated the avatar root is on
   * the seat surface, not on the floor.
   */
  seatHeight: number;
  stride: number;
  /** Voice amplitude 0..1 (mouth, brows, small gestures). */
  talk: number;
  /** Desired look direction relative to the body, radians (eyes lead, head follows). */
  lookYaw: number;
  lookPitch: number;
  /** Upper-body action (emotes, throws, reactions) with its local time in seconds. */
  action: { id: string; t: number } | null;
  /** Resting mood: 0 neutral .. 1 cheerful. */
  mood: number;
  /** What is in hand (a `HeldItem`): that arm holds it up in front. */
  held?: string | null;
}

const BONE_LIST: BoneName[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'jaw',
  'eyeL',
  'eyeR',
  'lidL',
  'lidR',
  'browL',
  'browR',
  'shoulderL',
  'upperArmL',
  'lowerArmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'lowerArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
];

function emptyPose(): PoseMap {
  const p = {} as PoseMap;
  for (const b of BONE_LIST) p[b] = { rx: 0, ry: 0, rz: 0 };
  p.root = { rx: 0, ry: 0, rz: 0 };
  return p;
}

/** Seated targets per posture (radians, relative to the A-pose bind). */
const SIT_POSES: Record<Posture, Partial<Record<BoneName, [number, number, number]>>> = {
  upright: {
    spine: [0.02, 0, 0],
    thighL: [-1.52, 0.04, 0.05],
    thighR: [-1.52, -0.04, -0.05],
    upperArmL: [-0.38, 0.1, -0.12],
    upperArmR: [-0.38, -0.1, 0.12],
    lowerArmL: [-1.05, 0, -0.15],
    lowerArmR: [-1.05, 0, 0.15],
  },
  lean: {
    spine: [-0.24, 0, 0],
    chest: [-0.08, 0, 0],
    thighL: [-1.32, 0.1, 0.1],
    thighR: [-1.32, -0.1, -0.1],
    upperArmL: [-0.15, 0, 0.12],
    upperArmR: [-0.15, 0, -0.12],
    lowerArmL: [-0.6, 0, 0],
    lowerArmR: [-0.6, 0, 0],
  },
  crossLegged: {
    spine: [0.08, 0, 0],
    thighL: [-1.25, 0.5, 0.9],
    thighR: [-1.25, -0.5, -0.9],
    shinL: [2.2, -0.4, 0],
    shinR: [2.2, 0.4, 0],
    upperArmL: [-0.5, 0, -0.1],
    upperArmR: [-0.5, 0, 0.1],
    lowerArmL: [-0.7, 0, 0],
    lowerArmR: [-0.7, 0, 0],
  },
  perch: {
    spine: [0.05, 0, 0],
    thighL: [-1.28, 0.06, 0.08],
    thighR: [-1.28, -0.06, -0.08],
    shinL: [1.3, 0, 0],
    shinR: [1.3, 0, 0],
    upperArmL: [-0.42, 0, -0.08],
    upperArmR: [-0.42, 0, 0.08],
    lowerArmL: [-1.0, 0, 0],
    lowerArmR: [-1.0, 0, 0],
  },
};

/**
 * Layered procedural animation: locomotion phase-locked to distance travelled (no foot sliding),
 * posture (stand/sit with seat-height adaptation), upper-body actions, and a face layer with eye
 * saccades, blinks, voice-driven mouth and brows. Idle adds breathing and weight shifts.
 */
export class AvatarAnimator {
  private readonly rig: AvatarRig;
  private readonly pose = emptyPose();
  private readonly face: FaceOut = { mouthOpen: 0, smile: 0, brow: 0, squint: 0 };
  private walkW = 0;
  private runW = 0;
  private airW = 0;
  private holdW = 0;
  private holdSide: 'L' | 'R' = 'L';
  private blinkTimer = 1.5 + Math.random() * 3;
  private blink = 0;
  private mouth = 0;
  private brow = 0;
  private headYaw = 0;
  private headPitch = 0;
  private eyeYaw = 0;
  private eyePitch = 0;
  private saccade = { yaw: 0, pitch: 0, timer: 0.8 };
  private readonly seed = Math.random() * 100;
  private readonly lidOpen: number;
  private readonly legs: LegMetrics;
  private readonly seatedLegs: SeatedLegs = { thigh: 0, shin: 0, foot: 0 };

  constructor(rig: AvatarRig, lidOpen = 0.9) {
    this.rig = rig;
    this.lidOpen = lidOpen;
    this.legs = legMetrics(rig);
  }

  update(i: AnimInput): void {
    const p = this.pose;
    for (const b of BONE_LIST) {
      const q = p[b];
      q.rx = 0;
      q.ry = 0;
      q.rz = 0;
    }
    const f = this.face;
    f.mouthOpen = 0;
    f.smile = i.mood * 0.5;
    f.brow = 0;
    f.squint = 0;
    const dt = Math.min(0.1, i.dt);
    const standing = 1 - i.sitBlend;
    this.walkW = damp(this.walkW, smoothstep(0.1, 1.2, i.speed) * standing, 10, dt);
    this.runW = damp(this.runW, smoothstep(3.4, 5.0, i.speed) * standing, 8, dt);
    this.airW = damp(this.airW, i.grounded ? 0 : standing, 12, dt);
    const t = i.time + this.seed;

    // Idle: breathing, weight shift, relaxed arms hanging close to the body.
    const breathe = Math.sin(t * 1.6) * 0.022;
    p.chest.rx -= breathe;
    p.spine.rz += Math.sin(t * 0.42) * 0.018 * standing;
    p.shoulderL.rz += breathe * 0.4;
    p.shoulderR.rz -= breathe * 0.4;
    p.upperArmL.rz -= 0.09 - breathe * 0.3;
    p.upperArmR.rz += 0.09 - breathe * 0.3;
    p.upperArmL.ry -= 0.12;
    p.upperArmR.ry += 0.12;
    p.lowerArmL.rx -= 0.2;
    p.lowerArmR.rx -= 0.2;
    p.handL.rz -= 0.08;
    p.handR.rz += 0.08;
    let hipsY = 0;
    let hipsZ = 0;
    let hipsX = Math.sin(t * 0.42) * 0.01 * standing;

    if (this.walkW > 0.001) {
      const strideLen = 1.2 + this.runW * 0.9;
      const ph = (i.stride / strideLen) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const w = this.walkW;
      const amp = 0.46 + this.runW * 0.34;
      p.thighL.rx += -s * amp * w;
      p.thighR.rx += s * amp * w;
      p.shinL.rx += Math.max(0, Math.sin(ph + 1.35)) * (0.85 + this.runW * 0.6) * w;
      p.shinR.rx += Math.max(0, Math.sin(ph + 1.35 + Math.PI)) * (0.85 + this.runW * 0.6) * w;
      p.footL.rx += Math.sin(ph + 0.5) * 0.24 * w;
      p.footR.rx += -Math.sin(ph + 0.5) * 0.24 * w;
      p.upperArmL.rx += s * (0.42 + this.runW * 0.4) * w;
      p.upperArmR.rx += -s * (0.42 + this.runW * 0.4) * w;
      p.lowerArmL.rx -= (0.22 + Math.max(0, s) * 0.2 + this.runW * 0.9) * w;
      p.lowerArmR.rx -= (0.22 + Math.max(0, -s) * 0.2 + this.runW * 0.9) * w;
      p.hips.ry -= s * 0.07 * w;
      p.chest.ry += s * 0.1 * w;
      p.spine.rx += this.runW * 0.16 + 0.03 * w;
      p.head.ry -= s * 0.04 * w;
      hipsY += Math.abs(c) * 0.03 * w - 0.018 * w;
      hipsX += s * 0.011 * w;
    }

    if (this.airW > 0.001) {
      const a = this.airW;
      const rising = clamp(i.verticalVelocity / 4, -1, 1);
      p.thighL.rx += -0.7 * a;
      p.thighR.rx += -0.45 * a;
      p.shinL.rx += 1.1 * a;
      p.shinR.rx += 0.7 * a;
      p.upperArmL.rz += (0.55 + rising * 0.3) * a;
      p.upperArmR.rz -= (0.55 + rising * 0.3) * a;
      f.mouthOpen += 0.3 * a;
    }

    if (i.sitBlend > 0.001 && i.posture) {
      const k = i.sitBlend;
      for (const [bone, rot] of Object.entries(SIT_POSES[i.posture]) as [
        BoneName,
        [number, number, number],
      ][]) {
        const q = p[bone];
        q.rx += rot[0] * k;
        q.ry += rot[1] * k;
        q.rz += rot[2] * k;
      }
      if (i.posture === 'upright' || i.posture === 'lean') {
        const thighPitch = -(SIT_POSES[i.posture].thighL?.[0] ?? -1.5);
        const legs = seatedLegs(this.legs, i.seatHeight, thighPitch, this.seatedLegs);
        p.thighL.rx += legs.thigh * k;
        p.thighR.rx += legs.thigh * k;
        p.shinL.rx += legs.shin * k;
        p.shinR.rx += legs.shin * k;
        p.footL.rx += legs.foot * k;
        p.footR.rx += legs.foot * k;
      }
      // The root already stands on the seat surface: the hips only rest on the cushion.
      const hips = this.rig.restPosition('hips');
      hipsY += (HIP_ABOVE_SEAT - hips.y) * k;
      hipsZ += (i.posture === 'lean' ? -0.05 : -0.015) * k;
      // Seated people fidget a little: small torso sway and hand shifts.
      p.chest.ry += Math.sin(t * 0.3) * 0.04 * k;
    }

    // Something in hand: that arm holds it up in front (eases in and out).
    if (i.held) this.holdSide = holdingSide(i.held);
    this.holdW = damp(this.holdW, i.held ? 1 : 0, 9, dt);
    applyHold(p, this.holdSide, this.holdW, i.sitBlend, t);

    if (i.action) hipsY += applyAction(i.action.id, i.action.t, p, f, i.sitBlend > 0.5);

    // Talking: subtle brow lifts and head bobs.
    const talk = clamp(i.talk, 0, 1);
    p.head.rx += Math.sin(t * 7.3) * 0.02 * talk;
    f.brow += talk * 0.25 * (0.5 + 0.5 * Math.sin(t * 3.1));

    // Gaze: eyes lead with quick saccades, the head follows smoothly.
    this.saccade.timer -= dt;
    if (this.saccade.timer <= 0) {
      this.saccade.timer = 0.6 + Math.random() * 2.2;
      this.saccade.yaw = (Math.random() - 0.5) * 0.18;
      this.saccade.pitch = (Math.random() - 0.5) * 0.08;
    }
    const lookYaw = clamp(i.lookYaw, -1.1, 1.1);
    const lookPitch = clamp(i.lookPitch, -0.5, 0.45);
    this.headYaw = damp(this.headYaw, lookYaw * 0.72, 5, dt);
    this.headPitch = damp(this.headPitch, lookPitch * 0.7, 5, dt);
    this.eyeYaw = damp(
      this.eyeYaw,
      clamp(lookYaw - this.headYaw + this.saccade.yaw, -0.38, 0.38),
      25,
      dt,
    );
    this.eyePitch = damp(
      this.eyePitch,
      clamp(lookPitch - this.headPitch + this.saccade.pitch, -0.25, 0.25),
      25,
      dt,
    );
    p.head.ry += this.headYaw * 0.7;
    p.neck.ry += this.headYaw * 0.3;
    p.head.rx += -this.headPitch * 0.7;
    p.neck.rx += -this.headPitch * 0.3 + Math.sin(t * 1.6) * 0.008;
    for (const e of ['eyeL', 'eyeR'] as const) {
      p[e].ry += this.eyeYaw;
      p[e].rx += -this.eyePitch;
    }

    // Blink (also triggered by big saccades), voice mouth, expression.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 7.5);
    const closed = Math.sin(Math.min(1, this.blink) * Math.PI);
    this.mouth = damp(this.mouth, clamp(talk * 1.1 + f.mouthOpen, 0, 1.2), 24, dt);
    this.brow = damp(this.brow, clamp(f.brow, -1, 1.2), 10, dt);
    this.apply(p, hipsX, hipsY, hipsZ, closed, clamp(f.smile, -0.5, 1), clamp(f.squint, 0, 1));
  }

  private apply(
    p: PoseMap,
    hipsX: number,
    hipsY: number,
    hipsZ: number,
    blink: number,
    smile: number,
    squint: number,
  ): void {
    const r = this.rig;
    for (const b of BONE_LIST) {
      const q = p[b];
      r.bone(b).rotation.set(q.rx, q.ry, q.rz);
    }
    const hips = r.bone('hips');
    const rest = r.restPosition('hips');
    hips.position.set(rest.x + hipsX, rest.y + hipsY, rest.z + hipsZ);
    // Lids: open edge height follows the eye style, squints and smiles close them a little.
    const open = clamp(this.lidOpen - squint * 0.35 - smile * 0.08 + this.brow * 0.06, 0.15, 1);
    // At rest the upper lid sits just on the iris' top edge (bright, friendly eyes).
    const edgeOpen = -0.02 + open * 0.68;
    const angleOpen = Math.acos(clamp(edgeOpen, -1, 1)) - LID_EDGE;
    const angleClosed = Math.acos(-0.38) - LID_EDGE;
    const lid = angleOpen + (angleClosed - angleOpen) * blink;
    // Lids follow the gaze a little (looking down lowers them).
    r.bone('lidL').rotation.set(lid + r.bone('eyeL').rotation.x * 0.35, 0, 0);
    r.bone('lidR').rotation.set(lid + r.bone('eyeR').rotation.x * 0.35, 0, 0);
    const jaw = r.bone('jaw');
    jaw.scale.set(
      1 + smile * 0.08 + this.mouth * 0.05,
      0.14 + this.mouth * 0.95 + Math.max(0, smile) * 0.08,
      1,
    );
    if (r.mouthCrease) r.mouthCrease.visible = this.mouth < 0.12;
    for (const [b, sx] of [
      ['browL', 1],
      ['browR', -1],
    ] as const) {
      const rest2 = r.restPosition(b);
      r.bone(b).position.set(rest2.x, rest2.y + this.brow * 0.0045, rest2.z);
      r.bone(b).rotation.set(0, 0, sx * this.brow * 0.08);
    }
  }
}
