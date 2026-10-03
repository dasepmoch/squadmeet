# MASTER PROMPT: "HUDDLE" (working title)
### A bright, playful, high-fidelity 3D virtual meeting space for the web. WebRTC voice, big-screen sharing, architecture built to port to Tauri and mobile.

---

## 0. HOW YOU MUST WORK

You are acting as a principal engineer, a game developer and a technical artist at once. Build a **complete, working, production-minded project**, not a demo snippet.

**Communication**
- Talk to me in **casual Indonesian**. Write all code, comments, identifiers, commit messages and docs in **English**.

**Before writing code**
1. Verify the current stable versions and APIs of: three.js, Rapier, `postprocessing` (pmndrs), Vite, Tauri v2, livekit-client, coturn config. Do not trust memory for APIs that change often. Use the latest stable versions and pin exact versions in the lockfile.
2. Output a short architecture plan (max one page), the top 10 technical risks with mitigations, and the phase plan (Section 13). **Do not wait for my approval. Proceed.**
3. The decisions in Section 5 are locked. If something is technically impossible, deviate and explain in at most 5 lines.

**While building**
- Work **phase by phase** (Section 13). After each phase the project must install, typecheck, pass tests, build and run. Then give me a summary: what works, known gaps, how to run. Then continue to the next phase.
- If you hit an output limit, stop at a clean file boundary and tell me to say "lanjut".
- **No placeholders.** No `TODO`, no "implement later", no pseudo-code. If something is out of scope for the current phase, implement it behind an interface and expose a `capabilities` flag so the UI degrades gracefully.
- If you have a file system and terminal: actually create the repo, install, run, and fix your own errors. Use Playwright screenshots to critique the visuals yourself (see the self-critique loop in Section 8).
- If you only have chat: output complete files with full paths, one file per code block.
- Use only permissive licenses (MIT, Apache-2.0, BSD, CC0). Track them in `THIRD_PARTY.md`.
- Do not copy anyone's IP. Take inspiration from the *visual language* of Splatoon (Section 2). Do not use its characters, logos, names or fonts.

---

## 1. PRODUCT VISION

A browser-based 3D social meeting space that feels like hanging out in a beautiful, sunny loft instead of staring at a grid of faces. People walk around as avatars, sit in chairs, talk with spatial voice, and watch a presenter's shared screen on a huge in-world wall screen. It is still a real meeting tool. It is also casual and playful: people can raise a hand, but they can also throw a tomato or glide a paper airplane across the room.

**Pillars (in priority order)**
1. **Looks stunning.** Real-time 3D with solid shapes, crisp accurate shadows, bright saturated colors.
2. **Meeting-first.** Voice and screen share are rock solid. The screen is the star.
3. **Playful.** Lots of small, delightful social interactions.
4. **Portable by design.** The core is platform-agnostic. Web today, Tauri desktop and mobile tomorrow.
5. **Extensible.** Rooms, items, emotes and activities are data and plugins.
6. **Fast.** 60 FPS on a mid-range laptop with integrated GPU, 30 FPS on a mid-range phone.

---

## 2. ART DIRECTION: "SPLAT-POP REALISM"

**Interpretation:** the shapes are solid 3D with real lighting and shadows. It is **not** toon-shaded, has no outlines, and is not low-poly or retro. The *colors, energy and motifs* feel like Splatoon: neon-saturated, glossy, bold, paint-splattered, youthful.

