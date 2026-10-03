import type { WebWindow } from '../web-window.ts';
import type { ActionEvent, InputSource, InputSourceFactory } from '@huddle/platform';
import {
  actionBit,
  buildCodeMap,
  DEFAULT_BINDINGS,
  isBindableCode,
  type ActionName,
  type InputBindings,
  type InputDevice,
  type InputFrame,
  type Unsubscribe,
} from '@huddle/shared';
import { GamepadPoller } from './gamepad.ts';
import { TouchTracker } from './touch.ts';

const MOUSE_LOOK_RADIANS_PER_PX = 0.0042;
const CLICK_MAX_MS = 280;
const CLICK_MAX_PX = 6;
/**
 * Actions that keep working while gameplay input is off (lobby, Theater Mode, menus): UI keys,
 * and the voice keys, so M still mutes while you watch the big screen or check your mic.
 */
const UI_ACTIONS: ReadonlySet<ActionName> = new Set([
  'back',
  'debug',
  'theater',
  'mute',
  'deafen',
  'pushToTalk',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(type);
  }
  return false;
}

class WebInputSource implements InputSource {
  private codeMap = buildCodeMap(DEFAULT_BINDINGS);
  private readonly heldCodes = new Set<string>();
  private readonly virtualHeld = new Set<ActionName>();
  private held = 0;
  private pressed = 0;
  private released = 0;
  private lookX = 0;
  private lookY = 0;
  private panX = 0;
  private panY = 0;
  private zoom = 0;
  /** Left-drag orbits the camera (off while drawing on a board). */
  private dragLook = true;
  private primaryDragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private clicked = false;
  private primaryDown = false;
  private downAt = { x: 0, y: 0, time: 0 };
  private virtualMoveX = 0;
  private virtualMoveY = 0;
  private gameplayEnabled = true;
  private device: InputDevice = 'keyboard';
  private lastSampleTime = 0;
  private captureResolver: ((code: string) => void) | null = null;
  private readonly actionListeners = new Set<(e: ActionEvent) => void>();
  private readonly deviceListeners = new Set<(d: InputDevice) => void>();
  private readonly disposers: Unsubscribe[] = [];
  private readonly gamepad: GamepadPoller;
  private readonly touch = new TouchTracker();
  private readonly win: WebWindow;
  private readonly target: HTMLElement;
  private readonly onError: (err: unknown) => void;

  constructor(win: WebWindow, target: HTMLElement, onError: (err: unknown) => void) {
    this.win = win;
    this.target = target;
    this.onError = onError;
    this.gamepad = new GamepadPoller(win.navigator);
    this.bind(win, 'keydown', (e) => this.onKey(e, true));
    this.bind(win, 'keyup', (e) => this.onKey(e, false));
    this.bind(win, 'blur', () => this.releaseAll());
    this.bind(target, 'pointerdown', (e) => this.onPointerDown(e));
    this.bind(win, 'pointerup', (e) => this.onPointerUp(e));
    this.bind(win, 'pointermove', (e) => this.onPointerMove(e));
    this.bind(target, 'pointerleave', () => {
      this.pointerActive = false;
    });
    this.bind(target, 'wheel', (e) => this.onWheel(e), { passive: false });
    this.bind(target, 'contextmenu', (e) => e.preventDefault());
    this.bind(win, 'pointercancel', () => this.touch.cancelAll());
  }

  get lastDevice(): InputDevice {
    return this.device;
  }

  setBindings(bindings: InputBindings): void {
    this.codeMap = buildCodeMap(bindings);
    this.releaseAll();
  }

  setGameplayEnabled(enabled: boolean): void {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    if (!enabled) this.releaseAll();
  }

  setDragLook(enabled: boolean): void {
    this.dragLook = enabled;
  }

  onAction(callback: (event: ActionEvent) => void): Unsubscribe {
    this.actionListeners.add(callback);
    return () => this.actionListeners.delete(callback);
  }

  onDeviceChange(callback: (device: InputDevice) => void): Unsubscribe {
    this.deviceListeners.add(callback);
    return () => this.deviceListeners.delete(callback);
  }

  captureNextCode(): Promise<string> {
    return new Promise((resolve) => {
      this.captureResolver = resolve;
    });
  }

  pressVirtual(action: ActionName, pressed: boolean): void {
    if (pressed) this.virtualHeld.add(action);
    else this.virtualHeld.delete(action);
    this.setDevice('touch');
    this.applyAction(action, pressed, 'touch');
  }

