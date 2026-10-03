import { encodeAvatar, type AvatarSpec } from '@huddle/shared';
import { CLOTH_COLORS, HAIR_COLORS, hexToLinear, pick, SKIN_TONES } from '../avatar-palette.ts';
import { BONES } from '../rig.ts';
import { hand } from './body.ts';
import { bottomSculpt, limbSkin, shoeSculpt } from './bottoms.ts';
import { computeFigure, EYE_POS } from './figure.ts';
import { hairSculpt } from './hair.ts';
import { TAG_HAT_BAND, TAG_HAT_BRIM } from './headwear.ts';
import { eyeParams, headSculpt, MOUTH_HALF, MOUTH_Y, surfacePoint } from './head.ts';
import { headPaint, mix, mul } from './head-paint.ts';
import type { AvatarMeshData, FaceAnchors, MeshPartData, PartSpec, Rgb } from './mesh-data.ts';
import { meshSculpt, type RawMesh } from './mesher.ts';
import { norm3, Sculpt, sub3, type V3 } from './sdf.ts';
import { computeWeights } from './skinning.ts';
import { scarfSculpt, TAG, topSculpt } from './wardrobe.ts';

export { meshDataTransferables } from './mesh-data.ts';
export type { AvatarMaterialKind, AvatarMeshData, FaceAnchors, MeshPartData } from './mesh-data.ts';

