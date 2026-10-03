export { RendererHost } from './core/renderer-host.ts';
export type { RenderStats } from './core/render-stats.ts';
export { GameRenderer, type GameRendererOptions } from './game-renderer.ts';
export {
  generateTextureBundle,
  bundleTransferables,
  type TextureBundle,
  type TextureBundleOptions,
} from './materials/texture-bundle.ts';
export {
  QUALITY_PRESETS,
  QUALITY_ORDER,
  type QualityChoice,
  type QualityLevel,
  type QualitySettings,
} from './quality/presets.ts';
export type { ToneLook } from './post/pipeline.ts';
export type { AvatarSystemHooks } from './avatar/avatar-system.ts';
export { AvatarPreview, type AvatarMeshBuilder } from './avatar/avatar-preview.ts';
export { SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS } from './avatar/avatar-palette.ts';
export { EMOTE_IDS, ACTION_LENGTH } from './avatar/emotes.ts';
export { buildAvatarMeshData, type AvatarMeshData } from './avatar/sculpt/character.ts';
export type { MainScreen, ScreenMode } from './scene/screen.ts';
export { drawBrandMark, drawWordmark } from './scene/brand-canvas.ts';
export { LIGHT_SCENES, type LightScene } from './scene/lighting.ts';
export type { BoardSurface, BoardStroke } from './scene/board.ts';
export type { DecalLayer } from './scene/decals.ts';
export type { ScoreRow } from './scene/play-handles.ts';
