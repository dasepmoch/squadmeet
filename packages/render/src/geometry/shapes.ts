import * as THREE from 'three';
import { geometryCache } from './parts.ts';

const r3 = (n: number): string => n.toFixed(3);

/** Rounded rectangle centered on the origin (XY plane). */
export function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.max(0.0005, Math.min(radius, w, h));
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

function roundedRectPath(width: number, height: number, radius: number): THREE.Path {
  const p = new THREE.Path();
  p.setFromPoints(roundedRectShape(width, height, radius).getPoints(12));
  return p;
}

/**
 * Flat rounded-rectangle ring lying in XZ (suspended ring luminaires, table inlays): outer
 * footprint `width` x `depth`, profile `band` wide and `thickness` tall, centered on the origin.
 */
export function ringSlabGeometry(
  width: number,
  depth: number,
  band: number,
  thickness: number,
  corner: number,
): THREE.BufferGeometry {
  return geometryCache.get(
    `ring:${r3(width)}:${r3(depth)}:${r3(band)}:${r3(thickness)}:${r3(corner)}`,
    () => {
      const outer = roundedRectShape(width, depth, corner);
      outer.holes.push(
        roundedRectPath(width - band * 2, depth - band * 2, Math.max(0.001, corner - band)),
      );
      const g = new THREE.ExtrudeGeometry(outer, {
        depth: thickness,
        bevelEnabled: false,
        curveSegments: 12,
      });
      g.rotateX(-Math.PI / 2);
      g.translate(0, -thickness / 2, 0);
      return g;
    },
  );
}

/**
 * Vertical gradient quad (XY, facing +Z) with a baked vertex color ramp from `bottom` to `top`.
 * Drawn additively it fakes soft light spill: LED coves, wall-washer scallops, lamp halos.
 */
export function gradientQuadGeometry(
  width: number,
  height: number,
  bottom: number,
  top: number,
  power = 1.6,
): THREE.BufferGeometry {
  return geometryCache.get(
    `gq:${r3(width)}:${r3(height)}:${r3(bottom)}:${r3(top)}:${r3(power)}`,
    () => {
      const rows = 8;
      const g = new THREE.PlaneGeometry(width, height, 1, rows);
      const pos = g.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        // Clamp: float error can push the top row past 1, and pow() of a negative base is NaN.
        const t = Math.min(1, Math.max(0, pos.getY(i) / height + 0.5));
        const k = bottom + (top - bottom) * (1 - Math.pow(1 - t, power));
        colors[i * 3] = k;
        colors[i * 3 + 1] = k;
        colors[i * 3 + 2] = k;
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return g;
    },
  );
}

/**
 * Inward-fading border on a rectangle (XZ, facing -Y), e.g. the glow a cove throws onto a tray
 * ceiling: full strength at the outer edge, zero `falloff` meters inside.
 */
export function borderGlowGeometry(
  width: number,
  depth: number,
  falloff: number,
): THREE.BufferGeometry {
  return geometryCache.get(`bg:${r3(width)}:${r3(depth)}:${r3(falloff)}`, () => {
    const w = width / 2;
    const d = depth / 2;
    const f = Math.min(falloff, w, d);
    const positions: number[] = [];
    const colors: number[] = [];
    const quad = (
      a: number[],
      b: number[],
      c: number[],
      e: number[],
      ka: number,
      kb: number,
      kc: number,
      ke: number,
    ): void => {
      for (const [p, k] of [
        [a, ka],
        [b, kb],
        [c, kc],
        [a, ka],
        [c, kc],
        [e, ke],
      ] as const) {
        positions.push(p[0] ?? 0, 0, p[1] ?? 0);
        colors.push(k, k, k);
      }
    };
    // Four trapezoids (outer edge bright, inner edge dark); winding faces -Y.
    quad([-w, -d], [w, -d], [w - f, -d + f], [-w + f, -d + f], 1, 1, 0, 0);
    quad([w, -d], [w, d], [w - f, d - f], [w - f, -d + f], 1, 1, 0, 0);
    quad([w, d], [-w, d], [-w + f, d - f], [w - f, d - f], 1, 1, 0, 0);
    quad([-w, d], [-w, -d], [-w + f, -d + f], [-w + f, d - f], 1, 1, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? -1 : 0)),
        3,
      ),
    );
    return g;
  });
}

/** Atlas cells of `generateLeafAtlas`: fig, bird of paradise, snake plant, pothos. */
export type LeafKind = 0 | 1 | 2 | 3;

/**
 * Curved leaf blade: a subdivided strip bent along its length (`curl`, radians over the length),
 * folded along the midrib (`fold`), with UVs mapped into the leaf atlas cell. The stem is at the
 * origin and the blade extends along +Y before bending; the face points +Z.
 */
export function leafGeometry(
  kind: LeafKind,
  rawLength: number,
  rawWidth: number,
  rawCurl: number,
  rawFold: number,
): THREE.BufferGeometry {
  // Quantize so plants share a small set of cached blades.
  const q = (v: number, step: number): number => Math.max(step, Math.round(v / step) * step);
  const length = q(rawLength, 0.01);
  const width = q(rawWidth, 0.005);
  const curl = Math.round(rawCurl / 0.05) * 0.05;
  const fold = Math.round(rawFold / 0.05) * 0.05;
  return geometryCache.get(
    `leaf:${kind}:${r3(length)}:${r3(width)}:${r3(curl)}:${r3(fold)}`,
    () => {
      const segs = 8;
      const g = new THREE.PlaneGeometry(width, length, 2, segs);
      g.translate(0, length / 2, 0);
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      const cellU = kind % 2;
      const cellV = kind >= 2 ? 1 : 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const t = y / length;
        // Bend along an arc; positive curl droops the tip towards -Z (behind the leaf face).
        const angle = curl * t;
        const radius = Math.abs(curl) > 1e-4 ? length / curl : 0;
        let ny: number;
        let nz: number;
        if (radius === 0) {
          ny = y;
          nz = 0;
        } else {
          ny = Math.sin(angle) * radius;
          nz = -(1 - Math.cos(angle)) * radius;
        }
        const lateral = Math.abs(x) / (width / 2);
        pos.setXYZ(i, x * (1 - 0.08 * lateral), ny, nz + lateral * fold * width * 0.5);
        uv.setXY(i, (cellU + uv.getX(i)) / 2, (cellV + uv.getY(i)) / 2);
      }
      g.computeVertexNormals();
      return g;
    },
  );
}