  setVirtualMove(x: number, y: number): void {
    this.virtualMoveX = Math.max(-1, Math.min(1, x));
    this.virtualMoveY = Math.max(-1, Math.min(1, y));
    if (x !== 0 || y !== 0) this.setDevice('touch');
  }

  requestPointerLock(): void {
    if (typeof this.target.requestPointerLock !== 'function') return;
    // Pointer lock can be refused (no user gesture, iframe policy); drag-to-look still works.
    const result = this.target.requestPointerLock() as Promise<void> | undefined;
    result?.catch((err: unknown) => this.onError(err));
  }

  sample(out: InputFrame): void {
    const now = this.win.performance.now();
    const dt = this.lastSampleTime === 0 ? 0 : Math.min(0.1, (now - this.lastSampleTime) / 1000);
    this.lastSampleTime = now;
    this.gamepad.poll(dt, (code, pressed) => this.onCode(code, pressed, 'gamepad'));
    const pad = this.gamepad.sample;
    if (pad.active) this.setDevice('gamepad');

    let mx = 0;
    let my = 0;
    const h = this.held;
    if (h & actionBit('moveRight')) mx += 1;
    if (h & actionBit('moveLeft')) mx -= 1;
    if (h & actionBit('moveForward')) my += 1;
    if (h & actionBit('moveBack')) my -= 1;
    const analogX =
      Math.abs(pad.moveX) > Math.abs(this.virtualMoveX) ? pad.moveX : this.virtualMoveX;
    const analogY =
      Math.abs(pad.moveY) > Math.abs(this.virtualMoveY) ? pad.moveY : this.virtualMoveY;
    if (Math.abs(analogX) > Math.abs(mx)) mx = analogX;
    if (Math.abs(analogY) > Math.abs(my)) my = analogY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    const t = this.touch.out;
    const enabled = this.gameplayEnabled;
    const viewH = Math.max(1, this.target.clientHeight);
    out.moveX = enabled ? mx : 0;
    out.moveY = enabled ? my : 0;
    out.lookX = enabled ? this.lookX + pad.lookX + t.lookX : 0;
    out.lookY = enabled ? this.lookY + pad.lookY + t.lookY : 0;
    out.panX = enabled ? this.panX + t.panX / viewH : 0;
    out.panY = enabled ? this.panY + t.panY / viewH : 0;
    out.zoom = enabled ? this.zoom + t.zoom : 0;
    out.held = enabled ? this.held : 0;
    out.pressed = enabled ? this.pressed : 0;
    out.released = this.released;
    out.pointerX = this.pointerX;
    out.pointerY = this.pointerY;
    out.pointerActive = this.pointerActive;
    out.clicked = enabled && (this.clicked || t.tapped);
    if (t.tapped) {
      const rect = this.target.getBoundingClientRect();
      out.pointerX = ((t.tapX - rect.left) / rect.width) * 2 - 1;
      out.pointerY = -(((t.tapY - rect.top) / rect.height) * 2 - 1);
    }
    out.primaryDown = enabled && this.primaryDown;
    out.device = this.device;

    this.pressed = 0;
    this.released = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.panX = 0;
    this.panY = 0;
    this.zoom = 0;
    this.clicked = false;
    this.touch.resetFrame();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.actionListeners.clear();
    this.deviceListeners.clear();
  }

  private bind<K extends keyof HTMLElementEventMap & keyof WindowEventMap>(
    target: Window | HTMLElement,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.disposers.push(() => target.removeEventListener(type, listener, options));
  }

