import type { AvatarSpec } from '@huddle/shared';
import * as THREE from 'three';
import type { AvatarMaterials } from './avatar-materials.ts';
import { HAIR_COLORS, hexToLinear, pick, SKIN_TONES } from './avatar-palette.ts';
import type { BoneName } from './rig.ts';
import type { AvatarMeshData, FaceAnchors } from './sculpt/character.ts';

/** A rigid mesh parented to a bone (face parts, glasses, jewellery, props). */
export interface RigidPart {
  bone: BoneName;
  object: THREE.Object3D;
  /** Hidden at the far LOD (tiny details). */
  detail?: boolean;
}

/** Polar angle (from the lid's +Y pole) of the upper lid cap's edge. */
export const LID_EDGE = Math.PI * 0.56;

export function colorGeometry(
  g: THREE.BufferGeometry,
  hex: string | [number, number, number],
): THREE.BufferGeometry {
  const c = typeof hex === 'string' ? hexToLinear(hex) : hex;
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set(c, i * 3);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Tube along a smooth curve whose radius follows `radii` (sampled along the length). Used for
 * tapered brows, lashes, cords and frames.
 */
export function taperedTube(
  points: readonly THREE.Vector3[],
  radii: readonly number[],
  segments = 24,
  radial = 6,
  closed = false,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([...points], closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segments, 1, radial, closed);
  const pos = g.getAttribute('position');
  const center = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, center);
    const f = t * (radii.length - 1);
    const i0 = Math.floor(f);
    const r =
      (radii[i0] ?? 0) +
      ((radii[Math.min(radii.length - 1, i0 + 1)] ?? 0) - (radii[i0] ?? 0)) * (f - i0);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      if (idx >= pos.count) continue;
      const x = pos.getX(idx) - center.x;
      const y = pos.getY(idx) - center.y;
      const z = pos.getZ(idx) - center.z;
      pos.setXYZ(idx, center.x + x * r, center.y + y * r, center.z + z * r);
    }
  }
  g.computeVertexNormals();
  return g;
}

function place(
  object: THREE.Object3D,
  world: readonly number[],
  joint: readonly number[],
): THREE.Object3D {
  object.position.set(
    (world[0] ?? 0) - (joint[0] ?? 0),
    (world[1] ?? 0) - (joint[1] ?? 0),
    (world[2] ?? 0) - (joint[2] ?? 0),
  );
  return object;
}

/** Eyeballs, lids, lashes, brows and mouth, parented to the face bones. */
export function buildFaceParts(
  data: AvatarMeshData,
  spec: AvatarSpec,
  mats: AvatarMaterials,
  joint: (b: BoneName) => readonly number[],
): RigidPart[] {
  const a = data.anchors;
  const parts: RigidPart[] = [];
  const r = a.eyeRadius;
  const skin = hexToLinear(pick(SKIN_TONES, spec.skinTone));
  const lidColor: [number, number, number] = [skin[0] * 0.92, skin[1] * 0.88, skin[2] * 0.86];
  const lashColor = hexToLinear('#120E0C');
  const browColor = hexToLinear(pick(HAIR_COLORS, spec.hairColor)).map((c) => c * 0.8) as [
    number,
    number,
    number,
  ];
  const eyeGeo = new THREE.SphereGeometry(r, 32, 20);
  const upperGeo = colorGeometry(
    new THREE.SphereGeometry(r * 1.075, 32, 14, 0, Math.PI * 2, 0, LID_EDGE),
    lidColor,
  );
  const lowerGeo = colorGeometry(
    new THREE.SphereGeometry(r * 1.06, 32, 6, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3),
    lidColor,
  );
  for (const side of ['L', 'R'] as const) {
    const eyeBone: BoneName = side === 'L' ? 'eyeL' : 'eyeR';
    const lidBone: BoneName = side === 'L' ? 'lidL' : 'lidR';
    const center = side === 'L' ? a.eyeL : a.eyeR;
    const eye = new THREE.Mesh(eyeGeo, mats.eye(spec.eyeColor));
    eye.name = `eye${side}`;
    parts.push({ bone: eyeBone, object: place(eye, center, joint(eyeBone)) });
    const lid = new THREE.Mesh(upperGeo, mats.skin);
    lid.name = `lid${side}`;
    const lidRoot = place(new THREE.Group(), center, joint(lidBone));
    lidRoot.add(lid);
    // Lashes ride on the lid edge; a gentle outer flick reads as friendly and alert.
    const R = r * 1.085 * Math.sin(LID_EDGE);
    const y = r * 1.085 * Math.cos(LID_EDGE);
    const sx = side === 'L' ? 1 : -1;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const phi = -1.2 + (i / 8) * 2.4;
      const outer = phi * sx > 0 ? (phi * sx) / 1.2 : 0;
      pts.push(
        new THREE.Vector3(
          Math.sin(phi) * R * (1 + outer * 0.1),
          y + outer * outer * r * 0.2,
          Math.cos(phi) * R,
        ),
      );
    }
    // A defined upper lash line, heavier towards the outer corner, frames the eye.
    const lashRadii = [0.0007, 0.0014, 0.0017, 0.0019, 0.0012].map((q) => q * a.headScale);
    const lashes = new THREE.Mesh(
      colorGeometry(taperedTube(sx > 0 ? pts : [...pts].reverse(), lashRadii, 20, 4), lashColor),
      mats.dark,
    );
    lidRoot.add(lashes);
    parts.push({ bone: lidBone, object: lidRoot });
    const lower = new THREE.Mesh(lowerGeo, mats.skin);
    lower.rotation.x = -0.14;
    parts.push({ bone: 'head', object: place(lower, center, joint('head')), detail: true });
    parts.push({
      bone: side === 'L' ? 'browL' : 'browR',
      object: buildBrow(a, spec, side, browColor, mats, joint),
    });
  }
  const mouth = buildMouth(a, spec, mats, joint);
  parts.push({ bone: 'jaw', object: mouth.opening }, { bone: 'head', object: mouth.crease });
  return parts;
}