function dist2(a: V3, b: V3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Copy of a sculpt without its displacement (a cheap, conservative solid for culling). */
function solidOf(s: Sculpt): Sculpt {
  const out = new Sculpt();
  out.prims.push(...s.prims.map((p) => ({ ...p, box: undefined })));
  return out;
}

/** Builds every part of a sculpted avatar for one spec. Pure: safe to run in a worker. */
export function buildAvatarMeshData(
  spec: AvatarSpec,
  lods: readonly number[] = [1, 2.4],
): AvatarMeshData {
  const t0 = Date.now();
  const f = computeFigure(spec);
  const skin: Rgb = hexToLinear(pick(SKIN_TONES, spec.skinTone));
  const hairColor: Rgb = hexToLinear(pick(HAIR_COLORS, spec.hairColor));
  const topColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.topColor));
  const patternColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.patternColor));
  const bottomColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.bottomColor));
  const shoeColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.shoeColor));
  const hatColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.headwearColor));
  const accColor: Rgb = hexToLinear(pick(CLOTH_COLORS, spec.accessoryColor));
  const shirtColor: Rgb = hexToLinear(spec.patternColor % 3 === 0 ? '#D9E3F0' : '#F3F2EE');

  const { sculpt: head, hs } = headSculpt(f, spec);
  const top = topSculpt(f, spec);
  const bottom = bottomSculpt(f, spec, top);
  const hair = hairSculpt(spec, hs);
  const flatSkin = (): Rgb => skin;
  const topSolid = { sculpt: solidOf(top.top), inset: 0.002 };
  const covers: { sculpt: Sculpt; inset: number }[] = [topSolid];
  if (hair.hair) covers.push({ sculpt: solidOf(hair.hair), inset: 0.005 });
  if (hair.hat) covers.push({ sculpt: solidOf(hair.hat), inset: 0.004 });
  const parts: PartSpec[] = [
    {
      name: 'head',
      material: 'skin',
      sculpt: head,
      cell: 0.0046,
      paint: headPaint(spec, hs, skin, hairColor, hair.hairline),
      hiddenBy: covers,
    },
  ];
  for (const side of ['L', 'R'] as const) {
    const h = new Sculpt();
    hand(f, side, 0, h);
    parts.push({
      name: `hand${side}`,
      material: 'skin',
      sculpt: h,
      cell: 0.0044,
      paint: flatSkin,
      hiddenBy: [topSolid],
    });
  }
  const bottomSolid = { sculpt: solidOf(bottom.bottom), inset: 0.002 };
  const limbs = limbSkin(f, top, bottom);
  if (limbs)
    parts.push({
      name: 'limbs',
      material: 'skin',
      sculpt: limbs,
      cell: 0.011,
      paint: flatSkin,
      hiddenBy: [topSolid, bottomSolid],
    });
  const topPaint = (_p: V3, tag: number): Rgb => {
    if (tag === TAG.rib) return mul(topColor, 0.86);
    if (tag === TAG.trim) return mul(topColor, 0.78);
    if (tag === TAG.pocket) return mul(topColor, 0.94);
    if (tag === TAG.hood) return mul(topColor, 0.82);
    if (tag === TAG.shirt) return shirtColor;
    return topColor;
  };
  const pattern = spec.topPattern > 0 ? { color: patternColor, id: spec.topPattern } : undefined;
  const scarf = spec.accessory === 3 ? scarfSculpt(f) : null;
  const topCovers = scarf ? [{ sculpt: scarf, inset: 0.003 }] : [];
  // A tucked hem disappears inside the waistband.
  if (top.tuckedT !== null) topCovers.push(bottomSolid);
  parts.push({
    name: 'top',
    material: 'cloth',
    sculpt: top.top,
    cell: 0.011,
    paint: topPaint,
    hiddenBy: topCovers,
    ...(pattern ? { pattern } : {}),
  });
  if (top.shirt)
    parts.push({
      name: 'shirt',
      material: 'cloth',
      sculpt: top.shirt,
      cell: 0.0075,
      paint: () => shirtColor,
      hiddenBy: [topSolid],
    });
  const beltColor: Rgb = hexToLinear('#3A2A20');
  parts.push({
    name: 'bottom',
    material: 'cloth',
    sculpt: bottom.bottom,
    cell: 0.012,
    paint: (_p, tag) =>
      tag === TAG.belt ? beltColor : tag === TAG.rib ? mul(bottomColor, 0.88) : bottomColor,
    hiddenBy: [topSolid],
  });
  const darkSole = spec.shoeStyle === 1 || spec.shoeStyle === 2;
  const sole: Rgb = darkSole ? hexToLinear('#2A2522') : hexToLinear('#F1EFEA');
  parts.push({
    name: 'shoes',
    material: 'shoe',
    sculpt: shoeSculpt(f, spec),
    cell: 0.0088,
    hiddenBy: [bottomSolid],
    paint: (_p, tag) =>
      tag === TAG.sole
        ? sole
        : tag === TAG.trim
          ? mix(shoeColor, [0.92, 0.91, 0.89], darkSole ? 0.1 : 0.55)
          : shoeColor,
  });
  if (hair.hair) {
    parts.push({
      name: 'hair',
      material: 'hair',
      sculpt: hair.hair,
      cell: 0.0062,
      lipschitz: 2.6,
      rigid: 'head',
      ...(hair.follow
        ? { hang: { top: f.joints.head[1] - 0.06 * hs.k, bottom: f.shoulderY - 0.03 * f.s } }
        : {}),
      flow: { crown: hair.crown, hanging: hair.hanging },
      paint: (p) => {
        const d = Math.sqrt(dist2(p, hair.crown)) / hs.k;
        return mix(mul(hairColor, 0.82), mul(hairColor, 1.08), Math.min(1, d / 0.25));
      },
    });
  }
  if (hair.hat) {
    parts.push({
      name: 'hat',
      material: 'cloth',
      sculpt: hair.hat,
      cell: 0.0075,
      rigid: 'head',
      paint: (_p, tag) =>
        tag === TAG_HAT_BAND
          ? mul(hatColor, 0.84)
          : tag === TAG_HAT_BRIM
            ? mul(hatColor, 0.92)
            : hatColor,
    });
  }
  if (scarf)
    parts.push({
      name: 'scarf',
      material: 'cloth',
      sculpt: scarf,
      cell: 0.009,
      paint: () => accColor,
    });

  const lodParts: MeshPartData[][] = lods.map((scale) =>
    parts.map((ps) => meshPart(ps, f, scale)).filter((m): m is MeshPartData => m !== null),
  );
  const joints = new Float32Array(BONES.length * 3);
  BONES.forEach((b, i) => {
    const j = f.joints[b.name];
    joints.set(j, i * 3);
  });
  const eye = eyeParams(spec);
  const s = f.s;
  const mouth = surfacePoint(head, hs.p(0, MOUTH_Y, 0.06), [0, 0, 1], 0.1);
  // Sampled across 1.2x the mouth width (see mouthDepth in face-parts.ts).
  const mouthCurve = Array.from(
    { length: 9 },
    (_, i) =>
      surfacePoint(head, hs.p((i / 4 - 1) * MOUTH_HALF * 1.2, MOUTH_Y, 0.06), [0, 0, 1], 0.1)[2] -
      mouth[2],
  );
  const anchors: FaceAnchors = {
    eyeL: f.joints.eyeL,
    eyeR: f.joints.eyeR,
    eyeRadius: eye.radius * hs.k,
    lidOpen: eye.open,
    eyeTilt: eye.tilt,
    browL: surfacePoint(head, hs.p(EYE_POS[0] + 0.002, 0.137, 0.07), norm3([0, 0.3, 1]), 0.1),
    browR: surfacePoint(head, hs.p(-EYE_POS[0] - 0.002, 0.137, 0.07), norm3([0, 0.3, 1]), 0.1),
    mouth,
    mouthWidth: 2 * MOUTH_HALF * hs.k,
    mouthCurve,
    noseBridge: surfacePoint(head, hs.p(0, 0.112, 0.07), [0, 0, 1], 0.1),
    earL: hs.p(0.1, 0.122, -0.004),
    earR: hs.p(-0.1, 0.122, -0.004),
    headTop: hs.p(0, 0.255, -0.01),
    headScale: hs.k,
    chest: surfacePoint(top.top, [0, f.chestY + 0.02 * s, 0], [0, 0, 1], 0.4),
    collarFront: surfacePoint(top.top, [0, f.joints.neck[1] - 0.05 * s, 0], [0, 0, 1], 0.4),
    neck: f.joints.neck,
    neckRadius: 0.05 * s,
    wristL: f.joints.handL,
    topStyle: top.style,
    beltFront:
      bottom.beltY === null
        ? null
        : surfacePoint(bottom.bottom, [0, bottom.beltY, 0], [0, 0, 1], 0.4),
    buttonFront: surfacePoint(top.top, [0, f.waistY + 0.035 * s, 0], [0, 0, 1], 0.4),
  };
  return { key: encodeAvatar(spec), joints, lods: lodParts, anchors, ms: Date.now() - t0 };
}

