import { QUALITY_PRESETS, type QualityLevel, type QualitySettings } from './presets.ts';

/** Effects disabled in this fixed order when dynamic resolution alone is not enough. */
const DEGRADE_STEPS: readonly ((s: QualitySettings) => QualitySettings | null)[] = [
  (s) => (s.ao === 'ultra' ? { ...s, ao: 'full' } : null),
  (s) => (s.ao === 'full' ? { ...s, ao: 'half' } : null),
  (s) => (s.ao === 'half' ? { ...s, ao: 'off' } : null),
  (s) => (s.shadowSoft ? { ...s, shadowSoft: false } : null),
  (s) => (s.richAvatars ? { ...s, richAvatars: false } : null),
  (s) => (s.aa === 'smaa-msaa' ? { ...s, aa: 'smaa' } : null),
  (s) => (s.screenGlow === 'area' ? { ...s, screenGlow: 'spot' } : null),
  (s) => (s.lodDistance > 3 ? { ...s, lodDistance: 3 } : null),
  (s) => (s.bloom ? { ...s, bloom: false } : null),
  (s) =>
    s.shadowMapSize > 1024 ? { ...s, shadowMapSize: s.shadowMapSize === 4096 ? 2048 : 1024 } : null,
];

export interface ScalerDecision {
  resolutionScale: number;
  settings: QualitySettings;
  changed: 'none' | 'resolution' | 'settings';
}

/**
 * Frame-time driven quality control. First trades resolution (0.6..1.0), then disables effects
 * in a fixed order; recovers in reverse when there is sustained headroom. Hysteresis and
 * cooldowns prevent oscillation.
 */
export class AutoScaler {
  enabled = true;
  private targetMs: number;
  private avg = 0;
  private scale = 1;
  private readonly stack: QualitySettings[] = [];
  private settings: QualitySettings;
  private cooldown = 2;
  private slowTime = 0;
  private fastTime = 0;

  constructor(start: QualityLevel, targetFps: number) {
    this.settings = { ...QUALITY_PRESETS[start] };
    this.targetMs = 1000 / targetFps;
  }

  get current(): QualitySettings {
    return this.settings;
  }

  get resolutionScale(): number {
    return this.scale;
  }

  get averageFrameMs(): number {
    return this.avg;
  }

  reset(level: QualityLevel, targetFps: number): void {
    this.settings = { ...QUALITY_PRESETS[level] };
    this.targetMs = 1000 / targetFps;
    this.stack.length = 0;
    this.scale = 1;
    this.cooldown = 2;
    this.slowTime = 0;
    this.fastTime = 0;
  }

  /** Feed the measured frame interval (ms) once per frame. */
  sample(frameMs: number, dt: number): ScalerDecision {
    const clamped = Math.min(frameMs, 100);
    this.avg = this.avg === 0 ? clamped : this.avg + (clamped - this.avg) * Math.min(1, dt * 2);
    const none: ScalerDecision = {
      resolutionScale: this.scale,
      settings: this.settings,
      changed: 'none',
    };
    if (!this.enabled) return none;
    this.cooldown -= dt;
    if (this.avg > this.targetMs * 1.18) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (this.avg < this.targetMs * 1.04) {
      this.fastTime += dt;
      this.slowTime = 0;
    } else {
      this.slowTime = 0;
      this.fastTime = 0;
    }
    if (this.cooldown > 0) return none;
    if (this.slowTime > 1.5) {
      this.slowTime = 0;
      this.cooldown = 2.5;
      if (this.scale > 0.61) {
        this.scale = Math.max(0.6, this.scale - 0.1);
        return { resolutionScale: this.scale, settings: this.settings, changed: 'resolution' };
      }
      for (const step of DEGRADE_STEPS) {
        const next = step(this.settings);
        if (next) {
          this.stack.push(this.settings);
          this.settings = next;
          this.scale = 0.8;
          return { resolutionScale: this.scale, settings: this.settings, changed: 'settings' };
        }
      }
      return none;
    }
    if (this.fastTime > 6) {
      this.fastTime = 0;
      this.cooldown = 4;
      if (this.scale < 0.99) {
        this.scale = Math.min(1, this.scale + 0.1);
        return { resolutionScale: this.scale, settings: this.settings, changed: 'resolution' };
      }
      const prev = this.stack.pop();
      if (prev) {
        this.settings = prev;
        return { resolutionScale: this.scale, settings: this.settings, changed: 'settings' };
      }
    }
    return none;
  }
}
