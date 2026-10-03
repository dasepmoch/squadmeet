import type { Unsubscribe } from '@huddle/shared';

/** String key-value storage (localStorage on web, a store plugin on native shells). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FullscreenService {
  readonly supported: boolean;
  isActive(): boolean;
  request(element: HTMLElement): Promise<void>;
  /** iOS fallback: native fullscreen of a video element. */
  requestVideo(video: HTMLVideoElement): Promise<void>;
  exit(): Promise<void>;
  onChange(callback: (active: boolean) => void): Unsubscribe;
}

export interface ClipboardService {
  readonly supported: boolean;
  writeText(text: string): Promise<void>;
}

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

export interface HapticsService {
  readonly supported: boolean;
  pulse(pattern: HapticPattern): void;
}

export type PermissionName = 'microphone' | 'camera' | 'notifications';
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface PermissionsService {
  query(name: PermissionName): Promise<PermissionState>;
}

export interface LifecycleService {
  isVisible(): boolean;
  isOnline(): boolean;
  onVisibilityChange(callback: (visible: boolean) => void): Unsubscribe;
  onOnlineChange(callback: (online: boolean) => void): Unsubscribe;
  onBeforeExit(callback: () => void): Unsubscribe;
}

export interface ViewportSize {
  width: number;
  height: number;
  pixelRatio: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Orientation = 'portrait' | 'landscape';

/** Viewport size, safe-area insets and orientation (SafeArea/Orientation interface). */
export interface ViewportService {
  getSize(): ViewportSize;
  onResize(callback: (size: ViewportSize) => void): Unsubscribe;
  getSafeArea(): SafeAreaInsets;
  getOrientation(): Orientation;
  onOrientationChange(callback: (orientation: Orientation) => void): Unsubscribe;
}

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

export interface ExternalService {
  openUrl(url: string): void;
  readonly canShare: boolean;
  /** Returns false when the user cancelled or sharing is unsupported. */
  share(data: ShareData): Promise<boolean>;
}

export interface NotificationsService {
  readonly supported: boolean;
  requestPermission(): Promise<PermissionState>;
  notify(title: string, body: string): void;
}

/** Display-synchronized frame callbacks (requestAnimationFrame on web). */
export interface FrameScheduler {
  request(callback: (timeMs: number) => void): number;
  cancel(id: number): void;
}

/** Creates 2D canvases for text rasterization and procedural textures. */
export interface CanvasFactory {
  create(width: number, height: number): HTMLCanvasElement;
}

/** User preferences surfaced by the host (e.g. `prefers-reduced-motion`). */
export interface PreferencesService {
  prefersReducedMotion(): boolean;
  preferredLanguages(): readonly string[];
}
