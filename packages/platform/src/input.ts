import type {
  ActionName,
  InputBindings,
  InputDevice,
  InputFrame,
  Unsubscribe,
} from '@huddle/shared';

export interface ActionEvent {
  action: ActionName;
  pressed: boolean;
  device: InputDevice;
}

/**
 * Unified input source: keyboard, mouse, touch and gamepad all produce the same `InputFrame`
 * of actions. Implementations accumulate events between samples.
 */
export interface InputSource {
  /** Fills `out` with the state accumulated since the previous sample. */
  sample(out: InputFrame): void;
  setBindings(bindings: InputBindings): void;
  /** Disables gameplay input (e.g. while typing in chat); UI action events still flow. */
  setGameplayEnabled(enabled: boolean): void;
  /** Left-drag orbits the camera by default; disable while drawing with the pointer. */
  setDragLook(enabled: boolean): void;
  /** Immediate action events for UI (emote wheel, chat, escape). */
  onAction(callback: (event: ActionEvent) => void): Unsubscribe;
  /** Captures the next pressed key/button code, for key remapping. */
  captureNextCode(): Promise<string>;
  /** Feeds an action from an on-screen control (touch buttons) into the same pipeline. */
  pressVirtual(action: ActionName, pressed: boolean): void;
  /** Analog move from an on-screen joystick, in [-1, 1]. */
  setVirtualMove(x: number, y: number): void;
  /** Requests pointer lock for mouse look, when supported. */
  requestPointerLock(): void;
  readonly lastDevice: InputDevice;
  onDeviceChange(callback: (device: InputDevice) => void): Unsubscribe;
  dispose(): void;
}

export interface InputSourceFactory {
  /** Attaches to the element that receives pointer events (usually the 3D canvas). */
  create(target: HTMLElement): InputSource;
}
