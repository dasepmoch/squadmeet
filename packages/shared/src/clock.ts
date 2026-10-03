/** Opaque timer handle returned by `Clock.setTimeout`. */
export interface TimerHandle {
  readonly __timerHandle: true;
}

/**
 * Time source and scheduler. Injected everywhere so pure layers stay deterministic
 * and tests can use a manual clock.
 */
export interface Clock {
  /** Monotonic time in milliseconds (not related to the wall clock). */
  now(): number;
  /** Wall-clock time in epoch milliseconds. */
  wallNow(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

interface ManualTimer {
  id: number;
  due: number;
  interval: number;
  callback: () => void;
}

/** A fully manual clock for tests and headless simulation. */
export class ManualClock implements Clock {
  private time = 0;
  private wallOffset: number;
  private seq = 1;
  private timers = new Map<number, ManualTimer>();

  constructor(startWall = 1_700_000_000_000) {
    this.wallOffset = startWall;
  }

  now(): number {
    return this.time;
  }

  wallNow(): number {
    return this.wallOffset + this.time;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    return this.schedule(callback, ms, 0);
  }

  setInterval(callback: () => void, ms: number): TimerHandle {
    return this.schedule(callback, ms, Math.max(1, ms));
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handleId(handle));
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(handleId(handle));
  }

  /** Advances time, firing due timers in chronological order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: ManualTimer | undefined;
      for (const t of this.timers.values()) {
        if (t.due <= end && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) {
          next = t;
        }
      }
      if (!next) break;
      this.time = Math.max(this.time, next.due);
      if (next.interval > 0) next.due += next.interval;
      else this.timers.delete(next.id);
      next.callback();
    }
    this.time = end;
  }

  private schedule(callback: () => void, ms: number, interval: number): TimerHandle {
    const id = this.seq++;
    this.timers.set(id, { id, due: this.time + Math.max(0, ms), interval, callback });
    return makeHandle(id);
  }
}

const handleIds = new WeakMap<TimerHandle, number>();

function makeHandle(id: number): TimerHandle {
  const handle = Object.freeze({ __timerHandle: true as const });
  handleIds.set(handle, id);
  return handle;
}

function handleId(handle: TimerHandle): number {
  return handleIds.get(handle) ?? -1;
}