  private setDevice(device: InputDevice): void {
    if (this.device === device) return;
    this.device = device;
    for (const l of this.deviceListeners) l(device);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down && this.captureResolver) {
      e.preventDefault();
      const resolve = this.captureResolver;
      this.captureResolver = null;
      resolve(e.code);
      return;
    }
    if (isEditableTarget(e.target)) {
      if (down && e.code === 'Escape') this.emitAction('back', true, 'keyboard');
      return;
    }
    if (down && e.repeat) {
      if (this.codeMap.has(e.code)) e.preventDefault();
      return;
    }
    const actions = this.codeMap.get(e.code);
    if (actions) e.preventDefault();
    this.setDevice('keyboard');
    this.onCode(e.code, down, 'keyboard');
  }

  private onCode(code: string, down: boolean, device: InputDevice): void {
    // The left button is reserved (click, walk, camera drag): it never becomes a binding.
    if (down && this.captureResolver && isBindableCode(code)) {
      const resolve = this.captureResolver;
      this.captureResolver = null;
      resolve(code);
      return;
    }
    if (down) {
      if (this.heldCodes.has(code)) return;
      this.heldCodes.add(code);
    } else {
      if (!this.heldCodes.delete(code)) return;
    }
    const actions = this.codeMap.get(code);
    if (!actions) return;
    for (const action of actions) {
      const stillHeld = !down && this.isActionHeldByOtherCode(action, code);
      if (!stillHeld) this.applyAction(action, down, device);
    }
  }

  private isActionHeldByOtherCode(action: ActionName, releasedCode: string): boolean {
    if (this.virtualHeld.has(action)) return true;
    for (const code of this.heldCodes) {
      if (code !== releasedCode && this.codeMap.get(code)?.includes(action)) return true;
    }
    return false;
  }

  private applyAction(action: ActionName, down: boolean, device: InputDevice): void {
    const bit = actionBit(action);
    if (down) {
      if ((this.held & bit) === 0) this.pressed |= bit;
      this.held |= bit;
    } else {
      if (this.held & bit) this.released |= bit;
      this.held &= ~bit;
    }
    this.emitAction(action, down, device);
  }

  private emitAction(action: ActionName, pressed: boolean, device: InputDevice): void {
    if (!this.gameplayEnabled && !UI_ACTIONS.has(action) && pressed) return;
    for (const l of this.actionListeners) l({ action, pressed, device });
  }

  private releaseAll(): void {
    for (const code of [...this.heldCodes]) this.onCode(code, false, this.device);
    for (const action of [...this.virtualHeld]) this.pressVirtual(action, false);
    this.primaryDown = false;
    this.virtualMoveX = 0;
    this.virtualMoveY = 0;
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerActive =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.setDevice('touch');
      this.touch.begin(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      return;
    }
    this.setDevice('keyboard');
    this.updatePointer(e);
    if (e.button === 0) {
      this.primaryDown = true;
      this.primaryDragging = false;
      this.downAt = { x: e.clientX, y: e.clientY, time: e.timeStamp };
    }
    // Middle-drag pans the camera; stop the browser's autoscroll.
    if (e.button === 1) e.preventDefault();
    this.onCode(`Mouse${e.button}`, true, 'keyboard');
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touch.end(e.pointerId, e.timeStamp);
      return;
    }
    if (e.button === 0 && this.primaryDown) {
      this.primaryDown = false;
      const dist = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (
        !this.primaryDragging &&
        dist <= CLICK_MAX_PX &&
        e.timeStamp - this.downAt.time <= CLICK_MAX_MS
      ) {
        this.updatePointer(e);
        this.clicked = true;
      }
      this.primaryDragging = false;
    }
    this.onCode(`Mouse${e.button}`, false, 'keyboard');
  }

  /**
   * Mouse camera control: left- or right-drag orbits/looks, middle-drag or Shift+left-drag pans.
   * A left press only becomes a drag after it moves a few pixels, so clicks still click.
   */
  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touch.move(e.pointerId, e.clientX, e.clientY);
      return;
    }
    this.updatePointer(e);
    if (this.primaryDown && !this.primaryDragging && this.dragLook) {
      this.primaryDragging =
        Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > CLICK_MAX_PX;
    }
    const locked = this.win.document.pointerLockElement === this.target;
    const panning = (e.buttons & 4) !== 0 || (this.primaryDragging && e.shiftKey);
    if (panning) {
      const h = Math.max(1, this.target.clientHeight);
      this.panX += e.movementX / h;
      this.panY += e.movementY / h;
    } else if (locked || this.primaryDragging || (this.held & actionBit('lookDrag')) !== 0) {
      this.lookX += e.movementX * MOUSE_LOOK_RADIANS_PER_PX;
      this.lookY += e.movementY * MOUSE_LOOK_RADIANS_PER_PX;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0025;
    this.zoom += e.deltaY * scale;
  }
}

export function createWebInputFactory(
  win: WebWindow,
  onError: (err: unknown) => void,
): InputSourceFactory {
  return { create: (target) => new WebInputSource(win, target, onError) };
}
