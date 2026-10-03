import type { AvatarSpec } from '@huddle/shared';
import * as THREE from 'three';
import type { AvatarMaterials } from './avatar-materials.ts';
import { CLOTH_COLORS, pick } from './avatar-palette.ts';
import { colorGeometry, taperedTube, type RigidPart } from './face-parts.ts';
import type { BoneName } from './rig.ts';
import type { AvatarMeshData, FaceAnchors } from './sculpt/character.ts';

type Joint = (b: BoneName) => readonly number[];

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function rel(world: THREE.Vector3, joint: readonly number[]): THREE.Vector3 {
  return world.clone().sub(V(joint[0] ?? 0, joint[1] ?? 0, joint[2] ?? 0));
}

function tube(
  points: THREE.Vector3[],
  radius: number,
  color: string,
  closed = false,
  segments = 32,
): THREE.BufferGeometry {
  return colorGeometry(taperedTube(points, [radius, radius], segments, 6, closed), color);
}

/** Lens outlines per style (half-width w, half-height h, in meters, centered at the eye). */
function lensOutline(style: number, w: number, h: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x: number;
    let y: number;
    if (style === 1) {
      x = c * w;
      y = s * w;
    } else if (style === 2 || style === 5) {
      // Rounded rectangle (superellipse).
      x = Math.sign(c) * Math.pow(Math.abs(c), 0.45) * w;
      y = Math.sign(s) * Math.pow(Math.abs(s), 0.45) * h;
    } else if (style === 3) {
      // Cat-eye: outer top corner swept up.
      x = Math.sign(c) * Math.pow(Math.abs(c), 0.55) * w;
      y = Math.sign(s) * Math.pow(Math.abs(s), 0.6) * h + (c > 0 && s > 0 ? c * s * h * 0.9 : 0);
    } else {
      // Aviator teardrop.
      x = c * w;
      y = s > 0 ? s * h * 0.85 : s * h * (1.25 - c * 0.35);
    }
    pts.push(V(x, y, 0));
  }
  return pts;
}

function glasses(
  a: FaceAnchors,
  spec: AvatarSpec,
  mats: AvatarMaterials,
  joint: Joint,
): RigidPart | null {
  const style = spec.glasses;
  if (style === 0) return null;
  const k = a.headScale;
  const root = new THREE.Group();
  root.name = 'glasses';
  const metal = style === 1 || style === 4;
  const frameColor =
    style === 1 ? '#C9A45C' : style === 4 ? '#C8CCD2' : style === 3 ? '#5A3522' : '#15161A';
  const frameMat = metal ? mats.metal : mats.plastic;
  const w = (style === 5 ? 0.03 : style === 2 ? 0.027 : 0.024) * k;
  const h = (style === 1 ? 0.024 : style === 5 ? 0.021 : 0.018) * k;
  const radius = (metal ? 0.0011 : 0.0021) * k;
  const z = a.eyeL[2] + a.eyeRadius + 0.011 * k;
  for (const side of [1, -1]) {
    const eye = side > 0 ? a.eyeL : a.eyeR;
    const outline = lensOutline(style, w, h).map((p) =>
      V(eye[0] + p.x * side, eye[1] + 0.002 * k + p.y, z - (p.x * p.x) / (0.2 * k)),
    );
    const frame = new THREE.Mesh(tube(outline, radius, frameColor, true, 48), frameMat);
    const shape = new THREE.Shape(
      lensOutline(style, w * 0.98, h * 0.98).map((p) => new THREE.Vector2(p.x * side, p.y)),
    );
    const lensGeo = new THREE.ShapeGeometry(shape, 8);
    lensGeo.translate(eye[0], eye[1] + 0.002 * k, z - 0.0004);
    const lens = new THREE.Mesh(lensGeo, style === 5 ? mats.shades : mats.lens);
    lens.renderOrder = 3;
    // Temple arm back to the ear.
    const ear = side > 0 ? a.earL : a.earR;
    const hinge = V(eye[0] + side * w * 1.02, eye[1] + h * 0.35, z - 0.002 * k);
    const temple = new THREE.Mesh(
      tube(
        [
          hinge,
          V(ear[0] + side * 0.004 * k, ear[1] + 0.004 * k, (hinge.z + ear[2]) / 2),
          V(ear[0] + side * 0.002 * k, ear[1] - 0.004 * k, ear[2] - 0.012 * k),
        ],
        radius * 0.9,
        frameColor,
      ),
      frameMat,
    );
    root.add(frame, lens, temple);
  }
  const bridge = new THREE.Mesh(
    tube(
      [
        V(a.eyeR[0] + w * 0.95, a.eyeR[1] + 0.004 * k, z),
        V(0, a.noseBridge[1] + 0.006 * k, a.noseBridge[2] + 0.006 * k),
        V(a.eyeL[0] - w * 0.95, a.eyeL[1] + 0.004 * k, z),
      ],
      radius,
      frameColor,
    ),
    frameMat,
  );
  root.add(bridge);
  const hj = joint('head');
  root.position.set(-(hj[0] ?? 0), -(hj[1] ?? 0), -(hj[2] ?? 0));
  return { bone: 'head', object: root };
}

