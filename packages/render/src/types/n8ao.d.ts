// Type declarations for the parts of n8ao (ISC) used by the post pipeline. The package ships JS only.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export type N8AOQualityMode =
    | 'Performance'
    | 'Low'
    | 'Medium'
    | 'High'
    | 'Ultra'
    | 'Neural-Low'
    | 'Neural-Medium'
    | 'Neural-High';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    gammaCorrection: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** When true, every render traverses the scene to switch on `transparencyAware`. */
    autoDetectTransparency: boolean;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    setSize(width: number, height: number): void;
  }
}