**Do**
- Real-time PBR (`MeshPhysicalMaterial` / `MeshStandardMaterial`). Correct linear color workflow: sRGB textures, linear lighting, AgX or ACES tone mapping. No blown-out whites, no muddy grays.
- **Palette** (tune as needed, keep it saturated): orange `#FF5A1F`, electric blue `#2F5BFF`, magenta `#FF2E93`, lime `#B6FF2E`, violet `#7B3CFF`, teal `#00D9C0`, yellow `#FFD21F`. Neutrals: warm white `#FFF8EE`, charcoal `#1B1B2F`. Use complementary pairs (orange/blue, lime/violet, magenta/teal).
- **Shape language:** chunky, rounded, friendly, but with real-world proportions (1 unit = 1 meter). Every hard edge gets a small bevel (radius ≥ 2 to 3 cm) so highlights catch the edges. Use `RoundedBoxGeometry`, lathe, extrude and capsule shapes.
- **Materials:** glossy clearcoat plastic, painted wood, brushed metal, felt and fabric (roughness plus subtle procedural normal noise), translucent glass. Add procedural grain and roughness variation so nothing looks flat-CG.
- **Lighting:** bright daylight. A warm key sun (about 5500 to 6000 K) with crisp, physically plausible shadows, plus a cool sky fill, plus image-based lighting from a procedural sky (PMREM). Add ambient occlusion, faked bounce light, volumetric-looking light shafts through the windows (additive cone/plane shader), and bloom **only** on emissives (screen, neon).
- **Ink splat motif everywhere:** big painted splats on the floor and walls, splat-shaped UI backgrounds, splat hit effects, splat loading animation.
- **Characters:** premium "designer-toy" proportions. Smooth shading, glossy palette-based colors, real shadows, no outlines. Minimal expressive face: eyes with pupils and blinking, brows, mouth that flaps with voice amplitude.
- **UI style:** chunky rounded panels, slight tilt, bold display font plus a clean body font (self-host OFL fonts, e.g. Fredoka / Lilita One + Inter / Rubik). Contrast ≥ 4.5:1. Spring-based motion.
- **Sound design:** pops, splats, UI clicks, footsteps, ambient room tone. Synthesize with WebAudio or use CC0 files. No copyrighted audio.

**Don't:** cel-shading ramps, black outlines, flat vector look, beige or gray office vibes, dark moody lighting, anything that looks like a default three.js demo.

---

## 3. THE GOLDEN PATH (must feel great end to end)

1. Open a link → **Lobby:** name, avatar customizer (turntable preview), mic test and device select, join by room code or link.
2. Spawn in the loft. Third-person camera. WASD or click-to-move. Walk to a chair, press `E` or click it → avatar sits, and the camera glides into a **seated "cinema" view** where the big wall screen fills about 50 to 60 % of the horizontal view.
3. Voice works instantly: spatial audio, speaking rings above heads, mute and push-to-talk.
4. A presenter clicks **Share** (HUD button, or walks to the Present Pod and presses `E`), picks a window or tab, and the shared screen appears on the big wall screen for everyone in under 1 second.
5. Viewers watch it **on the wall by default**, from their seat. **Click the screen → Theater Mode** (a crisp fullscreen DOM `<video>`). `Esc` returns to the seat.
6. Anyone raises a hand (`H`), which joins a visible queue. Others toss paper planes, throw tomatoes that leave paint splats, fire confetti, and use the emote wheel.
7. The host switches room mode (Serious / Casual / Party), runs a timer, launches a poll.
8. Leave cleanly. Reconnect gracefully if the network drops.

---

## 4. FEATURE LIST AND PRIORITIES

### P0: core (Phases 0 to 4)
- Lobby and avatar customizer (body types, skin tones, hair, headwear, glasses, outfit colors and patterns, shoes, accessories such as headphones). The avatar is encoded in a compact `AvatarSpec` (< 64 bytes) so any client can rebuild it.
- Rooms: create and join via link or code, optional passcode, capacity limit, roles (host, presenter, participant, spectator).
- Movement: WASD, click-to-move (A* on a baked walk grid), sprint, small jump, collision, smooth remote interpolation.
- **Seats:** interactable seats with anchors (position, facing, posture variant, camera anchor). Seat claims are **server-arbitrated**. Several sit poses (upright, lean back, cross-legged on a bean bag).
- **Voice:** WebRTC, spatial (HRTF) audio, mute, deafen, push-to-talk, device picker, per-user volume, speaking detection (ring, mouth flap, name tag glow).
- **Big screen sharing** with system audio option, presenter management, hover highlight, click → Theater Mode, idle state (clock, room name, "click to share").
- Text chat (bubbles above heads plus history panel), emoji picker.
- **Emote wheel** (radial): wave, clap, thumbs up, heart, laugh, facepalm, shrug, think, cheer, 3 dances, yawn, sleep, BRB, point at screen. Data-driven.
- **Raise hand** with a formal queue visible to the presenter and host.
- **Throwables v1:** tomato (splat decals), paper plane (real glide), paper ball, confetti popper.
- Host controls: mute all, kick, lock room, transfer host, set presenter, room mode presets, disable throwables, clear all splats.
- Quality presets with an auto-scaler, settings menu, key remapping, i18n (**Indonesian + English**), reduced-motion option.
- Debug overlay (`F3`): FPS, frame time, draw calls, triangles, memory, ping, packet loss, bitrate, peer states, audio levels.