function headphones(
  a: FaceAnchors,
  color: string,
  mats: AvatarMaterials,
  joint: Joint,
  onNeck: boolean,
): RigidPart {
  const k = a.headScale;
  const root = new THREE.Group();
  root.name = onNeck ? 'neck-headphones' : 'headphones';
  const hj = joint(onNeck ? 'chest' : 'head');
  const cupGeo = colorGeometry(
    new THREE.CylinderGeometry(0.036 * k, 0.038 * k, 0.026 * k, 28),
    color,
  );
  const padGeo = colorGeometry(new THREE.TorusGeometry(0.03 * k, 0.009 * k, 8, 24), '#1C1D22');
  for (const side of [1, -1]) {
    const ear = side > 0 ? a.earL : a.earR;
    const cup = new THREE.Mesh(cupGeo, mats.plastic);
    const pad = new THREE.Mesh(padGeo, mats.plastic);
    if (onNeck) {
      cup.position.copy(rel(V(side * 0.075 * k, a.neck[1] - 0.02, a.neck[2] + 0.055), hj));
      cup.rotation.set(0.9, 0, 0);
    } else {
      cup.position.copy(rel(V(ear[0] + side * 0.012 * k, ear[1] - 0.008 * k, ear[2]), hj));
      cup.rotation.set(0, 0, Math.PI / 2);
      pad.position.copy(cup.position).add(V(-side * 0.012 * k, 0, 0));
      pad.rotation.set(0, Math.PI / 2, 0);
      root.add(pad);
    }
    root.add(cup);
  }
  const top = onNeck
    ? [
        V(0.075 * k, a.neck[1] - 0.01, a.neck[2] + 0.04),
        V(0.07 * k, a.neck[1] + 0.02, a.neck[2] - 0.04),
        V(0, a.neck[1] + 0.03, a.neck[2] - 0.07),
        V(-0.07 * k, a.neck[1] + 0.02, a.neck[2] - 0.04),
        V(-0.075 * k, a.neck[1] - 0.01, a.neck[2] + 0.04),
      ]
    : [
        V(a.earL[0] + 0.012 * k, a.earL[1] + 0.02 * k, a.earL[2]),
        V(0.1 * k, a.headTop[1] - 0.045 * k, a.headTop[2]),
        V(0, a.headTop[1] + 0.012 * k, a.headTop[2]),
        V(-0.1 * k, a.headTop[1] - 0.045 * k, a.headTop[2]),
        V(a.earR[0] - 0.012 * k, a.earR[1] + 0.02 * k, a.earR[2]),
      ];
  const band = new THREE.Mesh(
    tube(
      top.map((p) => rel(p, hj)),
      0.0055 * k,
      color,
    ),
    mats.plastic,
  );
  root.add(band);
  return { bone: onNeck ? 'chest' : 'head', object: root };
}

