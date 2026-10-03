import type { HeldItem } from '@huddle/shared';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { layoutStrokeText } from '../geometry/stroke-font.ts';
import { createThrowableModels, type ThrowableModels } from '../scene/throwable-models.ts';

/** Everything a hand can show: held items and the mop of a clean-up. */
export type PropModelKind = HeldItem | 'mop';

/** The big glyph on each sign and its ink color. */
const SIGNS: Record<string, { text: string; ink: string }> = {
  signPlus: { text: '+1', ink: '#2E9E5B' },
  signAsk: { text: '?', ink: '#2F5BFF' },
  signBrb: { text: 'BRB', ink: '#FF7A1A' },
  signLove: { text: '', ink: '#FF3B6B' },
};

export interface HeldModels {
  /**
   * A fresh object for one hand (geometry and materials are shared). Origin at the grip, +Y up,
   * +Z away from the holder; the pizza's edible part is the child named `bite`.
   */
  create(kind: PropModelKind): THREE.Object3D;
  dispose(): void;
}

/** Thick strokes of single-stroke glyphs as one flat geometry, centered, `height` tall. */
function strokeGlyphs(text: string, height: number, maxWidth: number): THREE.BufferGeometry {
  const { lines, width } = layoutStrokeText(text);
  const s = Math.min(height / 6, maxWidth / Math.max(1, width));
  const thick = s * 1.15;
  const parts: THREE.BufferGeometry[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i] as [number, number];
      const cx = (x - width / 2) * s;
      const cy = (y - 3) * s;
      const dot = new THREE.CylinderGeometry(thick / 2, thick / 2, 0.003, 12);
      dot.rotateX(Math.PI / 2);
      dot.translate(cx, cy, 0);
      parts.push(dot);
      const next = line[i + 1];
      if (!next) continue;
      const nx = (next[0] - width / 2) * s;
      const ny = (next[1] - 3) * s;
      const len = Math.hypot(nx - cx, ny - cy);
      const bar = new THREE.BoxGeometry(len, thick, 0.003);
      bar.rotateZ(Math.atan2(ny - cy, nx - cx));
      bar.translate((cx + nx) / 2, (cy + ny) / 2, 0);
      parts.push(bar);
    }
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('sign glyph merge failed');
  return merged;
}