### P1: playful and productive layer (Phases 4 to 5)
- More throwables: water or paint balloon (big splat in the thrower's color), foam dart, pillow (bonk reaction), beach ball (persistent, bouncy), heart or flower (positive), party horn, rubber duck.
- **Hold-item system** with hand sockets: coffee mug (from the coffee machine), pizza slice, phone, sign boards.
- **Basketball hoop** (paper balls, scoreboard), dartboard, one table game (foosball or air hockey).
- **Whiteboard wall** (freehand, shapes, text, laser pointer, export PNG) and **sticky-note wall** (drag, color, vote). Synced.
- **Timer / hourglass** (big 3D countdown), dice, **walk-to-vote polls** (stand in zone A/B plus a panel poll).
- **Jukebox** with synced playback of bundled CC0 or procedurally generated loops.
- **Webcam** (opt-in): floating monitor over the avatar and/or a webcam wall.
- Follow-a-player, spotlight the presenter, **picture-in-picture** of the screen while roaming, time-of-day lighting presets (morning, noon, golden hour).
- Extra rooms via doors and portals (rooftop garden, amphitheater), voice zones.
- Offline **AO / lightmap bake script** for static geometry (Node + `three-mesh-bvh`).

### P2: scale and reach (Phase 6)
- **LiveKit SFU adapter** plus docker-compose (mesh stays the zero-infra default).
- Tauri v2 desktop shell with a **native screen-capture provider**, and a mobile shell. Capacitor is documented as an alternative.
- Optional glTF humanoid avatar import (bone-name mapping), in-game level editor (place props, export JSON), live captions, RNNoise WASM denoise.

---

## 5. TECH STACK (LOCKED)

| Concern | Decision |
|---|---|
| Language | TypeScript, `strict`, ESM everywhere, current Node LTS |
| Monorepo | pnpm workspaces (+ Turborepo for task caching) |
| Build/dev | Vite |
| 3D | **three.js (vanilla, not R3F, in the render layer)**. WebGL2 is the baseline. WebGPU is an experimental flag only |
| Post-FX | `postprocessing` (pmndrs): N8AO (or GTAO), SMAA, selective Bloom, tone mapping, subtle vignette and grade |
| Shadows | Cascaded shadow maps (CSM) or a tightly fitted high-res shadow map, whichever gives the sharpest result for this room size |
| Physics | Rapier3D (WASM), kinematic character controller, pooled dynamic bodies |
| UI/HUD | React + Zustand as a DOM overlay. **The game loop lives outside React.** CSS variables as design tokens |
| Net protocol | Node server, `ws`, MessagePack for high-frequency data, JSON for rare events, `zod` validation |
| RTC | Native browser WebRTC behind a `MediaTransport` interface. `MeshTransport` (default) and `LiveKitTransport` (adapter) |
| Audio | Own Web Audio graph in the `rtc` package (not tied to three.js) |
| i18n | i18next or a tiny custom solution, `id` + `en` |
| Tests | Vitest (engine, protocol), Playwright (e2e, visual screenshots) |
| Shells | Tauri v2 (desktop + mobile) primary, Capacitor documented alternative, PWA manifest |
| Deploy | Dockerfile + docker-compose: server, coturn, Caddy (HTTPS is required for capture APIs), optional LiveKit |

---

## 6. ARCHITECTURE AND PORTABILITY CONTRACT

### Repository layout
```
/apps
  /web          Vite entry, composition root for the browser build
  /desktop      Tauri v2 shell (scaffold, README, native ScreenCaptureProvider stub)
  /server       Node: WebSocket realtime + signaling + TURN credential minting + static hosting
/packages
  /shared       protocol types, zod schemas, constants, math utils (runs in Node and browser)
  /engine       platform-agnostic simulation: ECS/world, systems, state machines, input actions, events
  /render       three.js: scene builder, materials, avatar renderer, decals, particles, post-FX, quality manager
  /rtc          MediaTransport, MeshTransport, LiveKitTransport, spatial audio graph, speaking detection
  /net          RealtimeTransport (WebSocket impl), snapshot interpolation, clock sync, reconnect/session resume
  /platform     interfaces only (see rule 2)
  /platform-web web implementations of every platform interface
  /ui           React HUD, menus, lobby, theater mode, emote wheel, chat
  /content      rooms (JSON), items, emotes, throwables, activity modules, palettes, i18n strings
/docs           ARCHITECTURE.md, PORTING.md, PROTOCOL.md, CONTENT.md (mermaid diagrams)
```

Dependency direction is **downward only**: `apps → ui / render / rtc / net / platform-web → engine → shared`.

### Non-negotiable rules
1. **`engine` and `shared` are pure.** No `window`, `document`, `navigator`, `three`, or WebRTC. They run identically in Node (headless tests, server-side validation) and in the browser.
2. **Every platform feature sits behind an interface** in `packages/platform`, injected through a typed service container (no hidden global singletons): `ScreenCaptureProvider`, `MediaDevicesProvider`, `AudioContextProvider`, `InputSource` (keyboard, mouse, touch, gamepad → unified `InputFrame` of *actions*), `Storage`, `Fullscreen`, `Clipboard`, `Haptics`, `Permissions`, `Lifecycle` (visibility, pause, resume, background), `SafeArea/Orientation`, `OpenExternal/Share`, `Notifications`, `Clock`. Never touch `localStorage`, `navigator.mediaDevices`, etc. outside `platform-web`.
3. **`Capabilities` object computed at boot** (WebGL2, getUserMedia, getDisplayMedia, system-audio capture, pointer lock, gamepad, touch, fullscreen, WebGPU). UI and features degrade gracefully. Examples: iOS gets viewer-only screen share; no mic → listen-only; no WebGL2 → clear friendly error page.
4. **Input is action-based:** Move, Look, Interact, Sit, Throw, EmoteWheel, RaiseHand, PushToTalk, Chat, FocusScreen, etc. Bindings are data. Touch and gamepad map onto the same actions.
5. **Simulation uses a fixed timestep** (30 or 60 Hz) with interpolated rendering. Deterministic where feasible.
6. **Lightweight typed ECS** (own or `bitecs`). Systems are small and testable.
7. **Content is data-driven.** Rooms (props, colliders, seats, spawn points, voice zones, lights, screen mount), items, emotes and throwables are JSON plus registries. A new activity is one module: `ActivityModule { id; init(ctx); systems; netMessages; ui }`. Ship one worked example in `CONTENT.md`.
8. **The protocol is versioned and transport-independent** via `RealtimeTransport` (WebSocket now, WebTransport or datachannel later).
9. **Media is transport-independent** via `MediaTransport` (`publishMic`, `publishScreen`, `subscribe`, `setQuality`, events).
10. **The renderer is replaceable.** The engine exposes a read-only `WorldView`. The renderer only reads it.
11. **Asset pipeline:** procedural by default (the project must run with **zero external model files**). Also include a glTF/GLB loader with meshopt, KTX2 and Draco, an asset manifest, lazy loading and progress UI. First interactive frame payload under about 5 MB.
12. **Config** via env plus a runtime `config.json` plus feature flags.
13. **Webview reality check:** `getDisplayMedia` and WebRTC support differ between WebView2, WKWebView and WebKitGTK, and are historically shaky in some. Design `ScreenCaptureProvider` so a native implementation (e.g. Rust capture feeding frames into a `MediaStreamTrack` via canvas or `VideoFrame`) can replace the web one. Document the tested and untested platforms honestly in `PORTING.md`.

---

## 7. NETWORKING, WEBRTC, AUDIO

### Realtime state (WebSocket)
- Client-authoritative own movement, sent at 15 to 20 Hz. The **server validates** speed, bounds and rate limits, and arbitrates seats, roles, presenter slot, host actions and item ownership.
- Remote players use **snapshot interpolation** (about 100 ms buffer) plus extrapolation cap. The local player uses immediate response. Add **clock sync** (NTP-style offset) so timers, jukebox and countdowns are synchronized.
- **Reconnect with session resume:** same player id, same seat, same state if within a grace window. Show a friendly "reconnecting…" overlay.
- Rate limiting, payload size limits and schema validation on every message. Never trust the client.
- Room state kept in memory with an optional persistence interface (SQLite or Redis adapter), not required for v1.

### Signaling and topology
- Signaling rides the same WebSocket. Use the **perfect negotiation** pattern (polite/impolite), ICE restart on failure, and clean track lifecycle handling.
- **`MeshTransport`** is the default and needs zero extra infrastructure. It is capped by config (default about 8 participants because upload cost scales with viewers). Screen-share bitrate adapts to viewer count.
- **`LiveKitTransport`** is the recommended production path for larger rooms (simulcast/SFU). Same interface, selected by config.
- ICE servers come from env. The server mints **short-lived TURN credentials** (coturn `use-auth-secret` HMAC scheme). Ship a working coturn config in docker-compose. Corporate networks need TURN.

### Voice
- Capture constraints: echoCancellation, noiseSuppression, autoGainControl (toggleable). Opus with DTX. Hot-plug device handling. Push-to-talk, mute, deafen, sync mute state to peers.
- **Spatial graph per remote peer:** `MediaStreamAudioSourceNode → GainNode → PannerNode (HRTF, inverse/linear rolloff) → master compressor`. The listener follows the local avatar's head.
- **Three voice modes** (room preset or host-selected): `global`, `proximity`, `zones` (default). In `zones`, the meeting area is one global-voice zone, and lounge and play areas are proximity zones.
- Known Chromium quirk: a remote WebRTC audio stream may produce no output from Web Audio unless it is also attached to a (muted) media element. Verify current behavior and handle it.
- Resume `AudioContext` on a user gesture (the Lobby "Join" button). Speaking detection via `AnalyserNode` RMS with hysteresis, driving the ring, mouth flap and name tag.

### Screen sharing
- `getDisplayMedia` with ideal 1080p at 30 fps (max 60), audio optional. Use Chromium-only hints where supported (`systemAudio`, `surfaceSwitching`, `selfBrowserSurface: "exclude"`), always feature-detected.
- Toggle `track.contentHint` between `"detail"` (slides, text) and `"motion"` (video). For `"detail"`, set `degradationPreference = "maintain-resolution"` and tune `maxBitrate` via `RTCRtpSender.setParameters`.
- Handle the track's `ended` event (browser "Stop sharing" button). Show a persistent, obvious "You are sharing" bar with a Stop button.
- **One active presenter** at a time, arbitrated by the server. Others can request a handoff. The host can preempt.
- **Avoid the hall-of-mirrors:** when the presenter shares a surface that includes this app, show a static "You are sharing" placeholder on their own big screen instead of the recursive feed.
- **In-world rendering:** hidden `<video>` (muted, playsInline) → `THREE.VideoTexture` (sRGB, no mipmaps, linear filter, anisotropy), updated via `requestVideoFrameCallback` only when a new frame arrives. The screen material is unlit and emissive (`toneMapped: false`) with bloom. Add a **screen-glow light**: sample the video into a tiny 16×9 canvas at 2 to 4 Hz and tint a soft light and floor bounce near the screen. Cheap and beautiful.
- **Theater Mode:** a separate DOM `<video>` bound to the *same* `MediaStream` (crisper than the texture). Controls: exit, fit/fill, zoom and pan, volume, browser fullscreen (with the iOS video-element fullscreen fallback), a small strip showing the presenter and raised hands. While it is open, pause 3D texture updates to save GPU.
- **Shared-screen audio** plays as positional audio from the screen (or global in theater mode).
- Hover on the screen: rim highlight, pointer cursor and tooltip "Click to expand".

---

## 8. RENDERING AND PERFORMANCE

**Quality presets:** Low / Medium / High / Ultra, plus **Auto** (GPU tier detection at boot plus runtime frame-time monitoring).

| Setting | Low (mobile) | Medium | High | Ultra |
|---|---|---|---|---|
| Pixel ratio | 0.75 to 1 | 1 | ≤ 1.5 | ≤ 2 |
| Shadow map | 1024, single | 2048 | 4096 CSM | 4096 CSM + soft |
| AO | off (baked only) | half-res | full | full high-quality |
| Bloom | off | on | on | on |
| AA | FXAA | SMAA | SMAA | SMAA + MSAA where available |
| Max decals | 60 | 150 | 300 | 500 |
| Avatar detail | LOD low | LOD mid | LOD high | LOD high |

- The auto-scaler first adjusts dynamic resolution (0.6 to 1.0), then disables expensive effects in a fixed order, and can raise quality back when there is headroom.
- **Budgets:** ≤ 250 draw calls on High. `InstancedMesh` for repeated props, merged static geometry, shared materials, texture atlases. Object pools for projectiles, decals and particles. **No per-frame allocations in hot paths.** Dispose GPU resources properly. Handle WebGL context loss and restore.
- **Targets:** 60 FPS on Medium with integrated graphics (recent Intel Iris Xe / Apple M-series) at 1080p with 20 avatars and 60 active projectiles. ≥ 30 FPS on a mid-range phone at Low. Cap FPS optionally. Pause rendering (not net/audio) when the tab is hidden.
- **Camera:** third-person spring arm with wall collision. Seated cinema camera (FOV 55 to 60) with slight mouse-driven parallax and limited look-around (about ±80°). `F` toggles Focus Screen. Blends are smooth and eased.
- **Ambient life:** dust motes in sunbeams, plant sway (vertex shader), drifting clouds, subtle screen glow, spatialized room tone and birds.

**Self-critique loop (mandatory after the main scene is built):** take Playwright screenshots from (a) the seated view, (b) a high overview, (c) a close-up of props and an avatar. Check each against this checklist and iterate **at least twice**:
- [ ] Sunbeams and window-frame shadows are crisp and visible
- [ ] No shadow acne, no peter-panning, no shimmering edges
- [ ] Colors are saturated and pleasing, nothing dull gray/beige
- [ ] Avatars have grounded shadows and glossy readable materials
- [ ] The big screen is prominent, emissive and glows softly onto the room
- [ ] No banding in gradients (add dithering), no overexposure
- [ ] Bevels catch light on furniture edges
- [ ] Ink splats and neon accents give the room its identity

---

## 9. THE MAIN MAP: "SUNNY LOFT"

- **Footprint** about 26 m × 18 m, ceiling 6.5 m with white exposed beams.
- **North wall, Main Screen:** 8.0 × 4.5 m (16:9), glossy 12 cm bezel, mounted 1.2 m above the floor, neon under-glow strip. The wall is deep violet, framed by a huge orange and lime ink-splat mural.
- **South wall:** floor-to-ceiling steel-frame glass with a beautiful procedural outdoor scene (sun disc, soft clouds, distant trees and skyline) and a balcony door. Sunlight streams in and casts window-frame shadows across the floor.
- **Seating zone** (center-north): three shallow tiers facing the screen, mixed seating for **24**: 10 lounge chairs, 6 bean bags, 2 sofas (4 seats), 4 stools, plus spares. Every seat has an anchor (position, facing, posture, camera).
- **Present Pod:** a raised platform with a laptop stand and mic prop. `E` starts screen sharing.
- **Lounge corner** (east): L-sofa, coffee table, working coffee machine (spawns a mug in hand), snack bar, floor lamp, big plants, record-player jukebox.
- **Play corner** (west): paper-ball hoop with scoreboard, dartboard, one table game, a bin of beach balls.
- **Wall wing:** 8 m whiteboard wall and a sticky-note wall.
- **Floor:** light oak planks (subtle roughness variation), 3 to 4 big permanent ink-splat decals and colored zone rugs. Walkways at least 1.2 m wide.
- **Decor:** pendant lamps, oversized monstera and fern plants (cutout leaves with sway), instanced bookshelf with colorful spines, real-time wall clock, pennants, neon sign with the room name.
- **Logic data:** simplified collider meshes, baked walkable grid, voice zones (`meeting` = global, `lounge` / `play` = proximity), spawn points.
- **Further rooms** (Phase 5+): Rooftop Garden, Amphitheater. Same data format, loaded on demand.

---

## 10. AVATARS, ANIMATION, THROWABLES

**Avatars:** procedural by default and driven by `AvatarSpec`, behind an `AvatarRig` interface so a skinned glTF humanoid can replace it later. LOD for distance. Name tags face the camera, fade with distance, show the speaking ring and mute icon.

**Animation:** layered state machine: locomotion layer, posture layer (stand / sit), upper-body action layer (wave, throw, hold, clap), face layer (blink, talk, emotes). Procedural touches: head look-at toward the screen or active speaker, foot planting, sit pose adapting to seat height, idle micro-motion (breathing, weight shift), talking gestures scaled by voice amplitude. Use clip crossfades (`AnimationMixer`) with per-subtree masks so throwing works while walking.

**Throwables**
- **Tomato:** physics arc with aim preview. On impact: squash, **paint-splat decal** on floor/walls (oriented quad with a procedural splat sprite atlas, `polygonOffset`, depthWrite off, pooled and capped, oldest fades out), droplets particles, sound. On an avatar: flinch animation plus a splat decal parented to the torso or head. Auto-cleanup after about 60 s or a host **Clean up** action (mop animation).
- **Paper plane:** custom flight model (lift ∝ forward speed, gentle pitch oscillation, glide ratio around 5:1), steerable by the release tilt, lands and stays as a prop for about 30 s, can be picked up again with `E`.
- **Paper ball:** bouncy, scores in the hoop. **Confetti popper:** instanced particle burst in the ink palette.
- **Networking:** broadcast a `throw` event `{kind, origin, velocity, spin, t, seed}`. Every client simulates the cosmetic physics locally. Hits are resolved by the victim's client (sound + animation) and confirmed with a tiny event. The server only rate-limits and validates. Nothing gameplay-critical depends on exact physics agreement.
- **Safety valves:** per-throw cooldown, cap of in-flight projectiles per player and globally, a per-user **"Don't hit me"** toggle (projectiles pass through with a ghost shimmer), and a host **No-throw mode**.

---

## 11. CONTROLS

| Action | Desktop | Mobile | Gamepad |
|---|---|---|---|
| Move | WASD / arrows / click-to-move | left virtual stick / tap-to-move | left stick |
| Look | RMB drag (optional pointer lock) | drag right side | right stick |
| Sprint | Shift | stick push / toggle | L3 |
| Interact / Sit / Stand | `E` or click highlighted object | tap object / action button | A |
| Emote wheel | hold `Q` | long-press emote button | Y |
| Raise hand | `H` | button | D-pad |
| Throw | hold LMB (aim arc) + release, `1`–`6` select item | throw button, drag to aim | RT |
| Focus screen / free look | `F` | button | X |
| Mute / Push-to-talk | `M` / `V` | button | button |
| Chat | `Enter` | button | n/a |
| Theater Mode | click screen or `T` | tap screen | n/a |

Mobile specifics: safe-area insets, orientation handling, large touch targets, haptics via the `Haptics` interface, pause and resume via `Lifecycle`.

---

## 12. SAFETY, PRIVACY, SECURITY, DEVEX

- **Room modes:** Serious (reactions and hand-raise only), Casual (everything), Party (everything plus effects). The host can switch at any time and can lock throwables.
- Report, mute and kick tools. Optional profanity filter for chat. **No recording feature in v1** (call this out in docs as a deliberate legal and privacy choice).
- Clear mic and screen-share indicators. Respectful permission-denied flows.
- Sanitize chat (XSS-safe), CSP headers, helmet, strict CORS, signed room tokens, per-IP and per-connection rate limits, message size limits, passcode hashing.
- Pluggable `AuthProvider` interface (guest name only in v1).
- **Testing:** Vitest for engine, protocol and interpolation. Playwright e2e with Chromium fake media flags (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, auto-select capture source) for a 3-client join, voice, screen-share scenario. A Node **bot-swarm script** spawning N fake WebSocket clients for load testing (target: 50 clients per room smoothly for the state layer).
- **CI:** GitHub Actions running lint, typecheck, test, build. ESLint + Prettier. No `any`. No silent `catch`. No file over about 400 lines. No hidden global state.
- **Docs to deliver:** `README.md` (run in 3 commands), `ARCHITECTURE.md`, `PROTOCOL.md`, `PORTING.md` (Tauri v2 desktop and mobile, Capacitor, capability matrix, known webview limitations), `CONTENT.md` (add a room, item, emote, activity), `THIRD_PARTY.md`.
- Error UX everywhere: network drop, peer failure, mic denied, capture denied, WebGL context lost, unsupported browser.

---

## 13. PHASED DELIVERY (do them in order; each has a Definition of Done)

**Phase 0: Foundation.** Monorepo, tooling, CI, service container, all `platform` interfaces, `Capabilities`, engine skeleton with fixed timestep, Rapier integration, docs skeleton.
*DoD:* `pnpm dev` opens a 3D scene with a capsule character moving with collision. `pnpm test` and `pnpm build` are green.

**Phase 1: Visual vertical slice (offline, single player). Do this before networking.** Sunny Loft with full lighting, shadows, post-FX, procedural materials and props, the procedural avatar with core animations, third-person and seated cinema cameras, seats and sit/stand, Main Screen with a placeholder video, quality presets and auto-scaler, debug overlay.
*DoD:* passes the Section 8 self-critique checklist with screenshots included. 60 FPS on Medium on integrated graphics.

**Phase 2: Multiplayer core.** Server, rooms, lobby with avatar customizer, movement sync and interpolation, server-arbitrated seats, text chat and bubbles, emote wheel, raise-hand queue, host controls, reconnect.
*DoD:* 3 browser tabs see each other move smoothly, sit, chat and emote. Bot swarm test passes.

**Phase 3: Voice and screen share.** `MeshTransport`, TURN credentials, spatial audio with the 3 voice modes, presenter management, big-screen video texture, screen-glow light, Theater Mode, Present Pod.
*DoD:* Playwright e2e with fake devices passes. Manual test: share a window, everyone sees it on the wall, click → Theater Mode → `Esc` back to the seat.

**Phase 4: Playful layer.** Throwables v1 (tomato, paper plane, paper ball, confetti), splat decals, hit reactions, hold-item system, hoop and scoreboard, room mode presets, safety valves, sound design pass.
*DoD:* throwing feels great and is capped and safe. Decals stay within budget over a 30-minute soak test.

**Phase 5: Meeting tools.** Whiteboard, sticky notes, timer, dice, polls, jukebox, webcam bubble and wall, follow / spotlight / picture-in-picture, time-of-day presets, second room, offline AO bake script.
*DoD:* each feature is a proper `ActivityModule` (proving the plugin architecture) and is documented in `CONTENT.md`.

**Phase 6: Scale and portability.** `LiveKitTransport`, docker-compose (server + coturn + Caddy + optional LiveKit), Tauri v2 shell with native capture provider stub and mobile build notes, PWA, mobile touch polish, accessibility pass, final performance pass, complete `PORTING.md`.
*DoD:* a documented, honest capability matrix per platform. The web build deploys with one command.

---

## 14. ANTI-PATTERNS (do not do these)

- Do not put game logic inside React components or the render layer.
- Do not call browser APIs outside `platform-web`.
- Do not hard-code room layouts in TypeScript. Rooms are data.
- Do not ship a bland default-three.js look. Art direction in Section 2 is a requirement, not a suggestion.
- Do not allocate objects per frame in hot loops. Do not leak GPU resources.
- Do not block the main thread with heavy init. Load WASM asynchronously and use workers for baking and grid generation.
- Do not trust the client on the server. Do not skip reconnect and error states.
- Do not claim something works on a platform unless you actually verified it. Say "untested" instead.

**Start now: verify versions, deliver the one-page plan and risk list, then begin Phase 0 and continue through the phases.**