/** Flat ribbon along a curve (lanyards). */
function ribbon(points: THREE.Vector3[], width: number, color: string): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3();
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  const fwd = V(0, 0, 1);
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, p);
    curve.getTangentAt(i / n, t);
    side
      .crossVectors(t, fwd)
      .normalize()
      .multiplyScalar(width / 2);
    pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return colorGeometry(g, color);
}

function lanyard(a: FaceAnchors, color: string, mats: AvatarMaterials, joint: Joint): RigidPart {
  const cj = joint('chest');
  const root = new THREE.Group();
  root.name = 'lanyard';
  const badgeTop = V(0, a.chest[1] - 0.035, a.chest[2] + 0.014);
  for (const side of [1, -1]) {
    const pts = [
      V(0, a.neck[1] + 0.012, a.neck[2] - 0.06),
      V(side * 0.062, a.neck[1] - 0.004, a.neck[2] - 0.01),
      V(side * 0.05, a.collarFront[1] - 0.02, a.collarFront[2] + 0.01),
      V(side * 0.012, badgeTop.y + 0.01, badgeTop.z),
    ].map((q) => rel(q, cj));
    root.add(new THREE.Mesh(ribbon(pts, 0.015, color), mats.plastic));
  }
  const card = new THREE.Mesh(
    colorGeometry(new THREE.BoxGeometry(0.056, 0.084, 0.0025), '#F4F4F2'),
    mats.plastic,
  );
  card.position.copy(rel(V(0, badgeTop.y - 0.05, badgeTop.z + 0.004), cj));
  card.rotation.x = -0.08;
  const header = new THREE.Mesh(
    colorGeometry(new THREE.BoxGeometry(0.056, 0.018, 0.0028), color),
    mats.plastic,
  );
  header.position.set(0, 0.033, 0.0002);
  const photo = new THREE.Mesh(
    colorGeometry(new THREE.BoxGeometry(0.022, 0.026, 0.003), '#9AA3B0'),
    mats.plastic,
  );
  photo.position.set(0, 0.006, 0.0003);
  const clip = new THREE.Mesh(
    colorGeometry(new THREE.BoxGeometry(0.014, 0.012, 0.004), '#C8CCD2'),
    mats.metal,
  );
  clip.position.set(0, 0.046, 0);
  card.add(header, photo, clip);
  root.add(card);
  root.position.set(0, 0, 0);
  return { bone: 'chest', object: root, detail: false };
}

