import type { Simulation } from '@huddle/engine';
import type { InputSource } from '@huddle/platform';
import type { BoardStroke, GameRenderer } from '@huddle/render';
import type { InputFrame } from '@huddle/shared';
import type { BoardToolUi, HudStore } from '@huddle/ui';

const WIDTHS: Record<BoardToolUi, number> = { pen: 0.006, marker: 0.014, eraser: 0.05 };
const VIEW_DISTANCE = 1.75;

/**
 * Whiteboard drawing: frames the board with a fixed camera, turns left-drag into ink (instead
 * of orbiting) and hides the local avatar so it never blocks the view. Moving or Esc leaves.
 */
export class BoardMode {
  private readonly sim: Simulation;
  private readonly renderer: GameRenderer;
  private readonly input: InputSource;
  private readonly store: HudStore;
  private active: string | null = null;
  private drawing = false;
  private tool: BoardToolUi = 'pen';
  private color = '#1B1B2F';
  private enteredAt = 0;
  /** Pickable kinds outside board mode (restored on exit). */
  private savedKinds: string[] = [];

  constructor(sim: Simulation, renderer: GameRenderer, input: InputSource, store: HudStore) {
    this.sim = sim;
    this.renderer = renderer;
    this.input = input;
    this.store = store;
  }

  get boardId(): string | null {
    return this.active;
  }

  enter(boardId: string | null = null): void {
    const def =
      (boardId ? this.sim.room.boards.find((b) => b.id === boardId) : undefined) ??
      this.sim.room.boards[0];
    if (!def || this.active === def.id) return;
    this.active = def.id;
    this.enteredAt = this.sim.simTime;
    const [cx, cy, cz] = def.center;
    const nx = Math.sin(def.yaw);
    const nz = Math.cos(def.yaw);
    const aspect = Math.max(0.5, this.sim.aspect);
    // Fit the board with a margin, whichever of width or height is tighter.
    const halfV = Math.atan((def.height / 2 + 0.22) / VIEW_DISTANCE);
    const halfH = Math.atan((def.width / 2 + 0.3) / VIEW_DISTANCE);
    const fov = (2 * Math.max(halfV, Math.atan(Math.tan(halfH) / aspect)) * 180) / Math.PI;
    this.sim.camera.setFixed(
      { x: cx + nx * VIEW_DISTANCE, y: cy + 0.05, z: cz + nz * VIEW_DISTANCE },
      { x: cx, y: cy, z: cz },
      fov,
      false,
    );
    this.sim.setAim(null);
    this.sim.localControl = false;
    // Only the board is pickable meanwhile: the whiteboard's own prompt sphere sits in front of it.
    const kinds = this.sim.interaction.enabledKinds;
    this.savedKinds = [...kinds];
    kinds.clear();
    kinds.add('board');
    this.input.setDragLook(false);
    this.renderer.avatars.hidden.add(this.sim.selfId);
    this.publish();
  }

  exit(): void {
    if (!this.active) return;
    this.endStroke();
    this.active = null;
    this.sim.localControl = true;
    const kinds = this.sim.interaction.enabledKinds;
    kinds.clear();
    for (const k of this.savedKinds) kinds.add(k);
    this.input.setDragLook(true);
    this.renderer.avatars.hidden.delete(this.sim.selfId);
    this.sim.recenterCamera();
    this.store.setState({ board: null });
  }

  setTool(tool: BoardToolUi, color?: string): void {
    this.tool = tool;
    if (color) this.color = color;
    this.publish();
  }

  clear(): void {
    if (this.active) this.renderer.board(this.active)?.clear();
  }

  /** Per frame, after the simulation updated hover: pointer strokes onto the board. */
  update(frame: InputFrame): void {
    const id = this.active;
    if (!id) return;
    const moving = Math.abs(frame.moveX) > 0.2 || Math.abs(frame.moveY) > 0.2;
    if (moving && this.sim.simTime - this.enteredAt > 0.3) {
      this.exit();
      return;
    }
    const board = this.renderer.board(id);
    const hover = this.sim.view.hover;
    const over = hover.kind === 'board' && hover.id === id;
    if (board && frame.primaryDown && over) {
      const at = { u: hover.u, v: hover.v };
      if (!this.drawing) {
        const style: Omit<BoardStroke, 'points'> = {
          color: this.color,
          width: WIDTHS[this.tool],
          erase: this.tool === 'eraser',
        };
        board.beginStroke(style, at);
        this.drawing = true;
      } else {
        board.extendStroke(at);
      }
    } else if (this.drawing && (!frame.primaryDown || !over)) {
      this.endStroke();
    }
  }

  private endStroke(): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.active) this.renderer.board(this.active)?.endStroke();
  }

  private publish(): void {
    if (this.active)
      this.store.setState({ board: { id: this.active, tool: this.tool, color: this.color } });
  }
}
