import type { PropInstance } from '@huddle/shared';
import * as THREE from 'three';
import { geometryCache, type PartList } from '../../geometry/parts.ts';
import { paramNumber, propMatrix, shade, type BuildContext } from '../build-context.ts';
import type { ScoreRow } from '../play-handles.ts';

/** Rim center and radius in the hoop's frame (match the catalog's goal and rim colliders). */
const RIM: readonly [number, number, number] = [0, 2.16, 0.33];
const RIM_RADIUS = 0.212;
const NET_LENGTH = 0.38;
const BOARD = { w: 0.9, h: 0.6, d: 0.03, y: 2.31, z: 0.08 };
const DISPLAY_FONT = '"Inter Variable", "Rubik Variable", Rubik, system-ui, sans-serif';
const SCORE_LINES = 5;

let netTexture: THREE.DataTexture | null = null;

/** Diamond mesh of net cord (alpha in every channel), tiling. */
function netAlpha(): THREE.DataTexture {
  if (netTexture) return netTexture;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const v = y / n;
      const a = (u + v) % 0.5;
      const b = (u - v + 1) % 0.5;
      const d = Math.min(a, 0.5 - a, b, 0.5 - b);
      const on = d < 0.035 ? 255 : d < 0.05 ? 120 : 0;
      data.set([on, on, on, on], (y * n + x) * 4);
    }
  }
  netTexture = new THREE.DataTexture(data, n, n);
  netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
  netTexture.repeat.set(8, 2);
  netTexture.magFilter = THREE.LinearFilter;
  netTexture.minFilter = THREE.LinearMipmapLinearFilter;
  netTexture.generateMipmaps = true;
  netTexture.needsUpdate = true;
  return netTexture;
}

/** Damped spring of a swish: 0 at rest, oscillating and dying out in about a second. */
function swishWave(age: number): number {
  return age < 0 || age > 1.6 ? 0 : Math.exp(-age * 4.2) * Math.sin(age * 19);
}

/**
 * Wall-mounted basketball hoop: mounting plate, white backboard with an accent frame and target
 * square, an orange rim on a bracket and a cord net that swishes when a ball drops through.
 */
