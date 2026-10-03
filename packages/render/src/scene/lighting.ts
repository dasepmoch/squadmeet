import type { LightDef, ResolvedRoom } from '@huddle/shared';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { MaterialLibrary } from '../materials/library.ts';
import type { QualityLevel } from '../quality/presets.ts';

export type LightScene = 'meeting' | 'presentation' | 'relax' | 'party';
export const LIGHT_SCENES: readonly LightScene[] = ['meeting', 'presentation', 'relax', 'party'];

interface Levels {
  house: number;
  wash: number;
  accent: number;
  ambient: number;
  /** 0 = neutral 4000 K, 1 = warm 2700 K. */
  warmth: number;
  party: number;
}

const SCENES: Record<LightScene, Levels> = {
  meeting: { house: 1, wash: 1, accent: 1, ambient: 1, warmth: 0, party: 0 },
  presentation: { house: 0.16, wash: 0.05, accent: 0.5, ambient: 0.42, warmth: 0.15, party: 0 },
  relax: { house: 0.4, wash: 0.55, accent: 1.4, ambient: 0.72, warmth: 0.75, party: 0 },
  party: { house: 0.05, wash: 0, accent: 0.4, ambient: 0.3, warmth: 0, party: 1 },
};

const QUALITY_RANK: Record<QualityLevel, number> = { low: 0, medium: 1, high: 2, ultra: 3 };
const WARM = new THREE.Color('#FFB46B');

interface RigLight {
  def: LightDef;
  light: THREE.SpotLight | THREE.PointLight | THREE.DirectionalLight | THREE.RectAreaLight;
  baseIntensity: number;
  baseColor: THREE.Color;
  baseTarget: THREE.Vector3;
  /** Index among the lights that dance in party mode, or -1. */
  partyIndex: number;
}

