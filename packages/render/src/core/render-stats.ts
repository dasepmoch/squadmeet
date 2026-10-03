import type { QualityChoice, QualityLevel } from '../quality/presets.ts';
import type { RendererHost } from './renderer-host.ts';

export interface RenderStats {
  fps: number;
  frameMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  width: number;
  height: number;
  pixelRatio: number;
  resolutionScale: number;
  quality: QualityLevel;
  qualityChoice: QualityChoice;
  gpu: string;
  decals: number;
}

/** Frame statistics: smoothed frame time, renderer counters and a half-second FPS window. */
export class StatsMeter {
  readonly stats: RenderStats;
  private frames = 0;
  private time = 0;

  constructor(quality: QualityLevel, gpu: string) {
    this.stats = {
      fps: 0,
      frameMs: 0,
      renderMs: 0,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      programs: 0,
      width: 1,
      height: 1,
      pixelRatio: 1,
      resolutionScale: 1,
      quality,
      qualityChoice: 'auto',
      gpu,
      decals: 0,
    };
  }

  /** Call right after the frame's render, before `renderer.info` is reset. */
  update(host: RendererHost, dt: number, renderMs: number, decals: number): void {
    const r = host.renderer;
    const s = this.stats;
    s.frameMs = s.frameMs === 0 ? dt * 1000 : s.frameMs * 0.9 + dt * 100;
    s.renderMs = renderMs;
    s.drawCalls = r.info.render.calls;
    s.triangles = r.info.render.triangles;
    s.geometries = r.info.memory.geometries;
    s.textures = r.info.memory.textures;
    s.programs = r.info.programs?.length ?? 0;
    const size = host.size;
    s.width = size.width;
    s.height = size.height;
    s.pixelRatio = host.pixelRatio;
    s.resolutionScale = host.currentResolutionScale;
    s.decals = decals;
    this.frames++;
    this.time += dt;
    if (this.time >= 0.5) {
      s.fps = this.frames / this.time;
      this.frames = 0;
      this.time = 0;
    }
  }
}
