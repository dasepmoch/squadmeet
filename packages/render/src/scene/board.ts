import type { CanvasFactory } from '@huddle/platform';
import type { BoardDef } from '@huddle/shared';
import * as THREE from 'three';
import type { MaterialLibrary } from '../materials/library.ts';

/** A stroke in board UV space (0..1, origin bottom-left) with a width in board meters. */
export interface BoardStroke {
  points: readonly { u: number; v: number }[];
  color: string;
  width: number;
  /** Erasing strokes paint the board background. */
  erase?: boolean;
}

const PX_PER_METER = 640;
const BACKGROUND = '#FBFBF8';

/**
 * Writable whiteboard surface backed by a canvas texture. Strokes are drawn incrementally
 * (`beginStroke` / `extendStroke`) so live drawing uploads at most once per frame. The glossy
 * physical material catches reflections of the ceiling fixtures like a real melamine board.
 */
export class BoardSurface {
  readonly mesh: THREE.Mesh;
  readonly def: BoardDef;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshPhysicalMaterial;
  private dirty = true;
  private last: { u: number; v: number } | null = null;
  private current: Omit<BoardStroke, 'points'> | null = null;
  private strokes = 0;

  constructor(def: BoardDef, factory: CanvasFactory, library: MaterialLibrary) {
    this.def = def;
    const w = Math.round(Math.min(2048, def.width * PX_PER_METER));
    const h = Math.round(Math.min(2048, def.height * PX_PER_METER));
    this.canvas = factory.create(w, h);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshPhysicalMaterial({
      map: this.texture,
      // Melamine reads bright white under office light. A little self-light from the board's own
      // picture keeps it white (and the ink dark) wherever the ceiling fixtures happen to land.
      emissive: new THREE.Color(1, 1, 1),
      emissiveMap: this.texture,
      emissiveIntensity: 0.34,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 0.6,
    });
    library.envProjection.apply(this.material);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.width, def.height), this.material);
    this.mesh.name = `board:${def.id}`;
    this.mesh.receiveShadow = true;
    const [cx, cy, cz] = def.center;
    this.mesh.position.set(cx + Math.sin(def.yaw) * 0.0006, cy, cz + Math.cos(def.yaw) * 0.0006);
    this.mesh.rotation.y = def.yaw;
    this.clear();
  }

  get strokeCount(): number {
    return this.strokes;
  }

  /** Wipes the board, leaving the faint ghosting every real whiteboard has. */
  clear(): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.035;
    ctx.strokeStyle = '#6A7280';
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 6 + (i % 3) * 5;
      ctx.beginPath();
      const y = canvas.height * (0.18 + i * 0.08);
      ctx.moveTo(canvas.width * (0.1 + (i % 4) * 0.05), y);
      ctx.bezierCurveTo(
        canvas.width * 0.35,
        y - 30,
        canvas.width * 0.55,
        y + 40,
        canvas.width * (0.72 - (i % 3) * 0.08),
        y + 8,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.strokes = 0;
    this.dirty = true;
  }

  beginStroke(style: Omit<BoardStroke, 'points'>, at: { u: number; v: number }): void {
    this.current = style;
    this.last = at;
    this.dot(at, style);
    this.strokes++;
  }

  extendStroke(at: { u: number; v: number }): void {
    const style = this.current;
    const last = this.last;
    if (!style || !last) return;
    const { ctx } = this;
    this.applyStyle(style);
    ctx.beginPath();
    ctx.moveTo(...this.toPx(last));
    ctx.lineTo(...this.toPx(at));
    ctx.stroke();
    this.last = at;
    this.dirty = true;
  }

  endStroke(): void {
    this.current = null;
    this.last = null;
  }

  /** Draws a complete stroke at once (remote strokes, replays). */
  drawStroke(stroke: BoardStroke): void {
    const [first, ...rest] = stroke.points;
    if (!first) return;
    this.beginStroke(stroke, first);
    for (const p of rest) this.extendStroke(p);
    this.endStroke();
  }

  /** Uploads pending pixels; call once per frame. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }

  private toPx(p: { u: number; v: number }): [number, number] {
    return [p.u * this.canvas.width, (1 - p.v) * this.canvas.height];
  }

  private applyStyle(style: Omit<BoardStroke, 'points'>): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = style.erase ? BACKGROUND : style.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(1, style.width * PX_PER_METER);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Opaque ink: incremental segments overlap at their round caps, alpha would bead.
    ctx.globalAlpha = 1;
  }

  private dot(at: { u: number; v: number }, style: Omit<BoardStroke, 'points'>): void {
    const { ctx } = this;
    this.applyStyle(style);
    const [x, y] = this.toPx(at);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, (style.width * PX_PER_METER) / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.dirty = true;
  }
}
