import { generateLeafAtlas, generateSplatAtlas } from './texture-atlas.ts';
import {
  generateBrushed,
  generateCarpet,
  generateFelt,
  generateLeather,
  generateNoiseNormal,
  generateQuartz,
  generateSoftDot,
  generateWoodVeneer,
  type PbrTextureSet,
  type TextureData,
} from './texture-data.ts';

/** Every procedural texture the renderer needs. Pure data: safe to build in a worker. */
export interface TextureBundle {
  carpet: PbrTextureSet;
  wood: PbrTextureSet;
  leather: PbrTextureSet;
  felt: PbrTextureSet;
  brushed: PbrTextureSet;
  quartz: PbrTextureSet;
  plaster: TextureData;
  weave: TextureData;
  plastic: TextureData;
  splats: TextureData;
  dot: TextureData;
  leaves: TextureData;
}

export interface TextureBundleOptions {
  floorSize: 512 | 1024;
  detailSize: 128 | 256;
}

export function generateTextureBundle(options: TextureBundleOptions): TextureBundle {
  const d = options.detailSize;
  const big = options.floorSize >= 1024 ? 512 : 256;
  return {
    carpet: generateCarpet(options.floorSize),
    wood: generateWoodVeneer(big),
    leather: generateLeather(d),
    felt: generateFelt(d),
    brushed: generateBrushed(d),
    quartz: generateQuartz(big),
    plaster: generateNoiseNormal(d, 24, 0.9, 3),
    weave: generateNoiseNormal(d, 16, 2.4, 5, true),
    plastic: generateNoiseNormal(d, 6, 0.5, 9),
    splats: generateSplatAtlas(512, 4),
    dot: generateSoftDot(64),
    leaves: generateLeafAtlas(256),
  };
}

function setBuffers(set: PbrTextureSet): TextureData[] {
  return [set.albedo, set.orm, set.normal];
}

/** All typed-array buffers of a bundle, for zero-copy transfer out of a worker. */
export function bundleTransferables(bundle: TextureBundle): ArrayBuffer[] {
  const list: TextureData[] = [
    ...setBuffers(bundle.carpet),
    ...setBuffers(bundle.wood),
    ...setBuffers(bundle.leather),
    ...setBuffers(bundle.felt),
    ...setBuffers(bundle.brushed),
    ...setBuffers(bundle.quartz),
    bundle.plaster,
    bundle.weave,
    bundle.plastic,
    bundle.splats,
    bundle.dot,
    bundle.leaves,
  ];
  return list.map((t) => t.data.buffer as ArrayBuffer);
}
