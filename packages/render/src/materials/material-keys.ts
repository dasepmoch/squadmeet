/** The shared office material set and how each material batches, lights and casts. */
export type MaterialKey =
  | 'paint'
  | 'wood'
  | 'woodGloss'
  | 'fabric'
  | 'leather'
  | 'felt'
  | 'carpet'
  | 'metal'
  | 'chrome'
  | 'powder'
  | 'plastic'
  | 'gloss'
  | 'stone'
  | 'glass'
  | 'frosted'
  | 'emissive'
  | 'fixture'
  | 'lamp'
  | 'glow'
  | 'additive'
  | 'leaf'
  | 'paper'
  | 'rubber'
  | 'soil'
  | 'board';

export const MATERIAL_KEYS: readonly MaterialKey[] = [
  'paint',
  'wood',
  'woodGloss',
  'fabric',
  'leather',
  'felt',
  'carpet',
  'metal',
  'chrome',
  'powder',
  'plastic',
  'gloss',
  'stone',
  'glass',
  'frosted',
  'emissive',
  'fixture',
  'lamp',
  'glow',
  'additive',
  'leaf',
  'paper',
  'rubber',
  'soil',
  'board',
];

/** Materials whose batches receive but never cast shadows. */
export const NON_CASTING: ReadonlySet<MaterialKey> = new Set([
  'glass',
  'frosted',
  'emissive',
  'fixture',
  'lamp',
  'glow',
  'additive',
  'carpet',
]);

/** Unlit materials (no shadow receiving). */
export const UNLIT: ReadonlySet<MaterialKey> = new Set([
  'emissive',
  'fixture',
  'lamp',
  'glow',
  'additive',
]);

/** Self-lit materials that glow through selective bloom. */
export const BLOOMING: ReadonlySet<MaterialKey> = new Set(['emissive', 'fixture', 'lamp']);

/** Materials textured with real-world-scale UVs generated at batch time (meters). */
export const METRIC_UV: ReadonlySet<MaterialKey> = new Set([
  'paint',
  'wood',
  'woodGloss',
  'fabric',
  'leather',
  'felt',
  'carpet',
  'metal',
  'powder',
  'plastic',
  'stone',
  'rubber',
  'soil',
]);
