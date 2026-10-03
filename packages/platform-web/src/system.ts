import type { WebWindow } from './web-window.ts';
import type {
  CanvasFactory,
  ClipboardService,
  ExternalService,
  FrameScheduler,
  FullscreenService,
  HapticPattern,
  HapticsService,
  KeyValueStorage,
  NotificationsService,
  PermissionName,
  PermissionsService,
  PermissionState,
  PreferencesService,
} from '@huddle/platform';
import type { Clock, LogSink, TimerHandle, Unsubscribe } from '@huddle/shared';

const timerIds = new WeakMap<TimerHandle, number>();

function wrapTimer(id: number): TimerHandle {
  const handle = Object.freeze({ __timerHandle: true as const });
  timerIds.set(handle, id);
  return handle;
}

export function createWebClock(win: WebWindow): Clock {
  return {
    now: () => win.performance.now(),
    wallNow: () => Date.now(),
    setTimeout: (cb, ms) => wrapTimer(win.setTimeout(cb, ms)),
    clearTimeout: (h) => win.clearTimeout(timerIds.get(h)),
    setInterval: (cb, ms) => wrapTimer(win.setInterval(cb, ms)),
    clearInterval: (h) => win.clearInterval(timerIds.get(h)),
  };
}

/** Console sink for the shared logger. The only place the web build writes to the console. */
export function createConsoleSink(win: WebWindow): LogSink {
  const c = win.console;
  return (r) => {
    const line = `[${r.scope}] ${r.message}`;
    const args: unknown[] = r.data === undefined ? [line] : [line, r.data];
    if (r.level === 'error') c.error(...args);
    else if (r.level === 'warn') c.warn(...args);
    else if (r.level === 'info') c.info(...args);
    else c.debug(...args);
  };
}

/** localStorage with an in-memory fallback (private mode, disabled storage, sandboxed iframes). */
export function createWebStorage(win: WebWindow, onError: (err: unknown) => void): KeyValueStorage {
  const memory = new Map<string, string>();
  let backing: Storage | null = null;
  try {
    backing = win.localStorage;
    const probe = '__huddle_probe__';
    backing.setItem(probe, '1');
    backing.removeItem(probe);
  } catch (err: unknown) {
    onError(err);
    backing = null;
  }
  return {
    getItem: (key) => (backing ? backing.getItem(key) : (memory.get(key) ?? null)),
    setItem: (key, value) => {
      if (!backing) {
        memory.set(key, value);
        return;
      }
      try {
        backing.setItem(key, value);
      } catch (err: unknown) {
        onError(err);
        memory.set(key, value);
      }
    },
    removeItem: (key) => {
      memory.delete(key);
      backing?.removeItem(key);
    },
  };
}

export function createFrameScheduler(win: WebWindow): FrameScheduler {
  return {
    request: (cb) => win.requestAnimationFrame(cb),
    cancel: (id) => win.cancelAnimationFrame(id),
  };
}

export function createPreferences(win: WebWindow): PreferencesService {
  const query = win.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    prefersReducedMotion: () => query.matches,
    preferredLanguages: () => win.navigator.languages,
  };
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function createFullscreen(win: WebWindow): FullscreenService {
  const doc = win.document as WebkitDocument;
  const active = (): boolean => Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  return {
    // The value, not just the property: iPhone Safari has it but only allows video fullscreen.
    supported: Boolean(
      doc.fullscreenEnabled ||
      (doc as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled,
    ),
    isActive: active,
    request: async (element) => {
      const el = element as WebkitElement;
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    },
    requestVideo: async (video) => {
      const v = video as WebkitVideo;
      if (typeof v.requestFullscreen === 'function' && doc.fullscreenEnabled) {
        await v.requestFullscreen();
      } else if (v.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      }
    },
    exit: async () => {
      if (!active()) return;
      if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    },
    onChange: (cb) => {
      const handler = (): void => cb(active());
      doc.addEventListener('fullscreenchange', handler);
      doc.addEventListener('webkitfullscreenchange', handler);
      return () => {
        doc.removeEventListener('fullscreenchange', handler);
        doc.removeEventListener('webkitfullscreenchange', handler);
      };
    },
  };
}

export function createClipboard(win: WebWindow): ClipboardService {
  const clip = win.navigator.clipboard as Clipboard | undefined;
  return {
    supported: typeof clip?.writeText === 'function',
    writeText: async (text) => {
      if (!clip) throw new Error('Clipboard unavailable');
      await clip.writeText(text);
    },
  };
}

const HAPTIC_PATTERNS: Record<HapticPattern, number[]> = {
  light: [8],
  medium: [16],
  heavy: [30],
  success: [10, 40, 18],
  warning: [24, 60, 24],
};

export function createHaptics(win: WebWindow): HapticsService {
  const nav = win.navigator;
  const supported = typeof nav.vibrate === 'function';
  return {
    supported,
    pulse: (pattern) => {
      if (supported) nav.vibrate(HAPTIC_PATTERNS[pattern]);
    },
  };
}

const PERMISSION_QUERY: Record<PermissionName, string> = {
  microphone: 'microphone',
  camera: 'camera',
  notifications: 'notifications',
};

export function createPermissions(
  win: WebWindow,
  onError: (err: unknown) => void,
): PermissionsService {
  return {
    query: async (name): Promise<PermissionState> => {
      const perms = win.navigator.permissions as Permissions | undefined;
      if (!perms) return 'unknown';
      try {
        const status = await perms.query({
          name: PERMISSION_QUERY[name] as globalThis.PermissionName,
        });
        return status.state;
      } catch (err: unknown) {
        // Firefox/Safari reject some permission names; report as unknown instead of failing.
        onError(err);
        return 'unknown';
      }
    },
  };
}

export function createExternal(win: WebWindow): ExternalService {
  const nav = win.navigator;
  return {
    openUrl: (url) => {
      win.open(url, '_blank', 'noopener,noreferrer');
    },
    canShare: typeof nav.share === 'function',
    share: async (data) => {
      if (typeof nav.share !== 'function') return false;
      try {
        await nav.share(data);
        return true;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return false;
        throw err;
      }
    },
  };
}

export function createNotifications(win: WebWindow): NotificationsService {
  const supported = 'Notification' in win;
  return {
    supported,
    requestPermission: async () => {
      if (!supported) return 'unknown';
      const result = await win.Notification.requestPermission();
      return result === 'default' ? 'prompt' : result;
    },
    notify: (title, body) => {
      if (supported && win.Notification.permission === 'granted' && win.document.hidden) {
        new win.Notification(title, { body });
      }
    },
  };
}

export function createCanvasFactory(win: WebWindow): CanvasFactory {
  return {
    create: (width, height) => {
      const canvas = win.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
}

export function listen<K extends keyof WindowEventMap>(
  win: WebWindow,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Unsubscribe {
  win.addEventListener(type, handler, options);
  return () => win.removeEventListener(type, handler, options);
}