/**
 * Drops triangles buried inside other solids (all three vertices deeper than `inset`) and
 * compacts the vertex arrays. Saves a third of the vertices on a typical avatar.
 */
function cullHidden(raw: RawMesh, hiddenBy: readonly { sculpt: Sculpt; inset: number }[]): RawMesh {
  const n = raw.vertexCount;
  const hidden = new Uint8Array(n);
  const p: V3 = [0, 0, 0];
  const boxes = hiddenBy.map((h) => h.sculpt.bounds(0));
  for (let v = 0; v < n; v++) {
    p[0] = raw.positions[v * 3] as number;
    p[1] = raw.positions[v * 3 + 1] as number;
    p[2] = raw.positions[v * 3 + 2] as number;
    for (let o = 0; o < hiddenBy.length; o++) {
      const b = boxes[o];
      const h = hiddenBy[o];
      if (!b || !h) continue;
      if (
        p[0] < b.min[0] ||
        p[1] < b.min[1] ||
        p[2] < b.min[2] ||
        p[0] > b.max[0] ||
        p[1] > b.max[1] ||
        p[2] > b.max[2]
      )
        continue;
      if (h.sculpt.distance(p) < -h.inset) {
        hidden[v] = 1;
        break;
      }
    }
  }
  const keep: number[] = [];
  for (let t = 0; t < raw.indices.length; t += 3) {
    const a = raw.indices[t] as number;
    const b = raw.indices[t + 1] as number;
    const c = raw.indices[t + 2] as number;
    if (hidden[a] === 1 && hidden[b] === 1 && hidden[c] === 1) continue;
    keep.push(a, b, c);
  }
  const remap = new Int32Array(n).fill(-1);
  let count = 0;
  for (const i of keep) if ((remap[i] as number) < 0) remap[i] = count++;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < n; v++) {
    const r = remap[v] as number;
    if (r < 0) continue;
    positions.set(raw.positions.subarray(v * 3, v * 3 + 3), r * 3);
    normals.set(raw.normals.subarray(v * 3, v * 3 + 3), r * 3);
  }
  return {
    positions,
    normals,
    indices: Uint32Array.from(keep, (i) => remap[i] as number),
    vertexCount: count,
  };
}

