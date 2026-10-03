import type { Logger } from '@huddle/shared';
import * as THREE from 'three';

export interface RendererHostOptions {
  canvas: HTMLCanvasElement;
  logger: Logger;
  onContextLost: () => void;
  onContextRestored: () => void;
}

/**
 * Owns the WebGLRenderer and the canvas lifecycle: sizing, pixel ratio, context loss/restore.
 * Everything else in the render package receives the renderer from here.
 */
export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private width = 1;
  private height = 1;
  private devicePixelRatio = 1;
  private pixelRatioCap = 1.5;
  private resolutionScale = 1;
  private lost = false;
  private readonly onLost: (e: Event) => void;
  private readonly onRestored: () => void;

  constructor(options: RendererHostOptions) {
    this.canvas = options.canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.onLost = (e: Event) => {
      e.preventDefault();
      this.lost = true;
      options.logger.warn('WebGL context lost');
      options.onContextLost();
    };
    this.onRestored = () => {
      this.lost = false;
      options.logger.info('WebGL context restored');
      options.onContextRestored();
    };
    options.canvas.addEventListener('webglcontextlost', this.onLost);
    options.canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  get isContextLost(): boolean {
    return this.lost;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  get aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  /** Effective pixel ratio after the preset cap and the dynamic resolution scale. */
  get pixelRatio(): number {
    return Math.min(this.devicePixelRatio, this.pixelRatioCap) * this.resolutionScale;
  }

  setSize(width: number, height: number, devicePixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.devicePixelRatio = devicePixelRatio;
    this.apply();
  }

  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.apply();
  }

  /** Dynamic resolution in [0.5, 1], driven by the quality auto-scaler. */
  setResolutionScale(scale: number): void {
    const s = Math.min(1, Math.max(0.5, scale));
    if (Math.abs(s - this.resolutionScale) < 0.01) return;
    this.resolutionScale = s;
    this.apply();
  }

  get currentResolutionScale(): number {
    return this.resolutionScale;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
  }

  private apply(): void {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
  }
}
