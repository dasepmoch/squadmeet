import { lerp, lerpAngle, type WirePose } from '@huddle/shared';

export interface PoseSample extends WirePose {
  /** Server time of the snapshot (ms). */
  t: number;
}

const CAPACITY = 32;
/** Below this reported speed a player counts as standing still (no extrapolation). */
const STILL = 0.05;

function copyPose(out: WirePose, p: WirePose): void {
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.yaw = p.yaw;
  out.speed = p.speed;
  out.flags = p.flags;
}

/**
 * Recent server poses of one remote player. Rendering samples it slightly in the past
 * (`NET.interpolationDelayMs`) so there is almost always a pair to interpolate between; past the
 * newest snapshot it extrapolates along the last motion, but never longer than the cap.
 */
export class PoseBuffer {
  private readonly samples: PoseSample[] = [];

  get size(): number {
    return this.samples.length;
  }

  get newest(): PoseSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Adds a snapshot pose. Older-than-newest samples (reordered packets) are ignored. */
  push(t: number, pose: WirePose): void {
    const last = this.newest;
    if (last && t <= last.t) {
      // A keyframe repeating the latest time just refreshes it.
      if (t === last.t) copyPose(last, pose);
      return;
    }
    const s =
      this.samples.length >= CAPACITY
        ? (this.samples.shift() as PoseSample)
        : { t: 0, x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 };
    s.t = t;
    copyPose(s, pose);
    this.samples.push(s);
  }

  /** Pose at server time `t` (ms) into `out`; false while no sample has arrived. */
  sample(t: number, out: WirePose, extrapolationCapMs: number): boolean {
    const s = this.samples;
    const n = s.length;
    const first = s[0];
    const last = s[n - 1];
    if (!first || !last) return false;
    if (t <= first.t) {
      copyPose(out, first);
      return true;
    }
    if (t >= last.t) {
      copyPose(out, last);
      const prev = s[n - 2];
      if (!prev || last.speed < STILL || last.t <= prev.t) return true;
      const ahead = Math.min(t - last.t, extrapolationCapMs) / (last.t - prev.t);
      out.x = last.x + (last.x - prev.x) * ahead;
      out.z = last.z + (last.z - prev.z) * ahead;
      return true;
    }
    let i = n - 2;
    while (i > 0 && (s[i] as PoseSample).t > t) i--;
    const a = s[i] as PoseSample;
    const b = s[i + 1] as PoseSample;
    const k = (t - a.t) / (b.t - a.t);
    out.x = lerp(a.x, b.x, k);
    out.y = lerp(a.y, b.y, k);
    out.z = lerp(a.z, b.z, k);
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    out.speed = lerp(a.speed, b.speed, k);
    out.flags = k < 0.5 ? a.flags : b.flags;
    // Samples older than the pair in use will never be needed again.
    if (i > 2) s.splice(0, i - 2);
    return true;
  }

  clear(): void {
    this.samples.length = 0;
  }
}
