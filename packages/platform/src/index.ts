import type { Clock, Logger, SocketFactory } from '@huddle/shared';
import type { Capabilities } from './capabilities.ts';
import { createToken } from './container.ts';
import type { InputSourceFactory } from './input.ts';
import type {
  AudioClipRecorder,
  AudioContextProvider,
  MediaDevicesProvider,
  MediaElementFactory,
  PeerConnectionFactory,
  ScreenCaptureProvider,
} from './media.ts';
import type {
  CanvasFactory,
  ClipboardService,
  ExternalService,
  FrameScheduler,
  FullscreenService,
  HapticsService,
  KeyValueStorage,
  LifecycleService,
  NotificationsService,
  PermissionsService,
  PreferencesService,
  ViewportService,
} from './system.ts';

export * from './capabilities.ts';
export * from './container.ts';
export * from './input.ts';
export * from './media.ts';
export * from './system.ts';

/** Every platform service a host must provide. Web: `@huddle/platform-web`. */
export interface PlatformServices {
  capabilities: Capabilities;
  clock: Clock;
  logger: Logger;
  storage: KeyValueStorage;
  input: InputSourceFactory;
  frames: FrameScheduler;
  viewport: ViewportService;
  lifecycle: LifecycleService;
  preferences: PreferencesService;
  fullscreen: FullscreenService;
  clipboard: ClipboardService;
  haptics: HapticsService;
  permissions: PermissionsService;
  external: ExternalService;
  notifications: NotificationsService;
  canvas: CanvasFactory;
  screenCapture: ScreenCaptureProvider;
  mediaDevices: MediaDevicesProvider;
  audio: AudioContextProvider;
  recorder: AudioClipRecorder;
  peers: PeerConnectionFactory;
  mediaElements: MediaElementFactory;
  sockets: SocketFactory;
}

/** Tokens for registering platform services in a `ServiceContainer`. */
export const PlatformTokens = {
  capabilities: createToken<Capabilities>('capabilities'),
  clock: createToken<Clock>('clock'),
  logger: createToken<Logger>('logger'),
  storage: createToken<KeyValueStorage>('storage'),
  input: createToken<InputSourceFactory>('input'),
  frames: createToken<FrameScheduler>('frames'),
  viewport: createToken<ViewportService>('viewport'),
  lifecycle: createToken<LifecycleService>('lifecycle'),
  preferences: createToken<PreferencesService>('preferences'),
  fullscreen: createToken<FullscreenService>('fullscreen'),
  clipboard: createToken<ClipboardService>('clipboard'),
  haptics: createToken<HapticsService>('haptics'),
  permissions: createToken<PermissionsService>('permissions'),
  external: createToken<ExternalService>('external'),
  notifications: createToken<NotificationsService>('notifications'),
  canvas: createToken<CanvasFactory>('canvas'),
  screenCapture: createToken<ScreenCaptureProvider>('screenCapture'),
  mediaDevices: createToken<MediaDevicesProvider>('mediaDevices'),
  audio: createToken<AudioContextProvider>('audio'),
  recorder: createToken<AudioClipRecorder>('recorder'),
  peers: createToken<PeerConnectionFactory>('peers'),
  mediaElements: createToken<MediaElementFactory>('mediaElements'),
  sockets: createToken<SocketFactory>('sockets'),
} as const;
