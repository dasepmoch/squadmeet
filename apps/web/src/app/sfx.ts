import type { AudioContextProvider } from '@huddle/platform';
import type { Vec3 } from '@huddle/shared';

export type SfxName =
  | 'whoosh'
  | 'bonk'
  | 'squeak'
  | 'splat'
  | 'pop'
  | 'sparkle'
  | 'tap'
  | 'chime'
  | 'blip'
  | 'click'
  | 'clap'
  | 'pour'
  | 'switch'
  | 'cheer'
  | 'swish'
  | 'mop'
  | 'shimmer'
  | 'step'
  | 'crunch'
  | 'sip'
  | 'paper'
  | 'deny';

const MAX_PER_SECOND = 28;
/** Footsteps get their own budget so a crowd walking cannot starve the other sounds. */
const MAX_STEPS_PER_SECOND = 12;
/** Room tone gain at full ambience volume. */
const AMBIENCE_GAIN = 0.07;

interface Ambience {
  out: GainNode;
}

/**
 * Tiny synthesized sound effects (no audio files): whooshes, bonks, duck squeaks, splats,
 * confetti pops, chimes. Positional sounds pan and fade with distance from the camera.
 */
export class Sfx {
  volume = 0.7;
  private readonly audio: AudioContextProvider;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly listener = { x: 0, y: 1.6, z: 0, fx: 0, fz: -1 };
  private windowStart = 0;
  private windowCount = 0;
  private stepCount = 0;
  private ambience: Ambience | null = null;

  constructor(audio: AudioContextProvider) {
    this.audio = audio;
  }

  /** Resumes audio after a user gesture (browsers start contexts suspended). */
  unlock(): void {
    this.audio.resume().catch(() => undefined);
  }

  setListener(position: Vec3, target: Vec3): void {
    const l = this.listener;
    l.x = position.x;
    l.y = position.y;
    l.z = position.z;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const len = Math.hypot(dx, dz) || 1;
    l.fx = dx / len;
    l.fz = dz / len;
  }

  /**
   * A quiet room tone (low air, a faint ventilation hiss, mains hum) at `level` 0..1. Needs a
   * running audio context; returns false while audio is still locked.
   */
  setAmbience(level: number): boolean {
    if (!this.audio.isRunning()) return false;
    const ctx = this.audio.get();
    const a = (this.ambience ??= this.createAmbience(ctx));
    a.out.gain.setTargetAtTime(
      Math.max(0, Math.min(1, level)) * AMBIENCE_GAIN,
      ctx.currentTime,
      0.4,
    );
    return true;
  }