function meshPart(
  ps: PartSpec,
  f: ReturnType<typeof computeFigure>,
  scale: number,
): MeshPartData | null {
  let raw = meshSculpt(ps.sculpt, ps.cell * scale, undefined, ps.lipschitz);
  if (ps.hiddenBy && ps.hiddenBy.length > 0) raw = cullHidden(raw, ps.hiddenBy);
  if (raw.vertexCount === 0 || raw.indices.length === 0) return null;
  const n = raw.vertexCount;
  const colors = new Float32Array(n * 3);
  const pattern = ps.pattern ? new Float32Array(n * 4) : undefined;
  const flow = ps.flow ? new Float32Array(n * 3) : undefined;
  const p: V3 = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    p[0] = raw.positions[v * 3] as number;
    p[1] = raw.positions[v * 3 + 1] as number;
    p[2] = raw.positions[v * 3 + 2] as number;
    const owner = ps.sculpt.owner(p);
    const tag = owner?.tag ?? 0;
    const c = ps.paint(p, tag);
    colors[v * 3] = c[0];
    colors[v * 3 + 1] = c[1];
    colors[v * 3 + 2] = c[2];
    if (pattern && ps.pattern) {
      pattern[v * 4] = ps.pattern.color[0];
      pattern[v * 4 + 1] = ps.pattern.color[1];
      pattern[v * 4 + 2] = ps.pattern.color[2];
      pattern[v * 4 + 3] = tag === TAG.main ? ps.pattern.id / 8 : 0;
    }
    if (flow && ps.flow) {
      const nx = raw.normals[v * 3] as number;
      const ny = raw.normals[v * 3 + 1] as number;
      const nz = raw.normals[v * 3 + 2] as number;
      let d = sub3(p, ps.flow.crown);
      if (ps.flow.hanging && p[1] < ps.flow.crown[1] - 0.1 * f.headScale)
        d = [d[0] * 0.2, -1, d[2] * 0.2];
      const dn = d[0] * nx + d[1] * ny + d[2] * nz;
      const t = norm3([d[0] - nx * dn, d[1] - ny * dn, d[2] - nz * dn]);
      flow[v * 3] = t[0];
      flow[v * 3 + 1] = t[1];
      flow[v * 3 + 2] = t[2];
    }
  }
  const { index, weight } = computeWeights(raw.positions, ps.sculpt, f, ps.rigid, ps.hang);
  return {
    name: ps.name,
    material: ps.material,
    positions: raw.positions,
    normals: raw.normals,
    colors,
    skinIndex: index,
    skinWeight: weight,
    indices: raw.indices,
    ...(flow ? { flow } : {}),
    ...(pattern ? { pattern } : {}),
  };
}
