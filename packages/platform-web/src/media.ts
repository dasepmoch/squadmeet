import type { WebWindow } from './web-window.ts';
import {
  CaptureError,
  type AudioClipRecorder,
  type AudioContextProvider,
  type AudioSink,
  type CaptureSurface,
  type HostBrowser,
  type MediaDeviceEntry,
  type MediaDevicesProvider,
  type MediaElementFactory,
  type PeerConnectionFactory,
  type ScreenCaptureProvider,
} from '@huddle/platform';

function mapMediaError(err: unknown): CaptureError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CaptureError(
          /system|permission denied by system/i.test(err.message) ? 'denied' : 'cancelled',
          err.message,
        );
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CaptureError('no-device', err.message);
      case 'NotSupportedError':
        return new CaptureError('unsupported', err.message);
      case 'AbortError':
        return new CaptureError('cancelled', err.message);
      default:
        return new CaptureError('failed', `${err.name}: ${err.message}`);
    }
  }
  if (err instanceof TypeError) return new CaptureError('unsupported', err.message);
  return new CaptureError('failed', String(err));
}

/** `getDisplayMedia` with Chromium-only hints applied when the browser supports them. */
export function createScreenCapture(win: WebWindow, browser: HostBrowser): ScreenCaptureProvider {
  const md = win.navigator.mediaDevices as MediaDevices | undefined;
  const supported = typeof md?.getDisplayMedia === 'function';
  const chromium = browser === 'chromium';
  return {
    supported,
    supportsSystemAudio: supported && chromium,
    capture: async (opts) => {
      if (!md || !supported) throw new CaptureError('unsupported');
      const constraints: DisplayMediaStreamOptions & Record<string, unknown> = {
        video: {
          width: { ideal: opts.width },
          height: { ideal: opts.height },
          frameRate: { ideal: opts.frameRate, max: opts.maxFrameRate },
        },
        audio: opts.audio
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : false,
      };
      if (chromium) {
        constraints.systemAudio = opts.audio ? 'include' : 'exclude';
        constraints.surfaceSwitching = 'include';
        constraints.selfBrowserSurface = 'exclude';
        constraints.monitorTypeSurfaces = 'include';
      }
      let stream: MediaStream;
      try {
        stream = await md.getDisplayMedia(constraints);
      } catch (err: unknown) {
        throw mapMediaError(err);
      }
      const video = stream.getVideoTracks()[0];
      const settings = (video?.getSettings() ?? {}) as MediaTrackSettings & {
        displaySurface?: string;
      };
      const surface: CaptureSurface =
        settings.displaySurface === 'monitor' ||
        settings.displaySurface === 'window' ||
        settings.displaySurface === 'browser'
          ? settings.displaySurface
          : 'unknown';
      return {
        stream,
        surface,
        hasAudio: stream.getAudioTracks().length > 0,
        mayIncludeSelf: surface !== 'browser' || !chromium,
      };
    },
  };
}

export function createMediaDevices(win: WebWindow): MediaDevicesProvider {
  const md = win.navigator.mediaDevices as MediaDevices | undefined;
  const supported = typeof md?.getUserMedia === 'function';
  return {
    supported,
    list: async () => {
      if (!md) return [];
      const devices = await md.enumerateDevices();
      return devices
        .filter(
          (d) => d.kind === 'audioinput' || d.kind === 'audiooutput' || d.kind === 'videoinput',
        )
        .map((d, i): MediaDeviceEntry => ({
          id: d.deviceId,
          label: d.label || `${d.kind} ${i + 1}`,
          kind: d.kind,
        }));
    },
    getMicrophone: async (c) => {
      if (!md || !supported) throw new CaptureError('unsupported');
      try {
        return await md.getUserMedia({
          audio: {
            ...(c.deviceId ? { deviceId: { exact: c.deviceId } } : {}),
            echoCancellation: c.echoCancellation,
            noiseSuppression: c.noiseSuppression,
            autoGainControl: c.autoGainControl,
            channelCount: { ideal: 1 },
          },
          video: false,
        });
      } catch (err: unknown) {
        throw mapMediaError(err);
      }
    },
    getCamera: async (c) => {
      if (!md || !supported) throw new CaptureError('unsupported');
      try {
        return await md.getUserMedia({
          audio: false,
          video: {
            ...(c.deviceId ? { deviceId: { exact: c.deviceId } } : {}),
            width: { ideal: c.width },
            height: { ideal: c.height },
            frameRate: { ideal: c.frameRate },
          },
        });
      } catch (err: unknown) {
        throw mapMediaError(err);
      }
    },
    onDeviceChange: (cb) => {
      if (!md) return () => undefined;
      md.addEventListener('devicechange', cb);
      return () => md.removeEventListener('devicechange', cb);
    },
  };
}

type SinkableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export function createAudioContextProvider(win: WebWindow): AudioContextProvider {
  let ctx: AudioContext | null = null;
  const listeners = new Set<(running: boolean) => void>();
  const get = (): AudioContext => {
    if (ctx) return ctx;
    const created = new win.AudioContext({ latencyHint: 'interactive' });
    created.addEventListener('statechange', () => {
      for (const l of listeners) l(created.state === 'running');
    });
    ctx = created;
    return created;
  };
  return {
    get,
    resume: async () => {
      const c = get();
      if (c.state !== 'running') await c.resume();
    },
    isRunning: () => ctx?.state === 'running',
    onStateChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setOutputDevice: async (deviceId) => {
      const c = get() as SinkableContext;
      if (typeof c.setSinkId !== 'function') return false;
      await c.setSinkId(deviceId);
      return true;
    },
  };
}

/** `MediaRecorder` clips (WebM/Opus in Chromium and Firefox, MP4/AAC in Safari). */
export function createClipRecorder(win: WebWindow): AudioClipRecorder {
  const Recorder = win.MediaRecorder as typeof MediaRecorder | undefined;
  return {
    supported: typeof Recorder === 'function',
    record: (stream, ms, signal) =>
      new Promise<Blob>((resolve, reject) => {
        if (!Recorder) {
          reject(new CaptureError('unsupported'));
          return;
        }
        let rec: MediaRecorder;
        try {
          rec = new Recorder(stream);
        } catch (err: unknown) {
          reject(new CaptureError('unsupported', err instanceof Error ? err.message : undefined));
          return;
        }
        if (signal?.aborted) {
          reject(new CaptureError('cancelled'));
          return;
        }
        const chunks: Blob[] = [];
        let timer = 0;
        const stop = (): void => {
          win.clearTimeout(timer);
          if (rec.state !== 'inactive') rec.stop();
        };
        rec.addEventListener('dataavailable', (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        });
        rec.addEventListener('stop', () => resolve(new Blob(chunks, { type: rec.mimeType })));
        rec.addEventListener('error', () => reject(new CaptureError('failed')));
        timer = win.setTimeout(stop, ms);
        signal?.addEventListener('abort', stop, { once: true });
        rec.start();
      }),
  };
}

export function createPeerFactory(win: WebWindow): PeerConnectionFactory {
  const ctor = win.RTCPeerConnection as typeof RTCPeerConnection | undefined;
  return {
    supported: typeof ctor === 'function',
    create: (config) => {
      if (!ctor) throw new Error('WebRTC is not supported');
      return new ctor(config);
    },
  };
}

/**
 * Hidden host for media elements. Some browsers stop decoding video that is detached from
 * the document, so elements live in an invisible fixed container.
 */
function mediaHost(doc: Document): HTMLElement {
  const existing = doc.getElementById('huddle-media-host');
  if (existing) return existing;
  const host = doc.createElement('div');
  host.id = 'huddle-media-host';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
  doc.body.appendChild(host);
  return host;
}

export function createMediaElements(
  win: WebWindow,
  onError: (err: unknown) => void,
): MediaElementFactory {
  const doc = win.document;
  const play = (el: HTMLMediaElement): void => {
    el.play().catch((err: unknown) => {
      if (!(err instanceof DOMException && err.name === 'AbortError')) onError(err);
    });
  };
  return {
    createVideo: (stream, { muted }) => {
      const video = doc.createElement('video');
      video.muted = muted;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      mediaHost(doc).appendChild(video);
      if (stream) play(video);
      return video;
    },
    releaseVideo: (video) => {
      video.pause();
      video.srcObject = null;
      video.remove();
    },
    attachAudioSink: (stream): AudioSink => {
      // Chromium quirk: remote WebRTC audio only flows into Web Audio when the stream is also
      // attached to a media element. The element stays muted; Web Audio does the playback.
      const audio = doc.createElement('audio');
      audio.muted = true;
      audio.autoplay = true;
      audio.srcObject = stream;
      mediaHost(doc).appendChild(audio);
      play(audio);
      return {
        dispose: () => {
          audio.pause();
          audio.srcObject = null;
          audio.remove();
        },
      };
    },
  };
}