  play(name: SfxName, at: Vec3 | null = null, gain = 1, delay = 0): void {
    if (this.volume <= 0 || !this.audio.isRunning()) return;
    const ctx = this.audio.get();
    const t = ctx.currentTime + delay;
    if (ctx.currentTime - this.windowStart > 1) {
      this.windowStart = ctx.currentTime;
      this.windowCount = 0;
      this.stepCount = 0;
    }
    if (
      name === 'step'
        ? ++this.stepCount > MAX_STEPS_PER_SECOND
        : ++this.windowCount > MAX_PER_SECOND
    )
      return;
    const out = this.route(ctx, at, gain);
    switch (name) {
      case 'whoosh':
        this.noiseBurst(ctx, out, t, 0.3, 'bandpass', 380, 2300, 1.3, 0.5);
        break;
      case 'bonk':
        this.tone(ctx, out, 'sine', 640, 170, t, 0.17, 0.75);
        this.tone(ctx, out, 'triangle', 1280, 360, t, 0.08, 0.25);
        this.noiseBurst(ctx, out, t, 0.025, 'highpass', 3000, 3000, 0.7, 0.3);
        break;
      case 'squeak':
        this.squeak(ctx, out, t);
        break;
      case 'splat':
        this.noiseBurst(ctx, out, t, 0.32, 'lowpass', 1600, 280, 0.8, 0.9);
        this.tone(ctx, out, 'sine', 130, 55, t, 0.2, 0.6);
        break;
      case 'pop':
        this.noiseBurst(ctx, out, t, 0.07, 'highpass', 1400, 1400, 0.7, 0.8);
        this.tone(ctx, out, 'sine', 240, 90, t, 0.12, 0.6);
        for (let i = 0; i < 7; i++)
          this.noiseBurst(
            ctx,
            out,
            t + 0.08 + Math.random() * 0.45,
            0.018,
            'bandpass',
            4200,
            4200,
            2,
            0.18,
          );
        break;
      case 'sparkle':
        [1318.5, 1760, 2637].forEach((f, i) =>
          this.tone(ctx, out, 'sine', f, f, t + i * 0.07, 0.55, 0.2),
        );
        break;
      case 'tap':
        this.noiseBurst(ctx, out, t, 0.04, 'bandpass', 2300, 1800, 3, 0.35);
        break;
      case 'chime':
        this.tone(ctx, out, 'sine', 660, 660, t, 0.6, 0.3);
        this.tone(ctx, out, 'sine', 990, 990, t + 0.12, 0.8, 0.26);
        break;
      case 'blip':
        this.tone(ctx, out, 'sine', 700, 1040, t, 0.09, 0.22);
        break;
      case 'click':
        this.tone(ctx, out, 'triangle', 1900, 1200, t, 0.035, 0.14);
        break;
      case 'clap':
        for (let i = 0; i < 6; i++) this.clap(ctx, out, t + i * 0.3 + Math.random() * 0.03);
        break;
      case 'pour':
        this.noiseBurst(ctx, out, t, 1.3, 'bandpass', 650, 1500, 2.2, 0.22);
        break;
      case 'switch':
        this.tone(ctx, out, 'square', 2800, 1900, t, 0.014, 0.12);
        this.noiseBurst(ctx, out, t, 0.02, 'highpass', 2500, 2500, 0.7, 0.3);
        break;
      case 'cheer':
        for (let i = 0; i < 3; i++)
          this.tone(ctx, out, 'sawtooth', 520 + i * 130, 780 + i * 160, t + i * 0.05, 0.35, 0.05);
        break;
      case 'swish':
        this.noiseBurst(ctx, out, t, 0.36, 'bandpass', 3200, 900, 1.4, 0.55);
        this.noiseBurst(ctx, out, t + 0.05, 0.18, 'highpass', 5000, 5000, 0.7, 0.16);
        break;
      case 'mop':
        for (let i = 0; i < 4; i++)
          this.noiseBurst(ctx, out, t + i * 0.27, 0.24, 'bandpass', 700, 1150, 1.1, 0.3);
        break;
      case 'shimmer':
        [1046.5, 1568, 2093, 3136].forEach((f, i) =>
          this.tone(ctx, out, 'sine', f, f * 1.01, t + i * 0.045, 0.4, 0.11),
        );
        this.noiseBurst(ctx, out, t, 0.3, 'highpass', 6500, 6500, 0.7, 0.07);
        break;
      case 'step': {
        // Soft carpet steps: a muffled thump, never the same twice.
        const f = 700 * (0.8 + Math.random() * 0.4);
        this.noiseBurst(ctx, out, t, 0.06, 'lowpass', f, f * 0.35, 0.8, 0.3);
        this.tone(ctx, out, 'sine', 95 + Math.random() * 20, 55, t, 0.07, 0.16);
        break;
      }
      case 'crunch':
        for (let i = 0; i < 5; i++)
          this.noiseBurst(
            ctx,
            out,
            t + i * 0.04 + Math.random() * 0.015,
            0.025,
            'bandpass',
            2600,
            1800,
            1.5,
            0.3,
          );
        break;
      case 'sip':
        this.noiseBurst(ctx, out, t, 0.28, 'bandpass', 420, 1500, 4, 0.2);
        this.noiseBurst(ctx, out, t + 0.3, 0.12, 'bandpass', 600, 1300, 4, 0.12);
        break;
      case 'paper':
        for (let i = 0; i < 4; i++)
          this.noiseBurst(
            ctx,
            out,
            t + i * 0.05 + Math.random() * 0.02,
            0.04,
            'highpass',
            3000,
            3000,
            0.8,
            0.2,
          );
        break;
      case 'deny':
        this.tone(ctx, out, 'sine', 330, 270, t, 0.08, 0.12);
        this.tone(ctx, out, 'sine', 300, 240, t + 0.1, 0.09, 0.1);
        break;
    }
  }

  private createAmbience(ctx: AudioContext): Ambience {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.masterOf(ctx));
    const noise = (
      type: BiquadFilterType,
      freq: number,
      q: number,
      level: number,
    ): BiquadFilterNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(filter).connect(g).connect(out);
      src.start(0, Math.random());
      return filter;
    };
    const air = noise('lowpass', 260, 0.7, 1);
    noise('bandpass', 1300, 0.45, 0.14);
    const hum = ctx.createOscillator();
    hum.frequency.value = 50;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.04;
    hum.connect(humGain).connect(out);
    hum.start();
    // The ventilation breathes slowly.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 70;
    lfo.connect(depth).connect(air.frequency);
    lfo.start();
    return { out };
  }

  /** Gain (distance falloff) and stereo pan relative to the camera. */
  private route(ctx: AudioContext, at: Vec3 | null, gain: number): AudioNode {
    const g = ctx.createGain();
    let vol = gain * this.volume;
    const master = this.masterOf(ctx);
    if (at) {
      const l = this.listener;
      const dx = at.x - l.x;
      const dz = at.z - l.z;
      const dist = Math.hypot(dx, at.y - l.y, dz);
      vol *= 1 / (1 + dist * 0.16);
      // Right of the view direction (fx, fz) is (-fz, fx).
      const side = (dx * -l.fz + dz * l.fx) / Math.max(0.6, Math.hypot(dx, dz));
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, side * 0.8));
      g.connect(pan).connect(master);
    } else {
      g.connect(master);
    }
    g.gain.value = vol;
    return g;
  }

  private masterOf(ctx: AudioContext): GainNode {
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
    }
    return this.master;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    peak: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    peak: number,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private squeak(ctx: AudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.linearRampToValueAtTime(1550, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(lp).connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  private clap(ctx: AudioContext, out: AudioNode, t: number): void {
    for (let i = 0; i < 3; i++)
      this.noiseBurst(ctx, out, t + i * 0.012, 0.05, 'bandpass', 1500, 1100, 0.9, 0.35);
  }
}
