import type { Simulation } from '@huddle/engine';
import { clamp, lerp, v3, type Vec3 } from '@huddle/shared';
import type { LobbyStepUi } from '@huddle/ui';

/** The landing's fly-around: an ellipse above the furniture, always looking at the table. */
const ORBIT = { cx: 0, cz: -0.3, rx: 6.2, rz: 4.2, height: 2.5, start: 0.6, fov: 50 };
const ORBIT_TARGET: Vec3 = { x: 0, y: 0.8, z: -0.3 };
/** Radians per second: one lap in a minute and a half. */
const ORBIT_SPEED = (Math.PI * 2) / 90;

/**
 * Where you stand before joining: in the open floor by the lounge, facing the table (so joining
 * looks at the room). The green room's camera sits in front of you; the join swoop swings it
 * round behind you over the open floor, never through a wall.
 */
const STAGE = { x: 4.5, z: 1.2, yaw: Math.PI };
/**
 * Green-room portrait: `frame` meters of you (knees to above the name tag) fill the free part of
 * the screen, centered on `aim` meters up; the lens sits a little above that.
 */
const PORTRAIT = { frame: 1.9, aim: 1.32, lift: 0.18, fov: 34 };
const GLIDE = { toPortrait: 1.5, toOrbit: 1.3, back: 1.2, join: 1.7, fromOrbit: 1.6 };
/** You wave at the camera once it has arrived in the green room. */
const WAVE_AFTER = 1.1;

/**
 * The camera before you join: the landing circles the room slowly (still with reduced motion);
 * the green room frames your avatar in the part of the screen the panel leaves free; joining
 * swings the camera round behind you (straight down into your view from the landing, e.g. solo
 * practice).
 */
export class LobbyCamera {
  private angle = ORBIT.start;
  private step: LobbyStepUi | null = null;
  private first = true;
  private waveIn = -1;
  /** Fractions of the screen the green-room panel covers on the right and at the bottom. */
  private coverRight = 0.34;
  private coverBottom = 0;
  private readonly position = v3.vec3();
  private readonly target = v3.vec3();
  private readonly pivot = v3.vec3();

  setInsets(right: number, bottom: number): void {
    this.coverRight = clamp(right, 0, 0.8);
    this.coverBottom = clamp(bottom, 0, 0.8);
  }

  update(sim: Simulation, dt: number, step: LobbyStepUi | null): void {
    const prev = this.step;
    this.step = step;
    if (step === null) {
      if (prev !== null) this.swoopIn(sim, prev);
      return;
    }
    if (prev === null) this.placeOnStage(sim);
    const fov = step === 'start' ? this.orbitPose(sim, dt) : this.portraitPose(sim);
    sim.camera.setFixed(this.position, this.target, fov, this.first);
    if (!this.first && prev !== step) {
      const seconds =
        prev === null ? GLIDE.back : step === 'ready' ? GLIDE.toPortrait : GLIDE.toOrbit;
      sim.camera.glideTo('fixed', seconds);
    }
    this.first = false;
    if (step === 'ready' && prev !== 'ready') this.waveIn = WAVE_AFTER;
    if (step !== 'ready') this.waveIn = -1;
    if (this.waveIn >= 0 && (this.waveIn -= dt) < 0) sim.emote('wave');
  }

  /** Before the room: you stand on the stage (up from any seat), facing the green room's lens. */
  private placeOnStage(sim: Simulation): void {
    sim.teleport(STAGE.x, 0, STAGE.z, STAGE.yaw);
  }

  private orbitPose(sim: Simulation, dt: number): number {
    if (!sim.reducedMotion) this.angle += dt * ORBIT_SPEED;
    this.position.x = ORBIT.cx + Math.sin(this.angle) * ORBIT.rx;
    this.position.y = ORBIT.height;
    this.position.z = ORBIT.cz + Math.cos(this.angle) * ORBIT.rz;
    v3.copy(this.target, ORBIT_TARGET);
    return ORBIT.fov;
  }

  /**
   * In front of your avatar, aimed so you stand in the middle of what the panel leaves free: left
   * of center beside a side panel, above center over a bottom sheet. The camera's right (it looks
   * back at you) is (cos yaw, 0, -sin yaw).
   */
  private portraitPose(sim: Simulation): number {
    const me = sim.view.localPlayer;
    const x = me?.position.x ?? STAGE.x;
    const z = me?.position.z ?? STAGE.z;
    const yaw = me?.yaw ?? STAGE.yaw;
    const free = 1 - this.coverBottom;
    // Phones: a slightly wider lens keeps the camera inside the room.
    const fov = lerp(PORTRAIT.fov + 8, PORTRAIT.fov, clamp(sim.aspect - 0.5, 0, 1));
    const tanV = Math.tan((fov * Math.PI) / 360);
    const tanH = tanV * Math.max(0.3, sim.aspect);
    // Far enough that `frame` meters fill the free height.
    const distance = PORTRAIT.frame / (2 * tanV * Math.max(0.3, free));
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    // Aim right of you / below you, so you appear left of center / above it.
    const side = this.coverRight * distance * tanH;
    const up = this.coverBottom * distance * tanV;
    this.position.x = x + fx * distance;
    this.position.y = PORTRAIT.aim + PORTRAIT.lift;
    this.position.z = z + fz * distance;
    this.target.x = x + rx * side;
    this.target.y = PORTRAIT.aim - up;
    this.target.z = z + rz * side;
    return fov;
  }

  /** Joining (or solo practice): from the green room, round behind you; from the landing, down. */
  private swoopIn(sim: Simulation, from: LobbyStepUi): void {
    const me = sim.view.localPlayer;
    sim.camera.orbit.recenter(me?.yaw ?? sim.camera.yaw);
    const mode = sim.localSeated ? 'seated' : 'follow';
    if (from === 'ready' && me) {
      // The camera swings around you on an arc over the open floor (not straight through the
      // wall), landing behind you looking at the room.
      v3.copy(this.pivot, me.position);
      sim.camera.glideTo(mode, GLIDE.join, this.pivot);
    } else {
      sim.camera.glideTo(mode, GLIDE.fromOrbit);
    }
  }
}
