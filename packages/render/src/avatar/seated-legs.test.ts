import { DEFAULT_AVATAR } from '@huddle/shared';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX, type BoneName } from './rig.ts';
import { buildAvatarMeshData } from './sculpt/character.ts';
import { HIP_ABOVE_SEAT, seatedLegs, type LegMetrics, type SeatedLegs } from './seated-legs.ts';

/** Leg proportions of a real sculpted avatar (joints are bind-pose world positions). */
function metricsFor(height: number): LegMetrics {
  const { joints } = buildAvatarMeshData({ ...DEFAULT_AVATAR, height }, [2.4]);
  const j = (b: BoneName): [number, number, number] => {
    const i = BONE_INDEX[b] * 3;
    return [joints[i] ?? 0, joints[i + 1] ?? 0, joints[i + 2] ?? 0];
  };
  const [hips, hip, knee, ankle] = [j('hips'), j('thighL'), j('shinL'), j('footL')];
  const len = (a: number[], b: number[]): number =>
    Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
  return {
    hipJointY: hip[1] - hips[1],
    thigh: len(knee, hip),
    shin: len(ankle, knee),
    ankle: ankle[1],
  };
}

/** Independent side-view forward kinematics: ankle height above the floor and sole pitch. */
function ankleOf(m: LegMetrics, seat: number, thighPitch: number, legs: SeatedLegs) {
  const pitch = thighPitch - legs.thigh;
  const hipY = seat + HIP_ABOVE_SEAT + m.hipJointY;
  const kneeY = hipY - m.thigh * Math.cos(pitch);
  const shinWorld = pitch - legs.shin;
  return { y: kneeY - m.shin * Math.cos(shinWorld), sole: -pitch + legs.shin + legs.foot };
}

describe('seated legs', () => {
  const avatars = [0, 4, 8].map((h) => ({ h, m: metricsFor(h) }));

  it('plants the feet on the floor for chairs, sofas and lounge chairs', () => {
    for (const { h, m } of avatars) {
      for (const [seat, pitch] of [
        [0.36, 1.32],
        [0.44, 1.32],
        [0.49, 1.52],
        [0.55, 1.52],
      ] as const) {
        const legs = seatedLegs(m, seat, pitch, { thigh: 0, shin: 0, foot: 0 });
        const a = ankleOf(m, seat, pitch, legs);
        expect(Math.abs(a.y - m.ankle), `height ${h}, seat ${seat}`).toBeLessThan(0.005);
        expect(Math.abs(a.sole)).toBeLessThan(1e-6);
        expect(legs.thigh).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('drops the knees on tall seats and lets the feet dangle, never below the floor', () => {
    for (const { m } of avatars) {
      for (const seat of [0.6, 0.7, 0.85, 1.0]) {
        const legs = seatedLegs(m, seat, 1.52, { thigh: 0, shin: 0, foot: 0 });
        const a = ankleOf(m, seat, 1.52, legs);
        expect(a.y).toBeGreaterThanOrEqual(m.ankle - 0.005);
        expect(legs.thigh).toBeGreaterThan(0);
      }
    }
  });
});

describe('seated animation', () => {
  it('rests the hips on the seat surface (the root already stands on it)', async () => {
    const THREE = await import('three');
    const { AvatarAnimator } = await import('./animator.ts');
    const { BONES } = await import('./rig.ts');
    const { joints } = buildAvatarMeshData(DEFAULT_AVATAR, [2.4]);
    const abs = (i: number) =>
      new THREE.Vector3(joints[i * 3] ?? 0, joints[i * 3 + 1] ?? 0, joints[i * 3 + 2] ?? 0);
    const bones = BONES.map(() => new THREE.Bone());
    const rest = BONES.map((b, i) => (b.parent >= 0 ? abs(i).sub(abs(b.parent)) : abs(i)));
    const root = new THREE.Object3D();
    const rig = {
      root,
      bone: (n: BoneName) => bones[BONE_INDEX[n]] as InstanceType<typeof THREE.Bone>,
      restPosition: (n: BoneName) => rest[BONE_INDEX[n]] as InstanceType<typeof THREE.Vector3>,
      socket: () => root,
      setVisible: () => undefined,
      setLod: () => undefined,
      dispose: () => undefined,
    };
    const anim = new AvatarAnimator(rig);
    anim.update({
      dt: 1 / 60,
      time: 1,
      speed: 0,
      verticalVelocity: 0,
      grounded: true,
      sitBlend: 1,
      posture: 'upright',
      seatHeight: 0.49,
      stride: 0,
      talk: 0,
      lookYaw: 0,
      lookPitch: 0,
      action: null,
      mood: 0,
    });
    expect(rig.bone('hips').position.y).toBeCloseTo(HIP_ABOVE_SEAT, 2);
  });
});
