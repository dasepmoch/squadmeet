import type { WebWindow } from './web-window.ts';
import type { PlatformServices } from '@huddle/platform';
import { createLogger, type LogLevel } from '@huddle/shared';
import { detectCapabilities } from './capabilities.ts';
import { createWebInputFactory } from './input/web-input.ts';
import {
  createAudioContextProvider,
  createClipRecorder,
  createMediaDevices,
  createMediaElements,
  createPeerFactory,
  createScreenCapture,
} from './media.ts';
import { createWebSocketFactory } from './socket.ts';
import {
  createCanvasFactory,
  createClipboard,
  createConsoleSink,
  createExternal,
  createFrameScheduler,
  createFullscreen,
  createHaptics,
  createNotifications,
  createPermissions,
  createPreferences,
  createWebClock,
  createWebStorage,
} from './system.ts';
import { createLifecycle, createViewport } from './viewport.ts';

export { detectCapabilities } from './capabilities.ts';
export { createConsoleSink } from './system.ts';

export interface WebPlatformOptions {
  /** Element whose size drives the renderer (usually the app root). */
  viewportTarget: HTMLElement;
  logLevel?: LogLevel;
  win?: WebWindow;
}

/** Builds every platform service for the browser. The only place that touches web APIs. */
export function createWebPlatform(options: WebPlatformOptions): PlatformServices {
  const win = options.win ?? window;
  const logger = createLogger(createConsoleSink(win), 'huddle', options.logLevel ?? 'info');
  const platformLog = logger.child('platform');
  const report = (err: unknown): void => platformLog.warn('platform call failed', err);
  const capabilities = detectCapabilities(win);
  return {
    capabilities,
    clock: createWebClock(win),
    logger,
    storage: createWebStorage(win, report),
    input: createWebInputFactory(win, report),
    frames: createFrameScheduler(win),
    viewport: createViewport(win, options.viewportTarget),
    lifecycle: createLifecycle(win),
    preferences: createPreferences(win),
    fullscreen: createFullscreen(win),
    clipboard: createClipboard(win),
    haptics: createHaptics(win),
    permissions: createPermissions(win, report),
    external: createExternal(win),
    notifications: createNotifications(win),
    canvas: createCanvasFactory(win),
    screenCapture: createScreenCapture(win, capabilities.browser),
    mediaDevices: createMediaDevices(win),
    audio: createAudioContextProvider(win),
    recorder: createClipRecorder(win),
    peers: createPeerFactory(win),
    mediaElements: createMediaElements(win, report),
    sockets: createWebSocketFactory(win),
  };
}
