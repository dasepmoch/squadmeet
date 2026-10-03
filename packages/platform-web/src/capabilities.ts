import type { WebWindow } from './web-window.ts';
import type { Capabilities, HostBrowser, HostOs, HostPlatform } from '@huddle/platform';

interface UaBrand {
  brand: string;
}

interface UaData {
  mobile?: boolean;
  platform?: string;
  brands?: UaBrand[];
}

type ExtendedNavigator = Navigator & {
  userAgentData?: UaData;
  deviceMemory?: number;
};

function detectOs(ua: string, uaData: UaData | undefined, touchPoints: number): HostOs {
  const p = (uaData?.platform ?? '').toLowerCase();
  if (p.includes('android') || /Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (p.includes('mac') || /Mac OS X/.test(ua)) return 'macos';
  if (p.includes('win') || /Windows/.test(ua)) return 'windows';
  if (p.includes('linux') || /Linux/.test(ua)) return 'linux';
  return 'unknown';
}

function detectBrowser(ua: string, uaData: UaData | undefined): HostBrowser {
  if (uaData?.brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))) {
    return 'chromium';
  }
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari';
  return 'unknown';
}

function detectHost(win: WebWindow): HostPlatform {
  const w = win as Window & { __TAURI_INTERNALS__?: unknown; Capacitor?: unknown };
  if (w.Capacitor !== undefined) return 'capacitor';
  if (w.__TAURI_INTERNALS__ !== undefined) {
    return /Android|iPhone|iPad/.test(win.navigator.userAgent) ? 'tauri-mobile' : 'tauri-desktop';
  }
  return 'web';
}

function probeWebGL2(doc: Document): boolean {
  const canvas = doc.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

/** Computes the capability set once at boot. */
export function detectCapabilities(win: WebWindow = window): Capabilities {
  const nav = win.navigator as ExtendedNavigator;
  const doc = win.document;
  const ua = nav.userAgent;
  const uaData = nav.userAgentData;
  const touchPoints = nav.maxTouchPoints || 0;
  const os = detectOs(ua, uaData, touchPoints);
  const browser = detectBrowser(ua, uaData);
  const mediaDevices = nav.mediaDevices as MediaDevices | undefined;
  const hasDisplayMedia =
    typeof mediaDevices?.getDisplayMedia === 'function' && os !== 'ios' && os !== 'android';
  const audioCtor = win.AudioContext as typeof AudioContext | undefined;
  const fullscreenDoc = doc as Document & { webkitFullscreenEnabled?: boolean };

  return {
    platform: detectHost(win),
    os,
    browser,
    mobile: uaData?.mobile ?? (os === 'ios' || os === 'android'),
    webgl2: probeWebGL2(doc),
    webgpu: 'gpu' in nav,
    webrtc: typeof win.RTCPeerConnection === 'function',
    getUserMedia: typeof mediaDevices?.getUserMedia === 'function',
    getDisplayMedia: hasDisplayMedia,
    systemAudioCapture: hasDisplayMedia && browser === 'chromium',
    pointerLock: typeof doc.body.requestPointerLock === 'function',
    gamepad: typeof nav.getGamepads === 'function',
    touch: touchPoints > 0 || 'ontouchstart' in win,
    fullscreen: Boolean(doc.fullscreenEnabled || fullscreenDoc.webkitFullscreenEnabled),
    videoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    audioOutputSelection: audioCtor !== undefined && 'setSinkId' in audioCtor.prototype,
    share: typeof nav.share === 'function',
    clipboard: typeof nav.clipboard?.writeText === 'function',
    vibration: typeof nav.vibrate === 'function',
    notifications: 'Notification' in win,
    reducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hardwareConcurrency: nav.hardwareConcurrency || 4,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
}
