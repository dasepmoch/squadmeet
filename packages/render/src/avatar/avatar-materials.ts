import * as THREE from 'three';
import type { MaterialLibrary } from '../materials/library.ts';
import { EYE_COLORS, pick } from './avatar-palette.ts';

const PATTERN_VERT_PARS = /* glsl */ `
attribute vec4 aPattern;
varying vec4 vPattern;
varying vec3 vBindPos;
`;

const PATTERN_FRAG_PARS = /* glsl */ `
varying vec4 vPattern;
varying vec3 vBindPos;
// Prints in bind space (meters), anti-aliased with screen-space derivatives.
float aaWave(float x) {
  float s = sin(x * 6.2831853);
  float w = fwidth(s) * 0.75 + 1e-4;
  return smoothstep(-w, w, s);
}
float patternMask(float id, vec3 p) {
  vec2 pc = vec2(p.x + p.z * 0.8, p.y);
  if (id < 0.5) return 0.0;
  if (id < 1.5) return aaWave(pc.y * 13.0);
  if (id < 2.5) {
    vec2 g = fract(pc * 22.0) - 0.5;
    float r = length(g);
    float w = fwidth(r) + 1e-4;
    return 1.0 - smoothstep(0.17 - w, 0.17 + w, r);
  }
  if (id < 3.5) return (aaWave(pc.x * 10.0) + aaWave(pc.y * 10.0)) * 0.5;
  float w = fwidth(p.y) + 1e-4;
  return smoothstep(1.035 - w, 1.035 + w, p.y) * (1.0 - smoothstep(1.17 - w, 1.17 + w, p.y));
}
`;

const EYE_FRAG = /* glsl */ `
vec3 ed = normalize(vEyeDir);
float eyeAng = acos(clamp(ed.z, -1.0, 1.0));
float eyeAz = atan(ed.y, ed.x);
float irisR = 0.6;
float pupilR = 0.25 + uPupil;
float fibers = 0.82 + 0.18 * sin(eyeAz * 31.0 + sin(eyeAz * 5.0) * 2.4) * smoothstep(pupilR, irisR, eyeAng);
vec3 iris = uIris * fibers * mix(1.45, 0.72, smoothstep(pupilR, irisR, eyeAng));
iris *= mix(1.0, 0.25, smoothstep(irisR - 0.1, irisR, eyeAng));
vec3 sclera = vec3(0.96, 0.94, 0.93) * mix(1.0, 0.78, smoothstep(1.0, 1.7, eyeAng));
sclera = mix(sclera, vec3(0.98, 0.86, 0.86), smoothstep(1.2, 1.6, eyeAng) * 0.35);
float inIris = 1.0 - smoothstep(irisR - 0.012, irisR + 0.012, eyeAng);
float inPupil = 1.0 - smoothstep(pupilR - 0.02, pupilR + 0.02, eyeAng);
vec3 eyeCol = mix(sclera, iris, inIris);
eyeCol = mix(eyeCol, vec3(0.008), inPupil);
diffuseColor.rgb = eyeCol;
`;

/**
 * Shared avatar materials. Skin has a soft sheen, cloth a fabric sheen plus procedural prints,
 * hair uses physically based anisotropy along per-vertex strand tangents (angel-ring highlights),
 * and eyes are shaded analytically: iris fibers, limbal ring, pupil, wet clearcoat and a sparkle.
 */
export class AvatarMaterials {
  readonly skin: THREE.MeshPhysicalMaterial;
  readonly cloth: THREE.MeshPhysicalMaterial;
  readonly hair: THREE.MeshPhysicalMaterial;
  readonly shoe: THREE.MeshPhysicalMaterial;
  readonly dark: THREE.MeshStandardMaterial;
  readonly mouth: THREE.MeshStandardMaterial;
  readonly teeth: THREE.MeshPhysicalMaterial;
  readonly lens: THREE.MeshPhysicalMaterial;
  readonly shades: THREE.MeshPhysicalMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly plastic: THREE.MeshPhysicalMaterial;
  /** Skinned body parts in material-group order. */
  readonly list: THREE.Material[];
  /** Splat atlas for tomato splats stuck on people (null in previews without a room). */
  readonly splatAtlas: THREE.Texture | null;
  /** Adapts a material to the room light probe (held props). */
  readonly project: (m: THREE.Material) => void;
  private readonly eyes = new Map<number, THREE.MeshPhysicalMaterial>();
  private readonly all: THREE.Material[] = [];
  /** Sheen / clearcoat values of the rich look, restored by `setRichShading`. */
  private readonly rich: { m: THREE.MeshPhysicalMaterial; sheen: number; clearcoat: number }[];
  private richOn = true;

