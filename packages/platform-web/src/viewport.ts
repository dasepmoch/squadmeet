import type { WebWindow } from './web-window.ts';
import type {
  LifecycleService,
  Orientation,
  SafeAreaInsets,
  ViewportService,
  ViewportSize,
} from '@huddle/platform';
import { listen } from './system.ts';

/** Reads `env(safe-area-inset-*)` through a hidden probe element. */
function readSafeArea(doc: Document, probe: HTMLElement): SafeAreaInsets {
  const style = doc.defaultView?.getComputedStyle(probe);
  const px = (v: string | undefined): number => Number.parseFloat(v ?? '0') || 0;
  return {
    top: px(style?.paddingTop),
    right: px(style?.paddingRight),
    bottom: px(style?.paddingBottom),
    left: px(style?.paddingLeft),
  };
}

export function createViewport(win: WebWindow, target: HTMLElement): ViewportService {
  const doc = win.document;
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  doc.body.appendChild(probe);

  const size = (): ViewportSize => ({
    width: Math.max(1, target.clientWidth),
    height: Math.max(1, target.clientHeight),
    pixelRatio: win.devicePixelRatio || 1,
  });
  const orientation = (): Orientation =>
    win.innerWidth >= win.innerHeight ? 'landscape' : 'portrait';

  return {
    getSize: size,
    onResize: (cb) => {
      const observer = new win.ResizeObserver(() => cb(size()));
      observer.observe(target);
      // devicePixelRatio changes (moving between monitors) do not trigger ResizeObserver.
      let dprQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
      const onDpr = (): void => {
        cb(size());
        dprQuery.removeEventListener('change', onDpr);
        dprQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
        dprQuery.addEventListener('change', onDpr);
      };
      dprQuery.addEventListener('change', onDpr);
      return () => {
        observer.disconnect();
        dprQuery.removeEventListener('change', onDpr);
      };
    },
    getSafeArea: () => readSafeArea(doc, probe),
    getOrientation: orientation,
    onOrientationChange: (cb) => {
      let last = orientation();
      return listen(win, 'resize', () => {
        const now = orientation();
        if (now !== last) {
          last = now;
          cb(now);
        }
      });
    },
  };
}

export function createLifecycle(win: WebWindow): LifecycleService {
  const doc = win.document;
  return {
    isVisible: () => doc.visibilityState === 'visible',
    isOnline: () => win.navigator.onLine,
    onVisibilityChange: (cb) => {
      const handler = (): void => cb(doc.visibilityState === 'visible');
      doc.addEventListener('visibilitychange', handler);
      return () => doc.removeEventListener('visibilitychange', handler);
    },
    onOnlineChange: (cb) => {
      const offOnline = listen(win, 'online', () => cb(true));
      const offOffline = listen(win, 'offline', () => cb(false));
      return () => {
        offOnline();
        offOffline();
      };
    },
    onBeforeExit: (cb) => listen(win, 'pagehide', () => cb()),
  };
}
