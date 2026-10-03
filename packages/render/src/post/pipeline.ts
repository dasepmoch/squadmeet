// n8ao ships JS only; consumers type-check render sources, so the ambient types are referenced here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/n8ao.d.ts" />
import { N8AOPostPass } from 'n8ao';
import {
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  HueSaturationEffect,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import * as THREE from 'three';
import type { QualitySettings } from '../quality/presets.ts';
import { DisplayPassthroughEffect } from './display-passthrough.ts';

export type ToneLook = 'agx' | 'aces' | 'neutral';

const TONE_MODES: Record<ToneLook, ToneMappingMode> = {
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  neutral: ToneMappingMode.NEUTRAL,
};

/**
 * pmndrs/postprocessing chain: Render -> N8AO -> [selective bloom, tone mapping, grade, vignette]
 * -> [SMAA/FXAA with dithering]. Bloom only affects the selected emissive objects.
 */
export class PostPipeline {
  readonly composer: EffectComposer;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private ao: N8AOPostPass | null = null;
  private bloom: SelectiveBloomEffect | null = null;
  private gradePass: EffectPass | null = null;
  private aaPass: EffectPass | null = null;
  private bloomObjects: THREE.Object3D[] = [];
  private width = 1;
  private height = 1;
  private look: ToneLook = 'agx';
  private exposure = 1;
  private settings: QualitySettings | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    renderer.toneMapping = THREE.NoToneMapping;
  }

  setBloomObjects(objects: THREE.Object3D[]): void {
    this.bloomObjects = objects;
    if (this.bloom) {
      this.bloom.selection.clear();
      for (const o of objects) this.bloom.selection.add(o);
    }
  }

  addBloomObject(object: THREE.Object3D): void {
    this.bloomObjects.push(object);
    this.bloom?.selection.add(object);
  }

  removeBloomObject(object: THREE.Object3D): void {
    this.bloomObjects = this.bloomObjects.filter((o) => o !== object);
    this.bloom?.selection.delete(object);
  }

  setLook(look: ToneLook, exposure: number): void {
    this.look = look;
    this.exposure = exposure;
    if (this.settings) this.configure(this.settings);
  }

  /** (Re)builds the pass chain for a quality level. */
  configure(settings: QualitySettings): void {
    this.settings = settings;
    this.composer.removeAllPasses();
    this.ao?.dispose();
    this.gradePass?.dispose();
    this.aaPass?.dispose();
    this.ao = null;
    this.bloom = null;
    this.composer.multisampling = settings.aa === 'smaa-msaa' ? 4 : 0;
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (settings.ao !== 'off') {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.configuration.aoRadius = 0.6;
      ao.configuration.distanceFalloff = 0.9;
      ao.configuration.intensity = settings.ao === 'half' ? 2.4 : 2.8;
      ao.configuration.color = new THREE.Color('#0d0a08');
      // Half-res AO with depth-aware upsampling is nearly indistinguishable indoors and much cheaper.
      ao.configuration.halfRes = settings.ao !== 'ultra';
      ao.configuration.gammaCorrection = false;
      // Transparency-aware AO re-renders the whole scene twice per frame (shadow maps included);
      // our transparent surfaces (decals, glass, markers) are thin and read fine without it.
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.setQualityMode(
        settings.ao === 'ultra' ? 'High' : settings.ao === 'full' ? 'Medium' : 'Low',
      );
      this.composer.addPass(ao);
      this.ao = ao;
    }

    const effects: Effect[] = [];
    if (settings.bloom) {
      // Subtle, physically motivated glow: only luminaires, LEDs and the display bloom.
      const bloom = new SelectiveBloomEffect(this.scene, this.camera, {
        mipmapBlur: true,
        luminanceThreshold: 0.9,
        luminanceSmoothing: 0.25,
        intensity: 0.75,
        radius: 0.58,
      });
      bloom.ignoreBackground = true;
      for (const o of this.bloomObjects) bloom.selection.add(o);
      effects.push(bloom);
      this.bloom = bloom;
    }
    const tone = new ToneMappingEffect({ mode: TONE_MODES[this.look] });
    effects.push(tone);
    effects.push(new HueSaturationEffect({ saturation: this.look === 'agx' ? 0.12 : 0.04 }));
    effects.push(new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 }));
    effects.push(new DisplayPassthroughEffect());
    effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.34 }));
    this.renderer.toneMappingExposure = this.exposure;
    this.gradePass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.gradePass);

    const aa =
      settings.aa === 'fxaa' ? new FXAAEffect() : new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.aaPass = new EffectPass(this.camera, aa);
    this.aaPass.dithering = true;
    this.composer.addPass(this.aaPass);
    this.composer.setSize(this.width, this.height, false);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height, false);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.ao?.dispose();
  }
}