  constructor(library: MaterialLibrary | null) {
    this.splatAtlas = library?.textures.splats ?? null;
    this.project = (m) => library?.envProjection.apply(m);
    const project = (m: THREE.Material): void => {
      library?.envProjection.apply(m);
      this.all.push(m);
    };
    this.skin = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.55,
      sheen: 0.4,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(1, 0.55, 0.45),
      clearcoat: 0.08,
      clearcoatRoughness: 0.45,
    });
    this.cloth = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.86,
      sheen: 0.75,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0.45, 0.45, 0.45),
    });
    this.cloth.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PATTERN_VERT_PARS}`)
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPattern = aPattern;\nvBindPos = position;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PATTERN_FRAG_PARS}`)
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nfloat pm = patternMask(vPattern.a * 8.0, vBindPos);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vPattern.rgb, pm);',
        );
    };
    this.cloth.customProgramCacheKey = () => 'huddle-avatar-cloth';
    this.hair = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.42,
      anisotropy: 0.85,
      sheen: 0.35,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0.6, 0.55, 0.5),
      specularIntensity: 0.75,
    });
    this.shoe = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.55,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    });
    this.dark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.mouth = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#3A1214'),
      roughness: 0.6,
    });
    this.teeth = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#F4F1EA'),
      roughness: 0.3,
      clearcoat: 0.4,
    });
    this.lens = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.04,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      envMapIntensity: 1.4,
    });
    this.shades = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#1A1C22'),
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.88,
      clearcoat: 1,
    });
    this.metal = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 1,
      roughness: 0.28,
    });
    this.plastic = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.38,
      clearcoat: 0.3,
    });
    for (const m of [
      this.skin,
      this.cloth,
      this.hair,
      this.shoe,
      this.dark,
      this.mouth,
      this.teeth,
      this.lens,
      this.shades,
      this.metal,
      this.plastic,
    ])
      project(m);
    this.list = [this.skin, this.cloth, this.hair, this.shoe];
    this.rich = [this.skin, this.cloth, this.hair, this.shoe, this.plastic].map((m) => ({
      m,
      sheen: m.sheen,
      clearcoat: m.clearcoat,
    }));
  }

  /**
   * Sheen and clearcoat on the large skinned surfaces (hair keeps its anisotropic highlight, it
   * covers few pixels). Off, three.js compiles a plain PBR variant: noticeably cheaper with a room
   * full of people (low and medium tiers).
   */
  setRichShading(on: boolean): void {
    if (on === this.richOn) return;
    this.richOn = on;
    for (const r of this.rich) {
      r.m.sheen = on ? r.sheen : 0;
      r.m.clearcoat = on ? r.clearcoat : 0;
      r.m.needsUpdate = true;
    }
  }

  /** Eyeball material for an eye color index (cached; one program shared by all). */
  eye(colorIndex: number): THREE.MeshPhysicalMaterial {
    let m = this.eyes.get(colorIndex);
    if (m) return m;
    const iris = new THREE.Color(pick(EYE_COLORS, colorIndex));
    const uniforms = { uIris: { value: iris }, uPupil: { value: 0 } };
    m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEyeDir;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeDir = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEyeDir;\nuniform vec3 uIris;\nuniform float uPupil;',
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${EYE_FRAG}`)
        .replace(
          '#include <emissivemap_fragment>',
          [
            '#include <emissivemap_fragment>',
            'vec2 sp = normalize(vEyeDir).xy;',
            'float sparkle = (1.0 - smoothstep(0.07, 0.1, distance(sp, vec2(-0.2, 0.26)))) * step(0.0, vEyeDir.z);',
            'sparkle += (1.0 - smoothstep(0.03, 0.05, distance(sp, vec2(0.18, -0.16)))) * step(0.0, vEyeDir.z) * 0.6;',
            'totalEmissiveRadiance += vec3(1.2) * sparkle;',
          ].join('\n'),
        );
    };
    m.customProgramCacheKey = () => 'huddle-avatar-eye';
    this.eyes.set(colorIndex, m);
    this.all.push(m);
    return m;
  }

  dispose(): void {
    for (const m of this.all) m.dispose();
    this.eyes.clear();
  }
}