export function buildHoop(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const board = ctx.color(inst.color, 'white');
  const accent = ctx.color(inst.accent, 'tomato');
  const steel = ctx.color('graphite', '#3A3F47');
  const { w, h, d, y, z } = BOARD;
  // Mounting: a plate on the wall and four short arms out to the board.
  p.box([0.52, 0.38, 0.012], 'powder', steel, [0, y, 0.006], 0.004);
  for (const [ax, ay] of [
    [-0.2, 0.12],
    [0.2, 0.12],
    [-0.2, -0.12],
    [0.2, -0.12],
  ] as const)
    p.box([0.03, 0.03, 0.055], 'powder', steel, [ax, y + ay, 0.038], 0.004);
  p.box([w, h, d], 'gloss', board, [0, y, z], 0.01);
  const face = z + d / 2 + 0.0008;
  const frame = 0.028;
  p.castShadow = false;
  for (const [bw, bh, bx, by] of [
    [w, frame, 0, y + h / 2 - frame / 2],
    [w, frame, 0, y - h / 2 + frame / 2],
    [frame, h, -w / 2 + frame / 2, y],
    [frame, h, w / 2 - frame / 2, y],
  ] as const)
    p.box([bw, bh, 0.002], 'powder', accent, [bx, by, face], 0.0005);
  // Target square above the rim.
  const tw = 0.3;
  const th = 0.22;
  const ty = RIM[1] + 0.035 + th / 2;
  const line = 0.014;
  for (const [bw, bh, bx, by] of [
    [tw, line, 0, ty + th / 2],
    [tw, line, 0, ty - th / 2],
    [line, th, -tw / 2, ty],
    [line, th, tw / 2, ty],
  ] as const)
    p.box([bw + line, bh, 0.002], 'powder', accent, [bx, by, face], 0.0005);
  p.castShadow = true;
  // Rim on its bracket.
  p.torus(RIM_RADIUS, 0.011, 'powder', accent, RIM, [Math.PI / 2, 0, 0]);
  p.box(
    [0.1, 0.035, RIM[2] - RIM_RADIUS - face + 0.01],
    'powder',
    accent,
    [0, RIM[1] - 0.004, (face + RIM[2] - RIM_RADIUS) / 2],
    0.004,
  );
  p.box([0.04, 0.12, 0.03], 'powder', shade(accent, 0.8), [0, RIM[1] - 0.06, face + 0.016], 0.004);

  // The net is live: it swishes.
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    profile.push(new THREE.Vector2(RIM_RADIUS - 0.006 - f * 0.075 + f * f * 0.01, -f * NET_LENGTH));
  }
  const netGeo = geometryCache.get('hoop-net', () => new THREE.LatheGeometry(profile, 24));
  const netMat = new THREE.MeshStandardMaterial({
    color: '#F4F4F2',
    roughness: 0.9,
    alphaMap: netAlpha(),
    alphaTest: 0.3,
    side: THREE.DoubleSide,
  });
  ctx.library.envProjection.apply(netMat);
  const net = new THREE.Mesh(netGeo, netMat);
  net.castShadow = true;
  net.position.set(RIM[0], RIM[1], RIM[2]);
  const group = new THREE.Group();
  group.name = `hoop:${inst.id}`;
  group.add(net);
  group.applyMatrix4(propMatrix(inst));
  let swishAt = Number.NEGATIVE_INFINITY;
  ctx.play.hoops.set(inst.id, {
    swish: (time) => {
      swishAt = time;
    },
  });
  ctx.addDynamic(group, (time) => {
    const wv = swishWave(time - swishAt);
    // The net snaps down and in as the ball drops through, then springs back.
    net.scale.set(1 - wv * 0.12, 1 + wv * 0.22, 1 - wv * 0.12);
    net.rotation.y = wv * 0.15;
  });
}

/** Draws the scoreboard face: title, top scorers (or an invitation) and a hint. */
function drawScores(c: CanvasRenderingContext2D, rows: readonly ScoreRow[]): void {
  const { width: w, height: h } = c.canvas;
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#101828');
  bg.addColorStop(1, '#0B1220');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillStyle = '#FF7A1A';
  c.font = `800 ${Math.round(h * 0.13)}px ${DISPLAY_FONT}`;
  c.fillText('HOOPS', w * 0.07, h * 0.14);
  c.textAlign = 'right';
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.font = `600 ${Math.round(h * 0.065)}px ${DISPLAY_FONT}`;
  c.fillText('PTS', w * 0.93, h * 0.15);
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(w * 0.07, h * 0.25, w * 0.86, 2);
  const top = [...rows].sort((a, b) => b.points - a.points).slice(0, SCORE_LINES);
  if (top.length === 0) {
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = `500 ${Math.round(h * 0.075)}px ${DISPLAY_FONT}`;
    c.fillText('Paper balls score here', w / 2, h * 0.52);
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.font = `400 ${Math.round(h * 0.06)}px ${DISPLAY_FONT}`;
    c.fillText('2 points, 3 from far away', w / 2, h * 0.66);
    return;
  }
  const lineH = (h * 0.7) / SCORE_LINES;
  top.forEach((r, i) => {
    const cy = h * 0.32 + lineH * (i + 0.5);
    if (r.self) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(w * 0.05, cy - lineH * 0.46, w * 0.9, lineH * 0.92);
    }
    c.fillStyle = r.color;
    c.beginPath();
    c.arc(w * 0.1, cy, lineH * 0.17, 0, Math.PI * 2);
    c.fill();
    c.textAlign = 'left';
    c.fillStyle = '#FFFFFF';
    c.font = `${r.self ? 700 : 500} ${Math.round(lineH * 0.5)}px ${DISPLAY_FONT}`;
    const name = r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name;
    c.fillText(name, w * 0.15, cy);
    c.textAlign = 'right';
    c.font = `800 ${Math.round(lineH * 0.56)}px ${DISPLAY_FONT}`;
    c.fillStyle = i === 0 ? '#FFD21F' : '#FFFFFF';
    c.fillText(String(r.points), w * 0.93, cy);
  });
}

