# Third-party software

All runtime dependencies use permissive licenses (the two fonts use the SIL Open Font License,
which allows bundling them in apps). Versions are pinned exactly in `package.json` files and locked
in `pnpm-lock.yaml`.

## Runtime

| Package                    | Version | License    | Used for                                |
| -------------------------- | ------- | ---------- | --------------------------------------- |
| three                      | 0.186.1 | MIT        | WebGL rendering                         |
| postprocessing             | 6.39.5  | Zlib       | Post-processing pipeline                |
| n8ao                       | 2.0.1   | ISC        | Screen-space ambient occlusion          |
| @dimforge/rapier3d-compat  | 0.21.0  | Apache-2.0 | Physics and character controller (WASM) |
| react, react-dom           | 19.3.0  | MIT        | HUD overlay                             |
| zustand                    | 5.0.15  | MIT        | HUD state store                         |
| @fontsource-variable/inter | 5.3.0   | OFL-1.1    | Body & UI font (Inter Variable)         |
| @fontsource/unbounded      | 5.3.0   | OFL-1.1    | Display font (Unbounded)                |
| zod                        | 4.6.5   | MIT        | Schema validation                       |
| helmet                     | 8.3.0   | MIT        | Security headers                        |
| ws                         | 8.22.0  | MIT        | WebSocket server, load-test bots        |

## Development

| Package                                             | Version         | License    |
| --------------------------------------------------- | --------------- | ---------- |
| vite                                                | 8.3.1           | MIT        |
| @vitejs/plugin-react                                | 6.1.1           | MIT        |
| vitest                                              | 5.0.2           | MIT        |
| typescript                                          | 6.0.3           | Apache-2.0 |
| turbo                                               | 2.11.5          | MIT        |
| eslint, @eslint/js                                  | 10.11.0, 10.0.1 | MIT        |
| typescript-eslint                                   | 8.71.0          | MIT        |
| eslint-plugin-react-hooks                           | 7.1.1           | MIT        |
| eslint-config-prettier                              | 10.1.8          | MIT        |
| globals                                             | 17.12.0         | MIT        |
| prettier                                            | 3.9.9           | MIT        |
| @playwright/test                                    | 1.63.0          | Apache-2.0 |
| @types/node, @types/three, @types/react*, @types/ws | pinned          | MIT        |

## Assets

The fonts above are bundled from their npm packages. The project ships no other external model,
texture or audio files: room geometry, avatars, textures, the demo slides and sound effects are
generated procedurally at runtime (the e2e test's fake microphone WAV too).

Voice and screen sharing use the browser's own WebRTC and Web Audio; no media library is bundled.
The optional TURN relay, [coturn](https://github.com/coturn/coturn) (BSD-3-Clause), runs as a
separate service (`deploy/coturn/turnserver.conf`).