export interface RoomLights {
  readonly group: THREE.Group;
  readonly scene: LightScene;
  /** 0..1 brightness of the house lighting, for scaling the captured environment. */
  readonly envLevel: number;
  setScene(scene: LightScene, instant?: boolean): void;
  setQuality(level: QualityLevel, shadowMapSize: number, softShadows: boolean): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

/** Fits an orthographic shadow frustum tightly around the room box as seen from the light. */
function fitShadowCamera(light: THREE.DirectionalLight, room: ResolvedRoom): void {
  const { min, max } = room.bounds;
  const corners: THREE.Vector3[] = [];
  for (const x of [min[0] - 0.3, max[0] + 0.3]) {
    for (const y of [-0.2, max[1] + 0.2]) {
      for (const z of [min[2] - 0.3, max[2] + 0.3]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  const view = new THREE.Matrix4().lookAt(
    light.position,
    light.target.position,
    new THREE.Vector3(0, 0, -1),
  );
  view.setPosition(light.position);
  const inv = view.clone().invert();
  const box = new THREE.Box3();
  for (const c of corners) box.expandByPoint(c.applyMatrix4(inv));
  const cam = light.shadow.camera;
  cam.left = box.min.x;
  cam.right = box.max.x;
  cam.bottom = box.min.y;
  cam.top = box.max.y;
  cam.near = Math.max(0.1, -box.max.z - 1);
  cam.far = -box.min.z + 1;
  cam.updateProjectionMatrix();
}

function createLight(
  def: LightDef,
  color: THREE.Color,
  intensity: number,
  room: ResolvedRoom,
): RigLight['light'] {
  const [x, y, z] = def.position;
  const target = def.target ?? [x, 0, z];
  switch (def.kind) {
    case 'spot': {
      const s = new THREE.SpotLight(
        color,
        intensity,
        def.distance ?? 0,
        def.angle ?? Math.PI / 4,
        def.penumbra ?? 0.6,
        2,
      );
      s.position.set(x, y, z);
      s.target.position.set(target[0], target[1], target[2]);
      return s;
    }
    case 'point': {
      const p = new THREE.PointLight(color, intensity, def.distance ?? 0, 2);
      p.position.set(x, y, z);
      return p;
    }
    case 'directional': {
      const d = new THREE.DirectionalLight(color, intensity);
      d.position.set(x, y, z);
      d.target.position.set(target[0], target[1], target[2]);
      d.shadow.bias = -0.0002;
      // Near-vertical light: use -Z as "up" so the shadow camera basis is well conditioned
      // (three orients the shadow camera with its own `up`, so fit with the same one).
      d.shadow.camera.up.set(0, 0, -1);
      fitShadowCamera(d, room);
      return d;
    }
    case 'area': {
      RectAreaLightUniformsLib.init();
      const a = new THREE.RectAreaLight(color, intensity, def.width ?? 1, def.height ?? 1);
      a.position.set(x, y, z);
      a.lookAt(target[0], target[1], target[2]);
      return a;
    }
  }
}

/**
 * The room's real-time light rig: an explicit list of spots/points plus a soft, near-vertical
 * "ceiling light field" directional light that carries the shadows. Light scenes blend role
 * levels (house / wash / accent), warm the color temperature, dim the luminaires' emissive
 * materials and, in party mode, turn the spots into moving colored beams.
 */
export function createRoomLights(
  room: ResolvedRoom,
  library: MaterialLibrary,
  resolve: (ref: string) => THREE.Color,
): RoomLights {
  const l = room.data.lighting;
  const group = new THREE.Group();
  group.name = 'lights';
  const fixtureColor = resolve(l.fixtureColor);
  const rig: RigLight[] = [];
  let partyCount = 0;
  for (const def of l.lights ?? []) {
    const color = def.color ? resolve(def.color) : fixtureColor.clone();
    const intensity = def.intensity * l.fixtureIntensity;
    const light = createLight(def, color, intensity, room);
    light.name = `light:${def.id}`;
    const target =
      'target' in light && light.target instanceof THREE.Object3D ? light.target : null;
    group.add(light);
    if (target) group.add(target);
    const dances = def.kind === 'spot' && def.role !== 'accent';
    rig.push({
      def,
      light,
      baseIntensity: intensity,
      baseColor: color.clone(),
      baseTarget: target ? target.position.clone() : new THREE.Vector3(),
      partyIndex: dances ? partyCount++ : -1,
    });
  }
  const ambientColor = resolve(l.ambientColor);
  const hemi = new THREE.HemisphereLight(
    ambientColor,
    ambientColor.clone().multiplyScalar(0.45),
    l.ambientIntensity,
  );
  group.add(hemi);

  const fixture = library.get('fixture') as THREE.MeshBasicMaterial;
  const lamp = library.get('lamp') as THREE.MeshBasicMaterial;
  const cove = library.get('additive') as THREE.MeshBasicMaterial;
  let sceneName: LightScene = 'meeting';
  const target: Levels = { ...SCENES.meeting };
  const cur: Levels = { ...SCENES.meeting };
  const tmp = new THREE.Color();
  const partyColor = new THREE.Color();
  let envLevel = 1;
  let dirty = false;

  const apply = (time: number): void => {
    for (const r of rig) {
      const role =
        r.def.role === 'house' ? cur.house : r.def.role === 'wash' ? cur.wash : cur.accent;
      tmp.copy(r.baseColor).lerp(WARM, cur.warmth * 0.45);
      let intensity = r.baseIntensity * role;
      if (r.partyIndex >= 0 && cur.party > 0.001) {
        partyColor.setHSL((time * 0.11 + r.partyIndex * 0.29) % 1, 1, 0.55);
        tmp.lerp(partyColor, cur.party);
        intensity += r.baseIntensity * 1.1 * cur.party;
        if (r.light instanceof THREE.SpotLight) {
          const a = time * (0.7 + r.partyIndex * 0.13) + r.partyIndex * 1.7;
          r.light.target.position.set(
            r.baseTarget.x + Math.cos(a) * 1.6 * cur.party,
            r.baseTarget.y,
            r.baseTarget.z + Math.sin(a * 1.3) * 1.6 * cur.party,
          );
        }
      } else if (r.light instanceof THREE.SpotLight) {
        r.light.target.position.copy(r.baseTarget);
      }
      r.light.intensity = intensity;
      r.light.color.copy(tmp);
    }
    hemi.intensity = l.ambientIntensity * cur.ambient;
    const house = Math.max(cur.house, cur.wash * 0.8);
    fixture.color.setScalar(house).lerp(tmp.copy(WARM).multiplyScalar(house), cur.warmth * 0.35);
    if (cur.party > 0.001) {
      partyColor.setHSL((time * 0.08) % 1, 0.9, 0.5).multiplyScalar(1.4);
      fixture.color.lerp(partyColor, cur.party);
    }
    lamp.color
      .setScalar(Math.min(1.3, cur.accent))
      .lerp(tmp.copy(WARM).multiplyScalar(cur.accent), cur.warmth * 0.2);
    cove.color.setScalar(Math.max(0.12, house));
    if (cur.party > 0.001) {
      partyColor.setHSL((time * 0.08 + 0.5) % 1, 1, 0.5).multiplyScalar(2.2);
      cove.color.lerp(partyColor, cur.party);
    }
    envLevel = 0.18 + 0.82 * Math.min(1, house * 0.85 + cur.accent * 0.15);
  };
  apply(0);

  return {
    group,
    get scene() {
      return sceneName;
    },
    get envLevel() {
      return envLevel;
    },
    setScene(scene, instant = false) {
      sceneName = scene;
      Object.assign(target, SCENES[scene]);
      if (instant) Object.assign(cur, target);
      dirty = true;
    },
    setQuality(level, shadowMapSize, soft) {
      const rank = QUALITY_RANK[level];
      for (const r of rig) {
        r.light.visible = QUALITY_RANK[r.def.minQuality ?? 'low'] <= rank;
        if (!(r.light instanceof THREE.DirectionalLight || r.light instanceof THREE.SpotLight))
          continue;
        const cast = r.def.castShadow === true;
        r.light.castShadow = cast;
        if (!cast) continue;
        const shadow = r.light.shadow;
        if (shadow.mapSize.x !== shadowMapSize) {
          shadow.mapSize.set(shadowMapSize, shadowMapSize);
          shadow.map?.dispose();
          shadow.map = null;
        }
        // Soft penumbrae: large PCF radius mimics the many-source ceiling grid.
        shadow.radius = soft ? 7 : level === 'low' ? 2 : 4.5;
        shadow.normalBias = 0.012 * (4096 / shadowMapSize) * 0.6 + 0.01;
      }
    },
    update(dt, time) {
      const k = 1 - Math.exp(-dt * 3.2);
      let moving = false;
      for (const key of Object.keys(cur) as (keyof Levels)[]) {
        const d = target[key] - cur[key];
        if (Math.abs(d) > 1e-4) moving = true;
        cur[key] += d * k;
      }
      if (moving || dirty || cur.party > 0.001) apply(time);
      dirty = false;
    },
    dispose() {
      for (const r of rig) {
        if ('shadow' in r.light) r.light.shadow.map?.dispose();
        r.light.dispose();
      }
      hemi.dispose();
    },
  };
}

/**
 * Uniform "grey room" probe of the same PMREM size as the real capture. Materials compiled
 * against it use the exact shader variants of the final room probe, so the capture passes and
 * the first frame reuse one set of programs (shader compilation is the slow part).
 */
export function createSeedEnvironment(
  renderer: THREE.WebGLRenderer,
  color: THREE.Color,
  size: number,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }),
  );
  scene.add(box);
  const target = pmrem.fromScene(scene, 0, 0.1, 50, { size });
  box.geometry.dispose();
  box.material.dispose();
  pmrem.dispose();
  return target;
}

/**
 * Captures the lit room into a prefiltered (PMREM) light probe for image-based lighting. Two
 * passes: the first is lit by `seed`, the second by the first, approximating an extra bounce.
 */
export function captureRoomEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  probe: THREE.Vector3,
  size: number,
  seed: THREE.Texture | null,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const previous = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  scene.environment = seed;
  scene.environmentIntensity = 1;
  const first = pmrem.fromScene(scene, 0, 0.05, 60, { size, position: probe });
  scene.environment = first.texture;
  const second = pmrem.fromScene(scene, 0, 0.05, 60, { size, position: probe });
  first.dispose();
  scene.environment = previous;
  scene.environmentIntensity = previousIntensity;
  pmrem.dispose();
  return second;
}