/** Accessories and garment hardware that are rigid: glasses, headphones, badge, watch, buttons. */
export function buildAccessoryParts(
  data: AvatarMeshData,
  spec: AvatarSpec,
  mats: AvatarMaterials,
  joint: Joint,
): RigidPart[] {
  const a = data.anchors;
  const parts: RigidPart[] = [];
  const acc = pick(CLOTH_COLORS, spec.accessoryColor);
  const g = glasses(a, spec, mats, joint);
  if (g) parts.push(g);
  if (spec.headwear === 4)
    parts.push(headphones(a, pick(CLOTH_COLORS, spec.headwearColor), mats, joint, false));
  if (spec.accessory === 1) parts.push(lanyard(a, acc, mats, joint));
  if (spec.accessory === 2) parts.push(headphones(a, acc, mats, joint, true));
  if (spec.accessory === 4) {
    const lj = joint('lowerArmL');
    const watch = new THREE.Group();
    const band = new THREE.Mesh(
      colorGeometry(new THREE.TorusGeometry(0.029, 0.0055, 8, 28), '#1C1D22'),
      mats.plastic,
    );
    const face = new THREE.Mesh(
      colorGeometry(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 24), '#0E0F12'),
      mats.metal,
    );
    face.position.set(0.004, 0.0, 0.03);
    face.rotation.x = Math.PI / 2;
    watch.add(band, face);
    watch.position.copy(rel(V(a.wristL[0] - 0.004, a.wristL[1] + 0.03, a.wristL[2] - 0.004), lj));
    watch.rotation.set(Math.PI / 2 - 0.14, 0, 0.12);
    parts.push({ bone: 'lowerArmL', object: watch, detail: true });
  }
  if (spec.accessory === 5) {
    const cj = joint('chest');
    const chain = new THREE.Mesh(
      colorGeometry(new THREE.TorusGeometry(0.066, 0.0014, 5, 48), '#C9A45C'),
      mats.metal,
    );
    chain.position.copy(rel(V(0, a.neck[1] - 0.035, a.neck[2] + 0.012), cj));
    chain.rotation.x = Math.PI / 2 + 0.55;
    const pendant = new THREE.Mesh(
      colorGeometry(new THREE.SphereGeometry(0.006, 12, 8), '#C9A45C'),
      mats.metal,
    );
    pendant.position.copy(rel(V(0, a.collarFront[1] - 0.03, a.collarFront[2] + 0.006), cj));
    parts.push(
      { bone: 'chest', object: chain, detail: true },
      { bone: 'chest', object: pendant, detail: true },
    );
  }
  const cj = joint('chest');
  if (spec.topStyle === 1) {
    for (const side of [1, -1]) {
      const start = V(side * 0.022, a.collarFront[1] + 0.004, a.collarFront[2] + 0.006);
      const cord = new THREE.Mesh(
        tube(
          [
            start,
            start.clone().add(V(side * 0.004, -0.07, 0.008)),
            start.clone().add(V(side * 0.002, -0.14, 0.004)),
          ].map((p) => rel(p, cj)),
          0.0024,
          '#F2F0EB',
          false,
          16,
        ),
        mats.plastic,
      );
      const tip = new THREE.Mesh(
        colorGeometry(new THREE.CylinderGeometry(0.0034, 0.0034, 0.02, 10), '#C8CCD2'),
        mats.metal,
      );
      tip.position.copy(rel(start.clone().add(V(side * 0.002, -0.15, 0.004)), cj));
      parts.push(
        { bone: 'chest', object: cord, detail: true },
        { bone: 'chest', object: tip, detail: true },
      );
    }
  }
  const sj = joint('spine');
  if (spec.topStyle === 3) {
    for (const dy of [0, -0.075]) {
      const b = new THREE.Mesh(
        colorGeometry(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 18), '#1B1C20'),
        mats.plastic,
      );
      b.position.copy(rel(V(0, a.buttonFront[1] + dy, a.buttonFront[2] + 0.002 + dy * 0.04), sj));
      b.rotation.x = Math.PI / 2;
      parts.push({ bone: 'spine', object: b, detail: true });
    }
  }
  if (spec.topStyle === 4) {
    for (const dy of [0.0, -0.028]) {
      const b = new THREE.Mesh(
        colorGeometry(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 14), '#F2F0EB'),
        mats.plastic,
      );
      b.position.copy(rel(V(0, a.collarFront[1] - 0.045 + dy, a.collarFront[2] + 0.004), cj));
      b.rotation.x = Math.PI / 2;
      parts.push({ bone: 'chest', object: b, detail: true });
    }
  }
  if (a.beltFront) {
    const hj = joint('hips');
    const buckle = new THREE.Mesh(
      colorGeometry(new THREE.BoxGeometry(0.04, 0.026, 0.005), '#B8B2A2'),
      mats.metal,
    );
    buckle.position.copy(rel(V(0, a.beltFront[1], a.beltFront[2] + 0.002), hj));
    parts.push({ bone: 'hips', object: buckle, detail: true });
  }
  return parts;
}
