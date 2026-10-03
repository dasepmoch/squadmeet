import type { PlatformServices } from '@huddle/platform';
import type { GameRenderer } from '@huddle/render';
import { DemoPresentation } from './demo-presentation.ts';

/**
 * What the wall shows while nobody shares: the demo slide deck (`?screen=idle` shows the
 * clock instead). Also the stream Theater Mode falls back to.
 */
export class DemoScreen {
  private readonly platform: PlatformServices;
  private demo: DemoPresentation | null = null;
  private video: HTMLVideoElement | null = null;
  private renderer: GameRenderer | null = null;

  constructor(platform: PlatformServices) {
    this.platform = platform;
  }

  get stream(): MediaStream | null {
    return this.demo?.stream ?? null;
  }

  start(renderer: GameRenderer, search: string): void {
    this.renderer = renderer;
    if (new URLSearchParams(search).get('screen') !== 'idle') {
      this.demo = new DemoPresentation(document);
      if (this.demo.stream)
        this.video = this.platform.mediaElements.createVideo(this.demo.stream, { muted: true });
    }
    this.show();
  }

  /** Puts the deck (or the idle clock) back on the wall. */
  show(): void {
    const screen = this.renderer?.screen;
    if (!screen) return;
    if (this.video) screen.showVideo(this.video);
    else screen.showIdle();
  }

  update(dt: number): void {
    this.demo?.update(dt);
  }

  dispose(): void {
    this.demo?.dispose();
    if (this.video) this.platform.mediaElements.releaseVideo(this.video);
    this.demo = null;
    this.video = null;
  }
}
