# Porting guide

The web build is the reference host. Other hosts provide their own implementation of
`PlatformServices` (see `packages/platform/src/index.ts`) and reuse every other package unchanged.

## Status

| Host                      | Status                                                |
| ------------------------- | ----------------------------------------------------- |
| Chromium (desktop)        | Tested during development (Chrome on macOS, Apple M2) |
| Firefox, Safari (desktop) | Untested                                              |
| iOS / Android browsers    | Untested                                              |
| Tauri v2 desktop / mobile | Not started (Phase 6)                                 |
| Capacitor                 | Not started (Phase 6, documented alternative)         |

The capability matrix and webview notes are completed in Phase 6.

## Media services

Voice and screen sharing (`packages/rtc`) only use these interfaces from
`packages/platform/src/media.ts`:

| Service                 | Web implementation                  | Notes for other hosts                                                                           |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MediaDevicesProvider`  | `getUserMedia`, `enumerateDevices`  | Throw `CaptureError` with a reason (`denied`, `no-device`, ...) so the HUD says the right thing |
| `ScreenCaptureProvider` | `getDisplayMedia` (Chromium hints)  | A native capture can feed frames into a `MediaStreamTrack`; set `mayIncludeSelf` honestly       |
| `AudioContextProvider`  | one shared `AudioContext`           | `resume()` runs on the Join click; `setOutputDevice` returns false when unsupported             |
| `PeerConnectionFactory` | `RTCPeerConnection`                 | `supported: false` disables voice and sharing (the room still works)                            |
| `MediaElementFactory`   | hidden `<video>` / `<audio>`        | `attachAudioSink`: Chromium needs remote WebRTC audio on a (muted) element for Web Audio        |
| `FullscreenService`     | Fullscreen API, iPhone video player | `supported` must be false where only `requestVideo` works                                       |

Known behavior to check on a new host:

- **Echo cancellation:** Chrome cancels all audio it plays on the default output device, Web
  Audio included. Other engines may only cancel audio played by media elements; spatial voices go
  through Web Audio, so test with speakers before shipping a host.
- **Speaker selection** needs `AudioContext.setSinkId` (Chromium); elsewhere the setting hides.
- **Tests** use Chrome's fake devices (`--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture`), see
  `playwright.config.ts`.
