const DEADZONE = 0.18;
const LOOK_SPEED = 2.6; // radians per second at full deflection

function applyDeadzone(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

export interface GamepadSample {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  active: boolean;
}

/** Polls the first connected gamepad and reports button edges as `Pad<index>` codes. */
export class GamepadPoller {
  private prevButtons: boolean[] = [];
  private readonly nav: Navigator;
  readonly sample: GamepadSample = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, active: false };

  constructor(nav: Navigator) {
    this.nav = nav;
  }

  poll(dtSeconds: number, onButton: (code: string, pressed: boolean) => void): void {
    const s = this.sample;
    s.moveX = 0;
    s.moveY = 0;
    s.lookX = 0;
    s.lookY = 0;
    s.active = false;
    if (typeof this.nav.getGamepads !== 'function') return;
    const pads = this.nav.getGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p?.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.prevButtons.length = 0;
      return;
    }
    const ax = pad.axes;
    s.moveX = applyDeadzone(ax[0] ?? 0);
    s.moveY = -applyDeadzone(ax[1] ?? 0);
    s.lookX = applyDeadzone(ax[2] ?? 0) * LOOK_SPEED * dtSeconds;
    s.lookY = applyDeadzone(ax[3] ?? 0) * LOOK_SPEED * dtSeconds;
    let any = s.moveX !== 0 || s.moveY !== 0 || s.lookX !== 0 || s.lookY !== 0;
    for (let i = 0; i < pad.buttons.length; i++) {
      const pressed = pad.buttons[i]?.pressed ?? false;
      const prev = this.prevButtons[i] ?? false;
      if (pressed !== prev) {
        onButton(`Pad${i}`, pressed);
        any = true;
      }
      this.prevButtons[i] = pressed;
    }
    s.active = any;
  }
}
