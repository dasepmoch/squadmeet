import type { Vec3 } from '@huddle/shared';
import * as THREE from 'three';
import { growCurve, SPLAT_INK_GLSL, splatAtlasUv } from '../scene/decals.ts';
import type { ProceduralAvatar } from './procedural-avatar.ts';

const INKS = ['#C8231A', '#D93A22', '#B81C1C'].map((h) => new THREE.Color(h));
/** On clothes a splat stays a while; on the face it is wiped off right after the flinch. */
const BODY_LIFE = 25;
const BODY_FADE = 1.2;
const FACE_LIFE = 1.75;
const FACE_FADE = 0.4;
const SWEEP_FADE = 0.4;
const GROW = 0.14;
const PER_PERSON = 3;
const MAX_SPLATS = 30;

interface Splat {
  playerId: string;
  mesh: THREE.Mesh;
  colors: THREE.BufferAttribute;
  bornAt: number;
  life: number;
  fade: number;
  size: number;
}

const local = new THREE.Vector3();
const dir = new THREE.Vector3();
const n = new THREE.Vector3();
const q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * A quad bent around a body of radius `bend` (wraps the chest or the face instead of sticking
 * out flat), with UVs inside one atlas cell and white RGBA vertex colors (tint and fade).
 */
function bentQuad(
  bend: number,
  vertical: number,
  cell: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 6, 6);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const atlas = new Float32Array(uv.count * 2);
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // A unit quad scaled to the splat size later: `bend` is size / (2 * surface radius), so the
    // edges sag back by exactly the surface's curvature.
    pos.setXYZ(i, x, y, -(x * x + y * y * vertical) * bend);
    const [u, v] = splatAtlasUv(uv.getX(i), uv.getY(i), cell);
    atlas[i * 2] = u;
    atlas[i * 2 + 1] = v;
    colors.set([color.r, color.g, color.b, 1], i * 4);
  }
  g.setAttribute('aSplatUv', new THREE.BufferAttribute(atlas, 2));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  g.computeVertexNormals();
  return g;
}

/**
 * Tomato splats stuck on people: small bent quads parented to the chest or head bone, so they
 * move with the body. Face splats are wiped off by the flinch; shirt splats stay for a while.
 */
export class AvatarSplats {
  private readonly material: THREE.MeshStandardMaterial;
  private readonly live: Splat[] = [];

  constructor(atlas: THREE.Texture) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uSplats = { value: atlas };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 aSplatUv;\nvarying vec2 vSplatUv;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplatUv = aSplatUv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D uSplats;\nvarying vec2 vSplatUv;',
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>\nvec2 atlasUv = vSplatUv;\n${SPLAT_INK_GLSL}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.16, 0.42, splat.g);',
        );
    };
    this.material.customProgramCacheKey = () => 'huddle-avatar-splat';
  }

  get count(): number {
    return this.live.length;
  }

  /**
   * A tomato burst on someone at world `point`, coming from horizontal direction `normal` (from
   * their center out to the impact). Lands on the face above the chin, else on the shirt.
   */
  add(playerId: string, avatar: ProceduralAvatar, point: Vec3, normal: Vec3, time: number): void {
    const a = avatar.anchors;
    const head = avatar.bone('head');
    head.updateWorldMatrix(true, false);
    local.set(point.x, point.y, point.z);
    head.worldToLocal(local);
    const headJoint = avatar.bindJoint('head', new THREE.Vector3());
    const face = local.y > a.mouth[1] - headJoint.y - 0.04;
    const bone = face ? head : avatar.bone('chest');
    const joint = face ? headJoint : avatar.bindJoint('chest', new THREE.Vector3());
    if (!face) {
      local.set(point.x, point.y, point.z);
      bone.worldToLocal(local);
    }
    // The impact direction in the bone's frame (bones are unrotated in the bind pose).
    bone.getWorldQuaternion(q).invert();
    dir.set(normal.x, 0, normal.z).applyQuaternion(q);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // Body cross-section as an ellipse around the bone: face from the ears to the nose bridge,
    // torso from the chest front.
    let ax: number;
    let az: number;
    let cz: number;
    let y: number;
    if (face) {
      cz = a.earL[2] - joint.z;
      ax = Math.abs(a.earL[0]) * 0.9;
      az = Math.max(0.06, a.noseBridge[2] - a.earL[2] - 0.012);
      y = THREE.MathUtils.clamp(local.y, a.mouth[1] - joint.y, a.browL[1] - joint.y);
    } else {
      cz = 0;
      az = Math.max(0.08, a.chest[2] - joint.z);
      ax = az * 1.45;
      y = THREE.MathUtils.clamp(
        local.y,
        a.buttonFront[1] - joint.y + 0.02,
        a.collarFront[1] - joint.y - 0.03,
      );
    }
    const r = 1 / Math.hypot(dir.x / ax, dir.z / az);
    const px = dir.x * r;
    const pz = dir.z * r;
    n.set(px / (ax * ax), 0, pz / (az * az)).normalize();
    this.makeRoom(playerId);
    const size = face ? 0.11 + Math.random() * 0.04 : 0.16 + Math.random() * 0.06;
    const ink = INKS[Math.floor(Math.random() * INKS.length)] as THREE.Color;
    const radius = 0.6 * (ax + az);
    const cell = Math.floor(Math.random() * 16);
    const geometry = bentQuad(size / (2 * radius), face ? 0.8 : 0.25, cell, ink);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = 'avatar-splat';
    mesh.renderOrder = 2;
    mesh.position.set(px, y, pz + cz).addScaledVector(n, 0.006);
    mesh.quaternion.setFromUnitVectors(Z, n);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(size * growCurve(0));
    bone.add(mesh);
    this.live.push({
      playerId,
      mesh,
      colors: geometry.getAttribute('color') as THREE.BufferAttribute,
      bornAt: time,
      life: face ? FACE_LIFE : BODY_LIFE,
      fade: face ? FACE_FADE : BODY_FADE,
      size,
    });
  }

  update(time: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i] as Splat;
      const age = time - s.bornAt;
      if (age < GROW + 0.05) s.mesh.scale.setScalar(s.size * growCurve(age / GROW));
      if (age < s.life) continue;
      const o = 1 - (age - s.life) / s.fade;
      if (o <= 0) {
        this.remove(i);
        continue;
      }
      for (let v = 0; v < s.colors.count; v++) s.colors.setW(v, o);
      s.colors.needsUpdate = true;
    }
  }

  /** The mop: every splat fades away quickly. */
  sweep(time: number): void {
    for (const s of this.live) {
      const age = time - s.bornAt;
      if (age < s.life) s.life = age;
      s.fade = Math.min(s.fade, SWEEP_FADE);
    }
  }

  /** Someone's avatar was rebuilt or left: their splats go with it. */
  drop(playerId: string): void {
    for (let i = this.live.length - 1; i >= 0; i--)
      if ((this.live[i] as Splat).playerId === playerId) this.remove(i);
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.remove(i);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }

  private makeRoom(playerId: string): void {
    const mine = this.live.filter((s) => s.playerId === playerId);
    if (mine.length >= PER_PERSON) this.remove(this.live.indexOf(mine[0] as Splat));
    if (this.live.length >= MAX_SPLATS) this.remove(0);
  }

  private remove(index: number): void {
    const [s] = this.live.splice(index, 1);
    if (!s) return;
    s.mesh.removeFromParent();
    s.mesh.geometry.dispose();
  }
}