/** Wall scoreboard of the hoop: a slim dark frame around a glowing screen. */
export function buildScoreboard(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const w = paramNumber(inst, 'width', 0.72);
  const h = paramNumber(inst, 'height', 0.46);
  const y = paramNumber(inst, 'y', 2.36);
  p.box([w + 0.05, h + 0.05, 0.03], 'powder', ctx.color(inst.color, 'black'), [0, y, 0.015], 0.008);
  const canvas = ctx.canvas.create(512, Math.round((512 * h) / w));
  const c = canvas.getContext('2d');
  if (!c) return;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    color: '#000000',
    roughness: 0.35,
    emissive: new THREE.Color(1, 1, 1),
    emissiveMap: texture,
    emissiveIntensity: 0.95,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  screen.name = `scoreboard:${inst.id}`;
  screen.position.set(0, y, 0.0315);
  const group = new THREE.Group();
  group.add(screen);
  group.applyMatrix4(propMatrix(inst));
  let key = '';
  const draw = (rows: readonly ScoreRow[]): void => {
    const next = rows.map((r) => `${r.name}:${r.points}:${r.color}:${r.self}`).join('|');
    if (next === key) return;
    key = next;
    drawScores(c, rows);
    texture.needsUpdate = true;
  };
  key = '-';
  draw([]);
  ctx.play.scoreboards.push({ draw });
  ctx.addDynamic(group);
}

/** An open pizza box on a table: a few slices already gone. */
export function buildPizzaBox(inst: PropInstance, ctx: BuildContext, p: PartList): void {
  const card = ctx.color(inst.color, '#D7B98E');
  const inside = shade(card, 1.12);
  const s = 0.36;
  p.box([s, 0.028, s], 'paper', card, [0, 0.014, 0], 0.003);
  p.box([s - 0.02, 0.002, s - 0.02], 'paper', inside, [0, 0.0285, 0], 0.0005);
  // The lid stands open, hinged at the back edge.
  const open = 1.78;
  p.box(
    [s, 0.006, s],
    'paper',
    card,
    [0, 0.028 + Math.sin(open) * (s / 2), -s / 2 + Math.cos(open) * (s / 2)],
    0.002,
    [-open, 0, 0],
  );
  const cheese = ctx.color('#F2B33D', '#F2B33D');
  const crust = ctx.color('#C9833A', '#C9833A');
  const salami = ctx.color('#B3261E', '#B3261E');
  const r = 0.155;
  const wedge = Math.PI / 3;
  const slice = geometryCache.get(
    'pizza-slice',
    () => new THREE.CylinderGeometry(r, r, 0.01, 10, 1, false, 0, wedge),
  );
  // Four of six slices left.
  for (let i = 0; i < 6; i++) {
    if (i === 1 || i === 2) continue;
    const a0 = i * wedge;
    p.add(slice, 'plastic', cheese, [0, 0.035, 0], [0, a0, 0]);
    const arc: [number, number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * wedge;
      arc.push([Math.sin(a) * (r - 0.004), 0.04, Math.cos(a) * (r - 0.004)]);
    }
    p.tube(`pizza-crust:${i}`, arc, 0.011, 'paper', crust, [0, 0, 0], false, 10);
    for (const [f, d] of [
      [0.3, 0.55],
      [0.7, 0.75],
      [0.5, 0.3],
    ] as const) {
      const a = a0 + f * wedge;
      p.cylinder(
        0.016,
        0.016,
        0.003,
        'plastic',
        salami,
        [Math.sin(a) * r * d, 0.0415, Math.cos(a) * r * d],
        [0, 0, 0],
        14,
      );
    }
  }
}