function gradientPlane(w: number, h: number, top: string, bottom: string): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const a = new THREE.Color(top);
  const b = new THREE.Color(bottom);
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(b).lerp(a, pos.getY(i) / h + 0.5);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/** Builds the procedural hand-held models once; `project` adapts materials to the room probe. */
export function createHeldModels(
  project: (m: THREE.Material) => void = () => undefined,
): HeldModels {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const mat = <T extends THREE.Material>(m: T): T => {
    project(m);
    materials.push(m);
    return m;
  };
  const ceramic = mat(
    new THREE.MeshPhysicalMaterial({
      color: '#F3EFE7',
      roughness: 0.32,
      clearcoat: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  const coffee = mat(new THREE.MeshStandardMaterial({ color: '#3B2416', roughness: 0.2 }));
  const glass = mat(
    new THREE.MeshPhysicalMaterial({
      color: '#EAF6FF',
      roughness: 0.05,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const water = mat(
    new THREE.MeshPhysicalMaterial({
      color: '#8FD3FF',
      roughness: 0.05,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const cheese = mat(new THREE.MeshStandardMaterial({ color: '#F2B33D', roughness: 0.55 }));
  const crust = mat(new THREE.MeshStandardMaterial({ color: '#C9833A', roughness: 0.75 }));
  const pepperoni = mat(new THREE.MeshStandardMaterial({ color: '#B3261E', roughness: 0.45 }));
  const phoneBody = mat(
    new THREE.MeshPhysicalMaterial({ color: '#15161A', roughness: 0.25, clearcoat: 1 }),
  );
  const screen = new THREE.MeshBasicMaterial({ vertexColors: true });
  materials.push(screen);
  const board = mat(new THREE.MeshStandardMaterial({ color: '#FAF8F2', roughness: 0.7 }));
  const wood = mat(new THREE.MeshStandardMaterial({ color: '#B88A5A', roughness: 0.6 }));
  const aluminum = mat(
    new THREE.MeshStandardMaterial({ color: '#C9CED6', metalness: 0.9, roughness: 0.3 }),
  );
  const mopHead = mat(new THREE.MeshStandardMaterial({ color: '#2F5BFF', roughness: 0.6 }));
  const yarn = mat(new THREE.MeshStandardMaterial({ color: '#ECE8DD', roughness: 0.95 }));
  let throwables: ThrowableModels | null = null;

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = false): THREE.Mesh => {
    const out = new THREE.Mesh(g, m);
    out.castShadow = cast;
    return out;
  };

  // Mug: cup in front of the fingers, handle toward the hand.
  const mugWall = geo(new THREE.CylinderGeometry(0.036, 0.032, 0.09, 20, 1, true));
  const mugBottom = geo(new THREE.CircleGeometry(0.032, 20).rotateX(Math.PI / 2));
  const mugHandle = geo(new THREE.TorusGeometry(0.022, 0.0065, 8, 16, Math.PI * 1.2));
  const mugTop = geo(new THREE.CircleGeometry(0.033, 20).rotateX(-Math.PI / 2));
  // Water: a clear cup, two thirds full.
  const cupWall = geo(new THREE.CylinderGeometry(0.034, 0.027, 0.095, 20, 1, true));
  const cupWater = geo(new THREE.CylinderGeometry(0.031, 0.027, 0.062, 20));
  // Pizza: a slice, tip forward, crust at the hand.
  const sliceShape = new THREE.Shape();
  sliceShape.moveTo(0, 0.15);
  sliceShape.lineTo(-0.066, 0.004);
  sliceShape.quadraticCurveTo(0, -0.016, 0.066, 0.004);
  sliceShape.lineTo(0, 0.15);
  const slice = geo(
    new THREE.ExtrudeGeometry(sliceShape, { depth: 0.006, bevelEnabled: false })
      .rotateX(Math.PI / 2)
      .translate(0, 0.006, 0),
  );
  const crustBar = geo(new THREE.CylinderGeometry(0.011, 0.011, 0.142, 10).rotateZ(Math.PI / 2));
  const salami = geo(new THREE.CylinderGeometry(0.013, 0.013, 0.003, 14));
  // Phone: screen toward the holder (-Z).
  const phoneSlab = geo(new THREE.BoxGeometry(0.072, 0.15, 0.009));
  const phoneScreen = geo(gradientPlane(0.066, 0.142, '#7FB2FF', '#B48CFF').rotateY(Math.PI));
  // Signs: a board on a stick, glyph on the front.
  const stick = geo(new THREE.CylinderGeometry(0.0075, 0.0075, 0.36, 10));
  const signBoard = geo(new THREE.BoxGeometry(0.3, 0.21, 0.01));
  const glyphs = new Map<string, THREE.BufferGeometry>();
  // Mop: handle down from the right hand, head on the floor ahead.
  const mopHandle = geo(new THREE.CylinderGeometry(0.011, 0.011, 1.3, 10));
  const mopBlock = geo(new THREE.BoxGeometry(0.32, 0.03, 0.09));
  const mopStrands = geo(new THREE.BoxGeometry(0.33, 0.045, 0.1));

  const glyph = (kind: string): THREE.BufferGeometry => {
    let g = glyphs.get(kind);
    if (!g) {
      const def = SIGNS[kind];
      throwables ??= createThrowableModels();
      g =
        def && def.text
          ? strokeGlyphs(def.text, 0.13, 0.24)
          : throwables.heartGeometry.clone().scale(1.9, 1.9, 0.25);
      glyphs.set(kind, geo(g));
    }
    return g;
  };
  const inks = new Map<string, THREE.Material>();
  const ink = (hex: string): THREE.Material => {
    let m = inks.get(hex);
    if (!m) {
      m = mat(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5 }));
      inks.set(hex, m);
    }
    return m;
  };

  const builders: Record<PropModelKind, () => THREE.Object3D> = {
    mug: () => {
      const g = new THREE.Group();
      const cup = new THREE.Group();
      const handle = mesh(mugHandle, ceramic);
      handle.position.set(0.036, 0.004, 0);
      handle.rotation.z = -Math.PI * 0.6;
      const bottom = mesh(mugBottom, ceramic);
      bottom.position.y = -0.045;
      const top = mesh(mugTop, coffee);
      top.position.y = 0.03;
      cup.add(mesh(mugWall, ceramic), bottom, handle, top);
      cup.position.set(-0.03, 0.025, 0.03);
      g.add(cup);
      return g;
    },
    water: () => {
      const g = new THREE.Group();
      const cup = new THREE.Group();
      const w = mesh(cupWater, water);
      w.position.y = -0.016;
      w.renderOrder = 2;
      const wall = mesh(cupWall, glass);
      wall.renderOrder = 3;
      cup.add(w, wall);
      cup.position.set(-0.03, 0.03, 0.03);
      g.add(cup);
      return g;
    },
    pizza: () => {
      const g = new THREE.Group();
      const bite = new THREE.Group();
      bite.name = 'bite';
      bite.add(mesh(slice, cheese));
      for (const [x, z] of [
        [0, 0.075],
        [-0.026, 0.03],
        [0.025, 0.035],
      ] as const) {
        const s = mesh(salami, pepperoni);
        s.position.set(x, 0.0075, z);
        bite.add(s);
      }
      const edge = mesh(crustBar, crust);
      edge.position.set(0, 0.006, -0.004);
      g.add(bite, edge);
      g.position.set(0, 0, 0.01);
      const root = new THREE.Group();
      root.add(g);
      return root;
    },
    phone: () => {
      const g = new THREE.Group();
      const body = mesh(phoneSlab, phoneBody);
      const face = mesh(phoneScreen, screen);
      face.position.z = -0.0047;
      body.add(face);
      body.position.set(-0.012, 0.035, 0.012);
      g.add(body);
      return g;
    },
    plane: () => {
      throwables ??= createThrowableModels();
      const g = new THREE.Group();
      const plane = throwables.create('plane');
      plane.position.set(0, 0.02, 0.05);
      g.add(plane);
      return g;
    },
    signPlus: () => sign('signPlus'),
    signAsk: () => sign('signAsk'),
    signBrb: () => sign('signBrb'),
    signLove: () => sign('signLove'),
    mop: () => {
      const g = new THREE.Group();
      const handle = mesh(mopHandle, aluminum, true);
      handle.position.y = -0.4;
      const block = mesh(mopBlock, mopHead, true);
      block.position.y = -1.05;
      const strands = mesh(mopStrands, yarn, true);
      strands.position.y = -1.085;
      g.add(handle, block, strands);
      return g;
    },
  };

  function sign(kind: string): THREE.Object3D {
    const def = SIGNS[kind] ?? { text: '?', ink: '#2F5BFF' };
    const g = new THREE.Group();
    const s = mesh(stick, wood, true);
    s.position.y = 0.12;
    const b = mesh(signBoard, board, true);
    b.position.y = 0.39;
    const front = mesh(glyph(kind), ink(def.ink));
    front.position.set(0, 0.39, 0.0068);
    g.add(s, b, front);
    return g;
  }

  return {
    create: (kind) => {
      const o = builders[kind]();
      o.name = `held:${kind}`;
      return o;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      throwables?.dispose();
    },
  };
}
