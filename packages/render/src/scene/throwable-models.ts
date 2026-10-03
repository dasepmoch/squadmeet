import type { ThrowKind } from '@huddle/engine';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Visual size multiplier over the physics body, so small objects read from across the room. */
export const VISUAL_SCALE = 1.35;

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Crumpled paper: a faceted, randomly dented icosphere. */
function crumpledPaper(): THREE.BufferGeometry {
  // Polyhedron geometries are non-indexed already: every face owns its vertices (faceted look).
  const g = new THREE.IcosahedronGeometry(0.045, 2);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const moved = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let k = moved.get(key);
    if (k === undefined) {
      k = 0.72 + hash3(v.x * 40, v.y * 40, v.z * 40) * 0.5;
      moved.set(key, k);
    }
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Classic dart-style paper plane, nose along +Z (the projectile aligns +Z with its velocity). */
function paperPlane(): THREE.BufferGeometry {
  const N = [0, 0, 0.11];
  const T = [0, 0, -0.11];
  const L = [-0.065, 0.014, -0.1];
  const R = [0.065, 0.014, -0.1];
  const K = [0, -0.024, -0.1];
  const tri = (a: number[], b: number[], c: number[]): number[] => [...a, ...b, ...c];
  const positions = new Float32Array([...tri(N, L, T), ...tri(N, T, R), ...tri(N, T, K)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** A plump tomato with a green calyx and stem. */
function tomato(): { body: THREE.BufferGeometry; calyx: THREE.BufferGeometry } {
  const body = new THREE.SphereGeometry(0.043, 22, 16);
  const p = body.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Squashed with shallow lobes around the stem.
    const lobes = 1 + Math.cos(Math.atan2(v.z, v.x) * 5) * 0.035 * (1 - Math.abs(v.y) / 0.043);
    p.setXYZ(i, v.x * lobes, v.y * 0.84, v.z * lobes);
  }
  body.computeVertexNormals();
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.ConeGeometry(0.008, 0.03, 4, 1);
    leaf.rotateZ(-Math.PI / 2 + 0.25);
    leaf.translate(0.014, 0.036, 0);
    leaf.rotateY((i / 5) * Math.PI * 2);
    leaves.push(leaf);
  }
  const stem = new THREE.CylinderGeometry(0.003, 0.004, 0.016, 6);
  stem.translate(0, 0.044, 0);
  leaves.push(stem);
  const calyx = mergeGeometries(leaves.map((g) => g.toNonIndexed()));
  if (!calyx) throw new Error('calyx merge failed');
  return { body, calyx };
}

/** Rubber duck: body, head, beak, eyes and a perky tail. */
function duck(): {
  body: THREE.BufferGeometry;
  beak: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
} {
  const body = new THREE.SphereGeometry(0.052, 20, 14);
  body.scale(1, 0.78, 1.22);
  body.translate(0, -0.012, -0.006);
  const head = new THREE.SphereGeometry(0.032, 18, 12);
  head.translate(0, 0.036, 0.03);
  const tail = new THREE.ConeGeometry(0.018, 0.04, 10);
  tail.rotateX(-0.9);
  tail.translate(0, 0.016, -0.066);
  const merged = mergeGeometries([body, head, tail].map((g) => g.toNonIndexed()));
  if (!merged) throw new Error('duck merge failed');
  const beak = new THREE.SphereGeometry(0.016, 12, 8);
  beak.scale(1.1, 0.42, 1.25);
  beak.translate(0, 0.031, 0.064);
  const eyeL = new THREE.SphereGeometry(0.0055, 8, 6);
  eyeL.translate(-0.016, 0.045, 0.054);
  const eyeR = eyeL.clone();
  eyeR.translate(0.032, 0, 0);
  const eyes = mergeGeometries([eyeL, eyeR]);
  if (!eyes) throw new Error('eyes merge failed');
  return { body: merged, beak, eyes };
}

/** Party popper: a striped cone with a shiny gold cap. */
function popper(): { cone: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const cone = new THREE.ConeGeometry(0.03, 0.085, 18, 6, true);
  cone.rotateX(Math.PI);
  const colors: number[] = [];
  const stripes = ['#FF2E93', '#FFD21F', '#2F5BFF', '#B6FF2E', '#FF5A1F', '#7B3CFF'].map(
    (h) => new THREE.Color(h),
  );
  const p = cone.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const band = Math.floor((y + 0.0425) * 70 + a * 1.2);
    const c = stripes[((band % stripes.length) + stripes.length) % stripes.length] as THREE.Color;
    colors.push(c.r, c.g, c.b);
  }
  cone.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const cap = new THREE.CylinderGeometry(0.031, 0.031, 0.008, 18);
  cap.translate(0, 0.0445, 0);
  return { cone, cap };
}

/** A puffy extruded heart, centered. */
function heart(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.036);
  s.bezierCurveTo(-0.012, -0.024, -0.05, -0.004, -0.05, 0.02);
  s.bezierCurveTo(-0.05, 0.042, -0.028, 0.052, -0.014, 0.046);
  s.bezierCurveTo(-0.006, 0.043, 0, 0.034, 0, 0.03);
  s.bezierCurveTo(0, 0.034, 0.006, 0.043, 0.014, 0.046);
  s.bezierCurveTo(0.028, 0.052, 0.05, 0.042, 0.05, 0.02);
  s.bezierCurveTo(0.05, -0.004, 0.012, -0.024, 0, -0.036);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.009,
    bevelSize: 0.007,
    bevelSegments: 4,
    curveSegments: 10,
  });
  g.center();
  return g;
}

