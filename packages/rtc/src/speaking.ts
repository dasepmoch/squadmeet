/** Root mean square of one block of samples (-1..1). */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as number;
    sum += s * s;
  }
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

/** Thresholds and timings for speaking detection (RMS of -1..1 samples, seconds). */
export const SPEAKING = { on: 0.03, off: 0.015, attack: 0.06, release: 0.35 } as const;

/**
 * Speaking state with hysteresis: it switches on after the level stays above `on` for a short
 * attack time, and off only after it stays below `off` for the release time, so the speaking ring
 * does not flicker between words. `level` (0..1) drives the mouth.
 */
export class SpeakingDetector {
  speaking = false;
  level = 0;
  private above = 0;
  private below = 0;

  update(value: number, dt: number): boolean {
    const target = Math.min(1, Math.max(0, (value - 0.008) * 14));
    // Fast attack, slower decay: mouths open on syllables and close softly.
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 30 : 10));
    if (value > SPEAKING.on) {
      this.above += dt;
      this.below = 0;
    } else if (value < SPEAKING.off) {
      this.below += dt;
      this.above = 0;
    }
    if (!this.speaking && this.above >= SPEAKING.attack) this.speaking = true;
    if (this.speaking && this.below >= SPEAKING.release) this.speaking = false;
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.level = 0;
    this.above = 0;
    this.below = 0;
  }
}
