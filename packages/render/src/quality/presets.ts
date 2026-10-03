import type { GlowMode } from '../scene/screen.ts';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityLevel | 'auto';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatioCap: number;
  shadowMapSize: 1024 | 2048 | 4096;
  shadowSoft: boolean;
  /** half: half-res AO, low samples; full: half-res AO, medium samples; ultra: full-res, high. */
  ao: 'off' | 'half' | 'full' | 'ultra';
  bloom: boolean;
  aa: 'fxaa' | 'smaa' | 'smaa-msaa';
  maxDecals: number;
  /** Avatars farther than this (meters) use their light LOD. */
  lodDistance: number;
  /** How the big display lights the room (the LTC area light is costly on every lit pixel). */
  screenGlow: GlowMode;
  /** Skin sheen, fabric sheen and anisotropic hair on avatars. */
  richAvatars: boolean;
  anisotropy: number;
  /** Cube size of the captured room light probe. */
  envSize: 128 | 256 | 512;
}

/**
 * Quality table, tuned with `scripts/_probe-perf`-style measurements: per-pixel lighting dominates
 * (each light costs roughly 1 ms at 1440x900 on an M2), so the cheaper tiers drop lights and
 * effects rather than resolution. The tightly fitted "ceiling light field" shadow map replaces
 * cascaded shadows indoors.
 */
export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualitySettings>> = {
  low: {
    level: 'low',
    pixelRatioCap: 1,
    shadowMapSize: 1024,
    shadowSoft: false,
    ao: 'off',
    bloom: false,
    aa: 'fxaa',
    maxDecals: 60,
    lodDistance: 3,
    screenGlow: 'off',
    richAvatars: false,
    anisotropy: 2,
    envSize: 128,
  },
  medium: {
    level: 'medium',
    pixelRatioCap: 1,
    shadowMapSize: 2048,
    shadowSoft: false,
    ao: 'half',
    bloom: true,
    aa: 'smaa',
    maxDecals: 150,
    lodDistance: 5,
    screenGlow: 'spot',
    richAvatars: false,
    anisotropy: 4,
    envSize: 256,
  },
  high: {
    level: 'high',
    pixelRatioCap: 1.25,
    shadowMapSize: 2048,
    shadowSoft: false,
    ao: 'full',
    bloom: true,
    aa: 'smaa',
    maxDecals: 300,
    lodDistance: 7,
    screenGlow: 'spot',
    richAvatars: true,
    anisotropy: 8,
    envSize: 256,
  },
  ultra: {
    level: 'ultra',
    pixelRatioCap: 2,
    shadowMapSize: 4096,
    shadowSoft: true,
    ao: 'ultra',
    bloom: true,
    aa: 'smaa-msaa',
    maxDecals: 500,
    lodDistance: 11,
    screenGlow: 'area',
    richAvatars: true,
    anisotropy: 16,
    envSize: 512,
  },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