function buildBrow(
  a: FaceAnchors,
  spec: AvatarSpec,
  side: 'L' | 'R',
  color: [number, number, number],
  mats: AvatarMaterials,
  joint: (b: BoneName) => readonly number[],
): THREE.Object3D {
  const k = a.headScale;
  const sx = side === 'L' ? 1 : -1;
  const anchor = side === 'L' ? a.browL : a.browR;
  const arch = spec.browStyle === 1 ? 0.007 : spec.browStyle === 2 ? 0.001 : 0.004;
  const bold = spec.browStyle === 3 ? 1.5 : 1;
  const xs = [-0.021, -0.007, 0.008, 0.023];
  const ys = [-0.001, arch, arch * 0.9, -0.003];
  const pts = xs.map(
    (x, i) => new THREE.Vector3(sx * x * k, (ys[i] ?? 0) * k, (-(x * x) * 7 + 0.0022) * k),
  );
  const radii = [0.0022, 0.0031, 0.0028, 0.0013].map((q) => q * k * bold);
  const brow = new THREE.Mesh(colorGeometry(taperedTube(pts, radii, 18, 5), color), mats.dark);
  brow.scale.set(1, 0.72, 1);
  const root = place(
    new THREE.Group(),
    [anchor[0], anchor[1], anchor[2]],
    joint(side === 'L' ? 'browL' : 'browR'),
  );
  root.add(brow);
  return root;
}

/** Skin depth at a mouth-relative x (world units), from the curve sampled on the sculpt. */
function mouthDepth(a: FaceAnchors, x: number): number {
  const half = 0.6 * a.mouthWidth;
  const t = Math.max(0, Math.min(8, (x / half + 1) * 4));
  const i = Math.min(7, Math.floor(t));
  const c0 = a.mouthCurve[i] ?? 0;
  const c1 = a.mouthCurve[i + 1] ?? c0;
  return c0 + (c1 - c0) * (t - i);
}

/**
 * Mouth: a lens-shaped opening (dark interior with a teeth strip) that the jaw scales open, and a
 * crease line on the head that draws the closed smile. Both hug the sculpted skin.
 */
function buildMouth(
  a: FaceAnchors,
  spec: AvatarSpec,
  mats: AvatarMaterials,
  joint: (b: BoneName) => readonly number[],
): { opening: THREE.Object3D; crease: THREE.Object3D } {
  const w = (a.mouthWidth / 2) * (spec.mouthStyle === 2 ? 1.14 : 1);
  const smile = spec.mouthStyle === 1 ? 0.05 : spec.mouthStyle === 3 ? 0.2 : 0.32;
  const h = w * 0.34;
  const shape = new THREE.Shape();
  const lift = h * smile * 2.4;
  const left = spec.mouthStyle === 3 ? lift * 1.8 : lift;
  shape.moveTo(-w, left);
  shape.bezierCurveTo(-w * 0.5, h * 0.55, w * 0.5, h * 0.55, w, lift);
  shape.bezierCurveTo(w * 0.55, -h * 1.25, -w * 0.55, -h * 1.25, -w, left);
  const bend = (g: THREE.BufferGeometry, z: number): THREE.BufferGeometry => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setZ(i, z + mouthDepth(a, pos.getX(i)));
    g.computeVertexNormals();
    return g;
  };
  const opening = place(new THREE.Group(), a.mouth, joint('jaw'));
  const inner = new THREE.Mesh(bend(new THREE.ShapeGeometry(shape, 12), 0.0026), mats.mouth);
  const teethShape = new THREE.Shape();
  teethShape.moveTo(-w * 0.72, h * 0.18);
  teethShape.bezierCurveTo(-w * 0.35, h * 0.46, w * 0.35, h * 0.46, w * 0.72, h * 0.18);
  teethShape.lineTo(w * 0.62, -h * 0.05);
  teethShape.bezierCurveTo(w * 0.3, h * 0.1, -w * 0.3, h * 0.1, -w * 0.62, -h * 0.05);
  const teeth = new THREE.Mesh(bend(new THREE.ShapeGeometry(teethShape, 8), 0.003), mats.teeth);
  opening.add(inner, teeth);
  opening.name = 'mouth';
  // Closed-mouth crease: corners turn up for a smile, one corner for a smirk.
  const corner = h * (0.25 + smile * 1.2);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 4 - 1;
    const up = u < 0 && spec.mouthStyle === 3 ? 1.8 : 1;
    const x = u * w;
    pts.push(new THREE.Vector3(x, corner * u * u * up, mouthDepth(a, x) + 0.0032));
  }
  const radii = [0.00035, 0.0007, 0.00095, 0.0011, 0.0011, 0.0011, 0.00095, 0.0007, 0.00035].map(
    (r) => r * a.headScale,
  );
  const crease = place(new THREE.Group(), a.mouth, joint('head'));
  crease.add(new THREE.Mesh(colorGeometry(taperedTube(pts, radii, 24, 5), '#4A2220'), mats.dark));
  crease.name = 'mouth-crease';
  return { opening, crease };
}
