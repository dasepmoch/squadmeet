const TAP_MAX_MS = 260;
const TAP_MAX_PX = 12;
const LOOK_RADIANS_PER_PX = 0.006;

interface TrackedTouch {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  moved: boolean;
}

export interface TouchOutput {
  lookX: number;
  lookY: number;
  zoom: number;
  /** Two-finger drag of the pinch midpoint, in pixels. */
  panX: number;
  panY: number;
  tapX: number;
  tapY: number;
  tapped: boolean;
}

/**
 * Touch look (one-finger drag), pinch zoom, two-finger pan and tap-to-move/interact. The
 * on-screen joystick and buttons are UI elements that feed `InputSource.setVirtualMove` /
 * `pressVirtual`.
 */
export class TouchTracker {
  private readonly touches = new Map<number, TrackedTouch>();
  private pinchDistance = 0;
  readonly out: TouchOutput = {
    lookX: 0,
    lookY: 0,
    zoom: 0,
    panX: 0,
    panY: 0,
    tapX: 0,
    tapY: 0,
    tapped: false,
  };

  begin(id: number, x: number, y: number, time: number): void {
    this.touches.set(id, {
      id,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      startTime: time,
      moved: false,
    });
    if (this.touches.size === 2) this.pinchDistance = this.currentPinchDistance();
  }

  move(id: number, x: number, y: number): void {
    const t = this.touches.get(id);
    if (!t) return;
    if (this.touches.size >= 2) {
      const d = this.currentPinchDistanceWith(id, x, y);
      if (this.pinchDistance > 0) this.out.zoom += (this.pinchDistance - d) * 0.01;
      this.pinchDistance = d;
      // Each finger moves the midpoint by half its own motion.
      this.out.panX += (x - t.lastX) * 0.5;
      this.out.panY += (y - t.lastY) * 0.5;
    } else {
      this.out.lookX += (x - t.lastX) * LOOK_RADIANS_PER_PX;
      this.out.lookY += (y - t.lastY) * LOOK_RADIANS_PER_PX;
    }
    if (Math.hypot(x - t.startX, y - t.startY) > TAP_MAX_PX) t.moved = true;
    t.lastX = x;
    t.lastY = y;
  }

  end(id: number, time: number): void {
    const t = this.touches.get(id);
    if (!t) return;
    this.touches.delete(id);
    if (!t.moved && time - t.startTime <= TAP_MAX_MS && this.touches.size === 0) {
      this.out.tapped = true;
      this.out.tapX = t.lastX;
      this.out.tapY = t.lastY;
    }
    if (this.touches.size < 2) this.pinchDistance = 0;
  }

  cancelAll(): void {
    this.touches.clear();
    this.pinchDistance = 0;
  }

  resetFrame(): void {
    this.out.lookX = 0;
    this.out.lookY = 0;
    this.out.zoom = 0;
    this.out.panX = 0;
    this.out.panY = 0;
    this.out.tapped = false;
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
  }

  private currentPinchDistanceWith(id: number, x: number, y: number): number {
    let other: TrackedTouch | undefined;
    for (const t of this.touches.values()) {
      if (t.id !== id) {
        other = t;
        break;
      }
    }
    if (!other) return 0;
    return Math.hypot(x - other.lastX, y - other.lastY);
  }
}
