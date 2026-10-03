import type { PlatformServices } from '@huddle/platform';
import { AvatarPreview, type AvatarMeshBuilder } from '@huddle/render';
import type { AvatarPreviewHandle } from '@huddle/ui';

/** Runs the avatar editor's turntable in its own render loop until the editor closes. */
export function mountAvatarPreview(
  canvas: HTMLCanvasElement,
  build: AvatarMeshBuilder,
  platform: PlatformServices,
): AvatarPreviewHandle {
  const preview = new AvatarPreview(canvas, build);
  const { frames, clock, viewport } = platform;
  let alive = true;
  let handle = 0;
  let last = clock.now();
  const resize = (): void => {
    const r = canvas.getBoundingClientRect();
    preview.setSize(
      Math.max(1, Math.round(r.width)),
      Math.max(1, Math.round(r.height)),
      viewport.getSize().pixelRatio,
    );
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const loop = (): void => {
    if (!alive) return;
    const now = clock.now();
    preview.render(Math.min(0.1, Math.max(0, (now - last) / 1000)));
    last = now;
    handle = frames.request(loop);
  };
  handle = frames.request(loop);
  return {
    setSpec: (spec) => preview.setSpec(spec),
    drag: (dx) => preview.drag(dx),
    setFraming: (f) => preview.setFraming(f),
    play: (id) => preview.play(id),
    dispose: () => {
      alive = false;
      frames.cancel(handle);
      observer.disconnect();
      preview.dispose();
    },
  };
}
