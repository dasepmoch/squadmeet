import type { Sculpt, V3 } from './sdf.ts';

export interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

/**
 * Surface nets over a signed distance field with hierarchical narrow-band sampling: the field is
 * sampled every 4 cells, then every 2 cells only where a coarse cell may contain the surface, then
 * at full resolution only where a 2-cell block may. A block is skipped when any corner is farther
 * from the surface than the block diagonal (times the field's Lipschitz bound), and its samples
 * are filled by trilinear interpolation. One vertex per surface cell (edge-crossing centroid), a
 * quad per sign-changing edge, and normals from the sampled field's gradient (no extra samples).
 */
export function meshSculpt(
  sculpt: Sculpt,
  cell: number,
  bounds?: { min: V3; max: V3 },
  lipschitz = 1.3,
): RawMesh {
  const b = bounds ?? sculpt.bounds(cell * 3);
  const cellsX = Math.max(4, Math.ceil((b.max[0] - b.min[0]) / cell / 4) * 4);
  const cellsY = Math.max(4, Math.ceil((b.max[1] - b.min[1]) / cell / 4) * 4);
  const cellsZ = Math.max(4, Math.ceil((b.max[2] - b.min[2]) / cell / 4) * 4);
  const nx = cellsX + 1;
  const ny = cellsY + 1;
  const nz = cellsZ + 1;
  const ox = b.min[0];
  const oy = b.min[1];
  const oz = b.min[2];
  const field = new Float32Array(nx * ny * nz);
  const known = new Uint8Array(nx * ny * nz);
  const p: V3 = [0, 0, 0];
  const at = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  const sample = (i: number, j: number, k: number): number => {
    const idx = at(i, j, k);
    if (known[idx] === 1) return field[idx] as number;
    p[0] = ox + i * cell;
    p[1] = oy + j * cell;
    p[2] = oz + k * cell;
    const v = sculpt.distance(p);
    field[idx] = v;
    known[idx] = 1;
    return v;
  };
  const corners = new Float32Array(8);
  const blockCorners = (i: number, j: number, k: number, step: number): void => {
    for (let c = 0; c < 8; c++)
      corners[c] = sample(i + (c & 1) * step, j + ((c >> 1) & 1) * step, k + ((c >> 2) & 1) * step);
  };
  const isFar = (step: number): boolean => {
    const diag = step * cell * 1.7321 * lipschitz;
    for (let c = 0; c < 8; c++) if (Math.abs(corners[c] as number) > diag) return true;
    return false;
  };
  const fill = (i: number, j: number, k: number, step: number): void => {
    const c0 = corners[0] as number;
    const c1 = corners[1] as number;
    const c2 = corners[2] as number;
    const c3 = corners[3] as number;
    const c4 = corners[4] as number;
    const c5 = corners[5] as number;
    const c6 = corners[6] as number;
    const c7 = corners[7] as number;
    for (let dk = 0; dk <= step; dk++) {
      const w = dk / step;
      for (let dj = 0; dj <= step; dj++) {
        const v = dj / step;
        for (let di = 0; di <= step; di++) {
          const idx = at(i + di, j + dj, k + dk);
          if (known[idx] === 1) continue;
          const u = di / step;
          const x00 = c0 + (c1 - c0) * u;
          const x10 = c2 + (c3 - c2) * u;
          const x01 = c4 + (c5 - c4) * u;
          const x11 = c6 + (c7 - c6) * u;
          const y0 = x00 + (x10 - x00) * v;
          const y1 = x01 + (x11 - x01) * v;
          field[idx] = y0 + (y1 - y0) * w;
        }
      }
    }
  };
  for (let k = 0; k < cellsZ; k += 4) {
    for (let j = 0; j < cellsY; j += 4) {
      for (let i = 0; i < cellsX; i += 4) {
        blockCorners(i, j, k, 4);
        if (isFar(4)) {
          fill(i, j, k, 4);
          continue;
        }
        for (let s = 0; s < 8; s++) {
          const i2 = i + (s & 1) * 2;
          const j2 = j + ((s >> 1) & 1) * 2;
          const k2 = k + ((s >> 2) & 1) * 2;
          blockCorners(i2, j2, k2, 2);
          if (isFar(2)) {
            fill(i2, j2, k2, 2);
            continue;
          }
          for (let dk = 0; dk <= 2; dk++)
            for (let dj = 0; dj <= 2; dj++)
              for (let di = 0; di <= 2; di++) sample(i2 + di, j2 + dj, k2 + dk);
        }
      }
    }
  }

  // One vertex per surface cell.
  const cw = nx - 1;
  const ch = ny - 1;
  const cellIndex = new Int32Array(cw * ch * (nz - 1)).fill(-1);
  const verts: number[] = [];
  const cellOf: number[] = [];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))] as number;
          cv[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, bb] of EDGES) {
          const va = cv[a] as number;
          const vb = cv[bb] as number;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((bb & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((bb >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((bb >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellIndex[i + cw * (j + ch * k)] = verts.length / 3;
        verts.push(i + sx / n, j + sy / n, k + sz / n);
        cellOf.push(i, j, k);
      }
    }
  }

  // Quads across sign-changing edges.
  const idx: number[] = [];
  const cid = (i: number, j: number, k: number): number =>
    cellIndex[i + cw * (j + ch * k)] as number;
  const quad = (a: number, b2: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b2);
    else idx.push(a, b2, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = (field[at(i, j, k)] as number) < 0;
        if (inside !== (field[at(i + 1, j, k)] as number) < 0)
          quad(cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k), !inside);
        if (inside !== (field[at(i, j + 1, k)] as number) < 0)
          quad(cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1), !inside);
        if (inside !== (field[at(i, j, k + 1)] as number) < 0)
          quad(cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k), !inside);
      }
    }
  }

  // World positions and gradient normals (trilinear blend of the cell corners' central differences).
  const count = verts.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const f = (i: number, j: number, k: number): number =>
    field[
      at(
        Math.max(0, Math.min(nx - 1, i)),
        Math.max(0, Math.min(ny - 1, j)),
        Math.max(0, Math.min(nz - 1, k)),
      )
    ] as number;
  for (let v = 0; v < count; v++) {
    const gx = verts[v * 3] as number;
    const gy = verts[v * 3 + 1] as number;
    const gz = verts[v * 3 + 2] as number;
    positions[v * 3] = ox + gx * cell;
    positions[v * 3 + 1] = oy + gy * cell;
    positions[v * 3 + 2] = oz + gz * cell;
    const i0 = cellOf[v * 3] as number;
    const j0 = cellOf[v * 3 + 1] as number;
    const k0 = cellOf[v * 3 + 2] as number;
    const u = gx - i0;
    const w = gy - j0;
    const t = gz - k0;
    let nxv = 0;
    let nyv = 0;
    let nzv = 0;
    for (let c = 0; c < 8; c++) {
      const ci = i0 + (c & 1);
      const cj = j0 + ((c >> 1) & 1);
      const ck = k0 + ((c >> 2) & 1);
      const wt = (c & 1 ? u : 1 - u) * ((c >> 1) & 1 ? w : 1 - w) * ((c >> 2) & 1 ? t : 1 - t);
      nxv += (f(ci + 1, cj, ck) - f(ci - 1, cj, ck)) * wt;
      nyv += (f(ci, cj + 1, ck) - f(ci, cj - 1, ck)) * wt;
      nzv += (f(ci, cj, ck + 1) - f(ci, cj, ck - 1)) * wt;
    }
    const l = Math.hypot(nxv, nyv, nzv) || 1;
    normals[v * 3] = nxv / l;
    normals[v * 3 + 1] = nyv / l;
    normals[v * 3 + 2] = nzv / l;
  }
  return { positions, normals, indices: new Uint32Array(idx), vertexCount: count };
}