export interface ThrowableModels {
  /** A fresh object for one projectile (geometry and materials are shared). */
  create(kind: ThrowKind): THREE.Object3D;
  /** Shape geometry reused by particles (hearts, paper bits). */
  readonly heartGeometry: THREE.BufferGeometry;
  dispose(): void;
}

/** Builds the procedural models of every throwable once. */
export function createThrowableModels(): ThrowableModels {
  const paperMat = new THREE.MeshStandardMaterial({
    color: '#F5F2EA',
    roughness: 0.86,
    flatShading: true,
  });
  const planeMat = new THREE.MeshStandardMaterial({
    color: '#FBFAF6',
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const tomatoMat = new THREE.MeshPhysicalMaterial({
    color: '#E1301C',
    roughness: 0.26,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3F8C2A', roughness: 0.6 });
  const duckMat = new THREE.MeshPhysicalMaterial({
    color: '#FFD21F',
    roughness: 0.34,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });
  const beakMat = new THREE.MeshStandardMaterial({ color: '#FF7A1A', roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#15151C', roughness: 0.15 });
  const popperMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: '#F2C14E',
    metalness: 0.9,
    roughness: 0.25,
  });
  const heartMat = new THREE.MeshPhysicalMaterial({
    color: '#FF3B6B',
    emissive: '#FF2E63',
    emissiveIntensity: 0.45,
    roughness: 0.25,
    clearcoat: 0.8,
  });
  const paper = crumpledPaper();
  const plane = paperPlane();
  const tom = tomato();
  const dk = duck();
  const pop = popper();
  const hrt = heart();
  const geometries = [
    paper,
    plane,
    tom.body,
    tom.calyx,
    dk.body,
    dk.beak,
    dk.eyes,
    pop.cone,
    pop.cap,
    hrt,
  ];
  const materials = [
    paperMat,
    planeMat,
    tomatoMat,
    leafMat,
    duckMat,
    beakMat,
    eyeMat,
    popperMat,
    goldMat,
    heartMat,
  ];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const out = new THREE.Mesh(g, m);
    out.castShadow = true;
    out.receiveShadow = true;
    return out;
  };
  const builders: Record<ThrowKind, () => THREE.Object3D> = {
    paper: () => mesh(paper, paperMat),
    plane: () => mesh(plane, planeMat),
    tomato: () => new THREE.Group().add(mesh(tom.body, tomatoMat), mesh(tom.calyx, leafMat)),
    duck: () =>
      new THREE.Group().add(mesh(dk.body, duckMat), mesh(dk.beak, beakMat), mesh(dk.eyes, eyeMat)),
    confetti: () => new THREE.Group().add(mesh(pop.cone, popperMat), mesh(pop.cap, goldMat)),
    heart: () => mesh(hrt, heartMat),
  };
  return {
    heartGeometry: hrt,
    create(kind) {
      const root = new THREE.Group();
      root.name = `throwable:${kind}`;
      const model = builders[kind]();
      model.scale.setScalar(VISUAL_SCALE);
      root.add(model);
      return root;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
