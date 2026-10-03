import * as THREE from 'three';
import { EnvProjection } from './env-projection.ts';
import type { MaterialKey } from './material-keys.ts';
import type { TextureBundle } from './texture-bundle.ts';
import type { PbrTextureSet, TextureData } from './texture-data.ts';

function toTexture(t: TextureData, srgb: boolean, anisotropy: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    t.data,
    t.width,
    t.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

interface PbrTextures {
  map: THREE.DataTexture;
  orm: THREE.DataTexture;
  normal: THREE.DataTexture;
}

/**
 * Shared office material set. Batched geometry carries per-vertex colors and metric UVs, so a
 * couple of dozen physically based materials cover the whole room at a handful of draw calls.
 */
export class MaterialLibrary {
  readonly textures: {
    carpet: PbrTextures;
    wood: PbrTextures;
    leather: PbrTextures;
    felt: PbrTextures;
    brushed: PbrTextures;
    quartz: PbrTextures;
    plaster: THREE.DataTexture;
    weave: THREE.DataTexture;
    plastic: THREE.DataTexture;
    splats: THREE.DataTexture;
    dot: THREE.DataTexture;
    leaves: THREE.DataTexture;
  };
  readonly carpetTile: [number, number];
  readonly envProjection = new EnvProjection();
  /** Shared time uniform for animated materials (plant sway). */
  readonly time = { value: 0 };
  private readonly materials = new Map<MaterialKey, THREE.Material>();
  private readonly owned: THREE.Texture[] = [];
  private leafDepth: THREE.MeshDepthMaterial | null = null;

  constructor(bundle: TextureBundle, anisotropy: number) {
    const pbr = (set: PbrTextureSet): PbrTextures => {
      const t = {
        map: toTexture(set.albedo, true, anisotropy),
        orm: toTexture(set.orm, false, anisotropy),
        normal: toTexture(set.normal, false, anisotropy),
      };
      for (const tex of [t.map, t.orm, t.normal]) tex.repeat.set(1 / set.tile[0], 1 / set.tile[1]);
      this.owned.push(t.map, t.orm, t.normal);
      return t;
    };
    const plain = (
      t: TextureData,
      srgb: boolean,
      aniso: number,
      clamp = false,
    ): THREE.DataTexture => {
      const tex = toTexture(t, srgb, aniso);
      if (clamp) tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      this.owned.push(tex);
      return tex;
    };
    this.carpetTile = bundle.carpet.tile;
    this.textures = {
      carpet: pbr(bundle.carpet),
      wood: pbr(bundle.wood),
      leather: pbr(bundle.leather),
      felt: pbr(bundle.felt),
      brushed: pbr(bundle.brushed),
      quartz: pbr(bundle.quartz),
      plaster: plain(bundle.plaster, false, 4),
      weave: plain(bundle.weave, false, 4),
      plastic: plain(bundle.plastic, false, 4),
      splats: plain(bundle.splats, false, 4, true),
      dot: plain(bundle.dot, false, 1, true),
      leaves: plain(bundle.leaves, true, 4, true),
    };
    this.build();
  }

  get(key: MaterialKey): THREE.Material {
    const m = this.materials.get(key);
    if (!m) throw new Error(`Unknown material ${key}`);
    return m;
  }

  /** Every shared material (for disposal bookkeeping). */
  all(): THREE.Material[] {
    return [...this.materials.values()];
  }

  /** Depth material that applies the same leaf sway, so swaying leaves cast matching shadows. */
  leafDepthMaterial(): THREE.MeshDepthMaterial {
    if (!this.leafDepth) {
      const m = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: this.textures.leaves,
        alphaTest: 0.5,
      });
      this.injectSway(m);
      this.leafDepth = m;
    }
    return this.leafDepth;
  }

  setAnisotropy(value: number): void {
    const t = this.textures;
    for (const set of [t.carpet, t.wood, t.quartz]) {
      for (const tex of [set.map, set.orm, set.normal]) {
        tex.anisotropy = value;
        tex.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.leafDepth?.dispose();
    for (const t of this.owned) t.dispose();
  }

  /** Clone of a texture with its own repeat (shares the uploaded image). */
  private scaled(tex: THREE.Texture, meters: number): THREE.Texture {
    const c = tex.clone();
    c.repeat.set(1 / meters, 1 / meters);
    this.owned.push(c);
    return c;
  }

  private build(): void {
    const t = this.textures;
    const nrm = (
      tex: THREE.Texture,
      s: number,
    ): { normalMap: THREE.Texture; normalScale: THREE.Vector2 } => ({
      normalMap: tex,
      normalScale: new THREE.Vector2(s, s),
    });
    const set = (key: MaterialKey, m: THREE.Material, projected = true): void => {
      if (projected) this.envProjection.apply(m);
      this.materials.set(key, m);
    };
    set(
      'paint',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        ...nrm(this.scaled(t.plaster, 0.6), 0.22),
      }),
    );
    const wood = {
      vertexColors: true,
      map: t.wood.map,
      roughnessMap: t.wood.orm,
      ...nrm(t.wood.normal, 0.3),
    };
    set(
      'wood',
      new THREE.MeshPhysicalMaterial({
        ...wood,
        roughness: 0.68,
        clearcoat: 0.22,
        clearcoatRoughness: 0.35,
      }),
    );
    // Satin lacquer: a soft reflection of the luminaires without mirroring the whole ceiling.
    set(
      'woodGloss',
      new THREE.MeshPhysicalMaterial({
        ...wood,
        roughness: 0.52,
        clearcoat: 0.6,
        clearcoatRoughness: 0.14,
      }),
    );
    set(
      'fabric',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.92,
        sheen: 0.7,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0.5, 0.5, 0.5),
        ...nrm(this.scaled(t.weave, 0.05), 0.55),
      }),
    );
    set(
      'leather',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughnessMap: t.leather.orm,
        roughness: 0.78,
        sheen: 0.25,
        sheenRoughness: 0.4,
        clearcoat: 0.18,
        clearcoatRoughness: 0.42,
        ...nrm(t.leather.normal, 0.45),
      }),
    );
    set(
      'felt',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: t.felt.map,
        roughness: 1,
        ...nrm(t.felt.normal, 0.9),
      }),
    );
    set(
      'carpet',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: t.carpet.map,
        roughness: 1,
        ...nrm(t.carpet.normal, 0.9),
      }),
    );
    set(
      'metal',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 1,
        roughness: 0.36,
        roughnessMap: t.brushed.orm,
        ...nrm(t.brushed.normal, 0.12),
      }),
    );
    set(
      'chrome',
      new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.07 }),
    );
    set(
      'powder',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.5,
        clearcoat: 0.12,
        clearcoatRoughness: 0.4,
        ...nrm(this.scaled(t.plastic, 0.2), 0.2),
      }),
    );
    set(
      'plastic',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.42,
        ...nrm(this.scaled(t.plastic, 0.4), 0.08),
      }),
    );
    set(
      'gloss',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.22,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
    );
    set(
      'stone',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        map: t.quartz.map,
        roughnessMap: t.quartz.orm,
        roughness: 0.55,
        clearcoat: 0.35,
        clearcoatRoughness: 0.1,
      }),
    );
    set(
      'glass',
      new THREE.MeshPhysicalMaterial({
        color: 0xf4fbff,
        roughness: 0.02,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        envMapIntensity: 1.3,
        specularIntensity: 1,
      }),
    );
    set(
      'frosted',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.5,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    set('emissive', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false);
    // Luminaires: their material color is the dimmer / scene tint driven by the light rig.
    set('fixture', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false);
    set('lamp', new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false);
    set(
      'glow',
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: t.dot,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      false,
    );
    // Soft light gradients (LED coves, light spill) baked into vertex colors.
    set(
      'additive',
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      false,
    );
    const leaf = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: t.leaves,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.55,
    });
    this.injectSway(leaf);
    set('leaf', leaf);
    set('paper', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }));
    set('rubber', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    set(
      'soil',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        ...nrm(t.felt.normal, 1.4),
      }),
    );
    set(
      'board',
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
      }),
    );
  }

  /** Very gentle leaf motion (indoor air handling), applied in object space. */
  private injectSway(material: THREE.Material): void {
    const time = this.time;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            '#ifdef USE_UV',
            'float swayW = clamp(uv.y - floor(uv.y * 2.0) * 0.5, 0.0, 0.5) * 2.0;',
            '#else',
            'float swayW = 0.5;',
            '#endif',
            'float swayA = sin(uTime * 0.9 + position.x * 1.3 + position.z * 0.7);',
            'transformed += vec3(swayA * 0.006, 0.0, swayA * 0.004) * swayW;',
          ].join('\n'),
        );
    };
    material.customProgramCacheKey = () => 'huddle-leaf-sway';
  }
}
