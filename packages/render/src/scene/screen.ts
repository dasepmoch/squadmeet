import type { CanvasFactory } from '@huddle/platform';
import type { ScreenDef } from '@huddle/shared';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ScreenCanvas, type IdleInfo } from './screen-canvas.ts';

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Display surface. Writes alpha 0 so the post pipeline can show it untouched by tone mapping and
 * grading (`DisplayPassthroughEffect`): slides keep their exact colors and crisp black text.
 */
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uBrightness;
uniform float uHover;
uniform float uDecodeSrgb;
uniform vec2 uFit;
varying vec2 vUv;
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec2 uv = (vUv - 0.5) / uFit + 0.5;
  vec3 c = vec3(0.0);
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) c = texture2D(uMap, uv).rgb;
  // three uploads sRGB video textures as linear RGBA8 and only decodes them inside built-in
  // materials (DECODE_VIDEO_TEXTURE), so custom shaders must decode video frames themselves.
  if (uDecodeSrgb > 0.5) c = srgbToLinear(c);
  vec2 e = min(vUv, 1.0 - vUv);
  float rim = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y * 1.78));
  c = c * uBrightness + vec3(0.35, 0.62, 1.0) * rim * uHover * 0.9;
  gl_FragColor = vec4(c, 0.0);
}`;

export type ScreenMode = 'idle' | 'video' | 'selfShare';

/**
 * How the display lights the room: an LTC area light (accurate, costly on every lit pixel), a
 * wide soft spot tinted the same way (cheap), or nothing.
 */
export type GlowMode = 'off' | 'spot' | 'area';

/**
 * VideoTexture that uploads only on new video frames (three.js drives it through
 * `requestVideoFrameCallback`) and can be paused, e.g. while Theater Mode shows the DOM video.
 */
class PausableVideoTexture extends THREE.VideoTexture {
  paused = false;

  override set needsUpdate(value: boolean) {
    if (value && this.paused) return;
    super.needsUpdate = value;
  }
}

/** Depth of the display body; the surface sits flush with its front. */
export const DISPLAY_DEPTH = 0.06;

/**
 * The main display: unlit surface fed by a video or the idle canvas, a hover rim, and a
 * screen-glow area light tinted by the picture at ~3 Hz.
 */
export class MainScreen {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly light: THREE.RectAreaLight | null;
  /** Cheap stand-in for the area light: a wide, shadowless spot from the display. */
  readonly glowSpot: THREE.SpotLight;
  private readonly spotPerArea: number;
  private readonly material: THREE.ShaderMaterial;
  private readonly canvas: ScreenCanvas;
  private readonly idleTexture: THREE.CanvasTexture;
  private videoTexture: PausableVideoTexture | null = null;
  private video: HTMLVideoElement | null = null;
  private mode: ScreenMode = 'idle';
  private paused = false;
  private hover = 0;
  private hoverTarget = 0;
  private readonly sampler: HTMLCanvasElement;
  private readonly samplerCtx: CanvasRenderingContext2D | null;
  private sampleTimer = 0;
  private readonly glowColor = new THREE.Color(0.4, 0.45, 0.7);
  private readonly def: ScreenDef;
  private lightBase = 2.4;

  constructor(def: ScreenDef, canvasFactory: CanvasFactory, withAreaLight: boolean) {
    this.def = def;
    this.canvas = new ScreenCanvas(canvasFactory);
    this.idleTexture = new THREE.CanvasTexture(this.canvas.canvas);
    this.idleTexture.colorSpace = THREE.SRGBColorSpace;
    this.idleTexture.anisotropy = 8;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      uniforms: {
        uMap: { value: this.idleTexture },
        uBrightness: { value: 1 },
        uHover: { value: 0 },
        uDecodeSrgb: { value: 0 },
        uFit: { value: new THREE.Vector2(1, 1) },
      },
      toneMapped: false,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(def.width, def.height), this.material);
    this.surface.name = 'screen-surface';
    const [cx, cy, cz] = def.center;
    const nx = Math.sin(def.yaw);
    const nz = Math.cos(def.yaw);
    const front = DISPLAY_DEPTH / 2 + 0.0015;
    this.surface.position.set(cx + nx * front, cy, cz + nz * front);
    this.surface.rotation.y = def.yaw;
    this.group.add(this.surface);

    this.sampler = canvasFactory.create(16, 9);
    this.samplerCtx = this.sampler.getContext('2d', { willReadFrequently: true });

    if (withAreaLight) {
      RectAreaLightUniformsLib.init();
      const light = new THREE.RectAreaLight(this.glowColor, this.lightBase, def.width, def.height);
      light.position.set(cx + nx * (front + 0.01), cy, cz + nz * (front + 0.01));
      light.lookAt(cx + nx * 5, cy, cz + nz * 5);
      this.group.add(light);
      this.light = light;
    } else {
      this.light = null;
    }
    // Roughly the same flux as the area light: luminance x area, spread over a wide soft cone.
    this.spotPerArea = def.width * def.height * 0.75;
    const spot = new THREE.SpotLight(
      this.glowColor,
      this.lightBase * this.spotPerArea,
      11,
      1.25,
      1,
      2,
    );
    spot.name = 'screen-glow';
    spot.position.set(cx + nx * 0.35, cy, cz + nz * 0.35);
    spot.target.position.set(cx + nx * 5, cy - 0.9, cz + nz * 5);
    spot.visible = !withAreaLight;
    this.group.add(spot, spot.target);
    this.glowSpot = spot;
  }

  setGlowMode(mode: GlowMode): void {
    const area = mode === 'area' && this.light !== null;
    if (this.light) this.light.visible = area;
    this.glowSpot.visible = mode === 'spot' || (mode === 'area' && !area);
  }

  get currentMode(): ScreenMode {
    return this.mode;
  }

  setHover(on: boolean): void {
    this.hoverTarget = on ? 1 : 0;
  }

  /** Scales the glow light (the display itself always shows exact colors). */
  setGlowStrength(strength: number): void {
    this.lightBase = 2.4 * strength;
  }

  showIdle(): void {
    this.detachVideo();
    this.mode = 'idle';
    this.setMap(this.idleTexture, 16 / 9);
  }

  showSelfShare(title: string, subtitle: string): void {
    this.detachVideo();
    this.mode = 'selfShare';
    if (this.canvas.drawSelfShare(title, subtitle)) this.idleTexture.needsUpdate = true;
    this.setMap(this.idleTexture, 16 / 9);
  }

  /** Shows a video element (screen share or demo stream). Frames upload only when new. */
  showVideo(video: HTMLVideoElement): void {
    this.detachVideo();
    const tex = new PausableVideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.paused = this.paused;
    this.videoTexture = tex;
    this.video = video;
    this.mode = 'video';
    this.setMap(tex, 16 / 9);
  }

  /** Pauses texture uploads (e.g. while Theater Mode shows the crisp DOM video). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.videoTexture) this.videoTexture.paused = paused;
  }

  update(dt: number, idle: IdleInfo): void {
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 10);
    (this.material.uniforms.uHover as { value: number }).value = this.hover;
    if (this.mode === 'idle' && this.canvas.drawIdle(idle)) this.idleTexture.needsUpdate = true;
    const v = this.video;
    if (this.mode === 'video' && v && v.videoWidth > 0) this.setFit(v.videoWidth / v.videoHeight);
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = 0.33;
      this.sampleGlow();
    }
    const kc = Math.min(1, dt * 4);
    const ki = Math.min(1, dt * 3);
    if (this.light) {
      this.light.color.lerp(this.glowColor, kc);
      this.light.intensity += (this.lightBase - this.light.intensity) * ki;
    }
    const spot = this.glowSpot;
    spot.color.lerp(this.glowColor, kc);
    spot.intensity += (this.lightBase * this.spotPerArea - spot.intensity) * ki;
  }

  dispose(): void {
    this.detachVideo();
    this.idleTexture.dispose();
    this.surface.geometry.dispose();
    this.material.dispose();
    this.light?.dispose();
    this.glowSpot.dispose();
  }

  private setMap(tex: THREE.Texture, aspect: number): void {
    const uniforms = this.material.uniforms;
    (uniforms.uMap as { value: THREE.Texture }).value = tex;
    // Video frames arrive undecoded (RGBA8), canvas textures are decoded by the GPU (SRGB8_ALPHA8).
    const decode = tex instanceof THREE.VideoTexture && tex.colorSpace === THREE.SRGBColorSpace;
    (uniforms.uDecodeSrgb as { value: number }).value = decode ? 1 : 0;
    this.setFit(aspect);
  }

  /** Letterboxes content whose aspect differs from the screen. */
  private setFit(contentAspect: number): void {
    const screenAspect = this.def.width / this.def.height;
    const fit = this.material.uniforms.uFit as { value: THREE.Vector2 };
    if (contentAspect > screenAspect) fit.value.set(1, screenAspect / contentAspect);
    else fit.value.set(contentAspect / screenAspect, 1);
  }

  private detachVideo(): void {
    this.video = null;
    this.videoTexture?.dispose();
    this.videoTexture = null;
  }

  private sampleGlow(): void {
    const ctx = this.samplerCtx;
    if (!ctx) return;
    const source: CanvasImageSource | null =
      this.mode === 'video' && this.video && this.video.readyState >= 2
        ? this.video
        : this.canvas.canvas;
    if (!source) return;
    ctx.drawImage(source, 0, 0, 16, 9);
    const px = ctx.getImageData(0, 0, 16, 9).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i] as number;
      g += px[i + 1] as number;
      b += px[i + 2] as number;
    }
    const n = (px.length / 4) * 255;
    this.glowColor.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
  }
}
