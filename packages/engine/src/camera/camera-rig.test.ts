import { describe, expect, it } from 'vitest';
import { v3 } from '@huddle/shared';
import { CameraRig, type CameraContext, type CameraInput } from './camera-rig.ts';
import { SEAT_LOOK_YAW } from './camera-views.ts';

function ctx(overrides: Partial<CameraContext> = {}): CameraContext {
  return {
    pivotFeet: v3.vec3(0, 0, 0),
    seatEye: null,
    seatYaw: Math.PI,
    screen: { center: [0, 3.45, -8.85], width: 8, height: 4.5, yaw: 0, bezel: 0.12 },
    overview: null,
    bounds: { min: [-8, 0, -6], max: [8, 3.1, 6] },
    pointerX: 0,
    pointerY: 0,
    aspect: 16 / 9,
    reducedMotion: true,
    raycastStatic: () => Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

function input(patch: Partial<CameraInput>): CameraInput {
  return {
    lookX: 0,
    lookY: 0,
    panX: 0,
    panY: 0,
    zoom: 0,
    moveX: 0,
    moveY: 0,
    moveUp: 0,
    fast: false,
    ...patch,
  };
}

function settle(rig: CameraRig, c: CameraContext, seconds = 1): void {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, c);
}

describe('CameraRig', () => {
  it('orbits behind the avatar at the configured distance', () => {
    const rig = new CameraRig();
    rig.yaw = Math.PI;
    rig.pitch = 0;
    rig.distance = 4;
    for (let i = 0; i < 10; i++) rig.update(1 / 60, ctx());
    // Looking towards -Z means the camera sits at +Z behind the pivot.
    expect(rig.pose.position.z).toBeCloseTo(4, 1);
  });

  it('pulls the arm in when a wall blocks it', () => {
    const rig = new CameraRig();
    rig.pitch = 0;
    rig.distance = 6;
    rig.update(1 / 60, ctx({ raycastStatic: () => 2 }));
    const d = v3.distance(rig.pose.position, v3.vec3(0, 1.42, 0));
    expect(d).toBeLessThan(2);
  });

  it('zooms all the way into first person at eye height', () => {
    const rig = new CameraRig();
    rig.applyInput(input({ zoom: -60 }), 1 / 60);
    expect(rig.distance).toBe(0);
    settle(rig, ctx());
    expect(rig.firstPerson).toBe(true);
    expect(rig.pose.position.y).toBeCloseTo(1.56, 2);
    expect(Math.hypot(rig.pose.position.x, rig.pose.position.z)).toBeLessThan(0.01);
    expect(rig.pose.fov).toBeGreaterThan(70);
    // First person may look much further up than the orbit.
    rig.applyInput(input({ lookY: -5 }), 1 / 60);
    expect(rig.pitch).toBeLessThan(-1.2);
  });

  it('pans the orbit pivot and reels it back in while the avatar walks', () => {
    const rig = new CameraRig();
    rig.yaw = Math.PI;
    rig.pitch = 0;
    const c = ctx();
    settle(rig, c);
    const before = rig.pose.target.x;
    // Dragging right moves the world right, so the view shifts left: screen-right is +X when
    // looking at -Z, so the pivot moves towards -X.
    rig.applyInput(input({ panX: 0.3 }), 1 / 60);
    settle(rig, c);
    expect(before - rig.pose.target.x).toBeGreaterThan(0.5);
    const feet = v3.vec3(0, 0, 0);
    const walking = ctx({ pivotFeet: feet });
    for (let i = 0; i < 180; i++) {
      feet.z -= 0.02;
      rig.update(1 / 60, walking);
    }
    expect(Math.abs(rig.orbit.offset.x)).toBeLessThan(0.05);
  });

  it('frames the big screen at ~50-60% of the horizontal view from a seat', () => {
    const rig = new CameraRig();
    const c = ctx({ seatEye: v3.vec3(0, 1.2, -1.5) });
    rig.setMode('seated', true);
    rig.update(1 / 60, c);
    const p = rig.pose.position;
    const dist = Math.abs(p.z - -8.85);
    const halfTan = Math.tan((rig.pose.fov * Math.PI) / 360) * c.aspect;
    const coverage = 4 / dist / halfTan;
    expect(coverage).toBeGreaterThan(0.5);
    expect(coverage).toBeLessThan(0.62);
    expect(rig.pose.fov).toBeGreaterThanOrEqual(55);
    expect(rig.pose.fov).toBeLessThanOrEqual(60);
  });

  it('keeps far seats in their chair and narrows the lens instead', () => {
    const rig = new CameraRig();
    const eye = v3.vec3(0, 1.2, 8);
    rig.setMode('seated', true);
    rig.update(1 / 60, ctx({ seatEye: eye }));
    expect(v3.distance(rig.pose.position, eye)).toBeLessThan(1.1);
    expect(rig.pose.fov).toBeGreaterThanOrEqual(44);
    expect(rig.pose.fov).toBeLessThan(55);
  });

  it('limits seated look-around to about ±110°', () => {
    const rig = new CameraRig();
    rig.setMode('seated', true);
    rig.applyLook(10, 0, 0);
    const c = ctx({ seatEye: v3.vec3(0, 1.2, -1.5) });
    rig.update(1 / 60, c);
    const dx = rig.pose.target.x - rig.pose.position.x;
    const dz = rig.pose.target.z - rig.pose.position.z;
    const angle = Math.abs(Math.atan2(dx, -dz));
    expect(angle).toBeLessThanOrEqual(SEAT_LOOK_YAW + 0.02);
    expect(angle).toBeGreaterThan(SEAT_LOOK_YAW - 0.2);
  });

  it('flies the free camera from the current view and keeps it inside the room', () => {
    const rig = new CameraRig();
    rig.yaw = 0;
    rig.pitch = 0;
    rig.distance = 3;
    const c = ctx();
    settle(rig, c);
    const start = { ...rig.pose.position };
    rig.setMode('free', true);
    expect(rig.capturesMovement).toBe(true);
    rig.update(1 / 60, c);
    expect(v3.distance(rig.pose.position, start)).toBeLessThan(1e-6);
    // Fly forward (+Z) for a long time: the camera stops at the south wall.
    for (let i = 0; i < 600; i++) {
      rig.applyInput(input({ moveY: 1, fast: true, moveUp: 1 }), 1 / 60);
      rig.update(1 / 60, c);
    }
    expect(rig.pose.position.z).toBeLessThanOrEqual(6);
    expect(rig.pose.position.z).toBeGreaterThan(5.5);
    expect(rig.pose.position.y).toBeLessThanOrEqual(3.1);
  });

  it('starts the overview from the authored shot and pans within the room', () => {
    const rig = new CameraRig();
    const c = ctx({ overview: { position: v3.vec3(0, 12, 10), target: v3.vec3(0, 0.5, 0) } });
    rig.setMode('overview', true);
    rig.update(1 / 60, c);
    expect(rig.pose.position.y).toBeCloseTo(12, 3);
    expect(rig.pose.position.z).toBeCloseTo(10, 3);
    for (let i = 0; i < 400; i++) {
      rig.applyInput(input({ moveX: 1 }), 1 / 60);
      rig.update(1 / 60, c);
    }
    expect(rig.pose.target.x).toBeGreaterThanOrEqual(-8);
    expect(rig.pose.target.x).toBeLessThanOrEqual(8);
    expect(Math.abs(rig.pose.target.x)).toBeGreaterThan(7.9);
    const d0 = v3.distance(rig.pose.position, rig.pose.target);
    rig.applyInput(input({ zoom: -2 }), 1 / 60);
    rig.update(1 / 60, c);
    expect(v3.distance(rig.pose.position, rig.pose.target)).toBeLessThan(d0);
  });

  it('cycles standing and seated views and recenters back to the avatar', () => {
    const rig = new CameraRig();
    expect([rig.cycle(false), rig.cycle(false), rig.cycle(false)]).toEqual([
      'overview',
      'free',
      'follow',
    ]);
    rig.setMode('seated', true);
    expect([rig.cycle(true), rig.cycle(true), rig.cycle(true), rig.cycle(true)]).toEqual([
      'seatedFree',
      'overview',
      'free',
      'seated',
    ]);
    rig.setMode('free', true);
    rig.recenter(0.5, false);
    expect(rig.mode).toBe('follow');
    expect(rig.yaw).toBe(0.5);
  });
});
