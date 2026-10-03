import * as THREE from 'three';

/**
 * Box-projected (parallax-corrected) environment reflections. The room light probe is captured
 * from one point; without correction every glossy surface would reflect the room as if it stood
 * at that point. Projecting the reflection ray onto the room box makes reflections of the ceiling
 * fixtures, walls and screen line up with the real geometry, which sells interiors.
 */
export class EnvProjection {
  readonly uniforms = {
    uEnvBoxMin: { value: new THREE.Vector3(-8, 0, -6) },
    uEnvBoxMax: { value: new THREE.Vector3(8, 3, 6) },
    uEnvProbe: { value: new THREE.Vector3(0, 1.6, 0) },
    uEnvBoxOn: { value: 0 },
  };

  setBox(min: THREE.Vector3, max: THREE.Vector3, probe: THREE.Vector3): void {
    this.uniforms.uEnvBoxMin.value.copy(min);
    this.uniforms.uEnvBoxMax.value.copy(max);
    this.uniforms.uEnvProbe.value.copy(probe);
    this.uniforms.uEnvBoxOn.value = 1;
  }

  disable(): void {
    this.uniforms.uEnvBoxOn.value = 0;
  }

  /** Patches a standard/physical material. Chains any existing `onBeforeCompile`. */
  apply(material: THREE.Material): void {
    const previous = material.onBeforeCompile.bind(material);
    const previousKey = material.customProgramCacheKey.bind(material);
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\n#ifdef USE_ENVMAP\nvarying vec3 vEnvWorldPos;\n#endif',
        )
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n#ifdef USE_ENVMAP\nvEnvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BOX_PARS}`)
        .replace('#include <envmap_physical_pars_fragment>', PATCHED_ENV_CHUNK);
    };
    material.customProgramCacheKey = () => `${previousKey()}|boxenv`;
    material.needsUpdate = true;
  }
}

const BOX_PARS = /* glsl */ `
#ifdef USE_ENVMAP
varying vec3 vEnvWorldPos;
uniform vec3 uEnvBoxMin;
uniform vec3 uEnvBoxMax;
uniform vec3 uEnvProbe;
uniform float uEnvBoxOn;
vec3 boxProjectDir(vec3 dir) {
  vec3 p = clamp(vEnvWorldPos, uEnvBoxMin + 0.02, uEnvBoxMax - 0.02);
  vec3 d = dir + vec3(1e-6);
  vec3 t = max((uEnvBoxMax - p) / d, (uEnvBoxMin - p) / d);
  float dist = min(min(t.x, t.y), t.z);
  vec3 hit = p + d * dist;
  return normalize(mix(dir, hit - uEnvProbe, uEnvBoxOn));
}
#endif
`;

const PATCHED_ENV_CHUNK = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
  'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
  'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\n\t\t\treflectVec = boxProjectDir( reflectVec );',
);
