/**
 * Action-based input. Every device (keyboard, mouse, touch, gamepad) maps onto these actions,
 * so gameplay code never looks at raw keys. Bindings are plain data and can be remapped.
 */
export const ACTIONS = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'sprint',
  'jump',
  'interact',
  'throw',
  'emoteWheel',
  'raiseHand',
  'pushToTalk',
  'mute',
  'deafen',
  'chat',
  'focusScreen',
  'theater',
  'debug',
  'back',
  'lookDrag',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'slot6',
  /** Cycles follow/seated -> overview -> free camera. */
  'cameraCycle',
  /** Puts the camera back behind the avatar (or the default framing of the current view). */
  'cameraReset',
  /** Descends in the free camera (jump ascends). */
  'flyDown',
  /** Uses what is in hand: a sip, a bite, the sign held up high. */
  'useItem',
] as const;

export type ActionName = (typeof ACTIONS)[number];

const ACTION_INDEX: ReadonlyMap<ActionName, number> = new Map(ACTIONS.map((a, i) => [a, i]));

export function actionBit(action: ActionName): number {
  const idx = ACTION_INDEX.get(action);
  if (idx === undefined) throw new RangeError(`Unknown action ${action}`);
  return 1 << idx;
}

export function isActionName(value: string): value is ActionName {
  return ACTION_INDEX.has(value as ActionName);
}

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/**
 * One sample of unified input. Pre-allocated and filled in place by an `InputSource`.
 * Pointer coordinates are normalized device coordinates in [-1, 1] (y up).
 */
export interface InputFrame {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  /** Camera pan drag since the previous sample, in viewport heights (x right, y down). */
  panX: number;
  panY: number;
  zoom: number;
  held: number;
  pressed: number;
  released: number;
  pointerX: number;
  pointerY: number;
  pointerActive: boolean;
  /** A primary click or tap happened since the previous sample. */
  clicked: boolean;
  /** True while the primary button is held (used for throw aiming). */
  primaryDown: boolean;
  device: InputDevice;
}

export function createInputFrame(): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    panX: 0,
    panY: 0,
    zoom: 0,
    held: 0,
    pressed: 0,
    released: 0,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    clicked: false,
    primaryDown: false,
    device: 'keyboard',
  };
}

export function isHeld(frame: InputFrame, action: ActionName): boolean {
  return (frame.held & actionBit(action)) !== 0;
}

export function wasPressed(frame: InputFrame, action: ActionName): boolean {
  return (frame.pressed & actionBit(action)) !== 0;
}

export function wasReleased(frame: InputFrame, action: ActionName): boolean {
  return (frame.released & actionBit(action)) !== 0;
}

/** Copies `src` into `dst` without allocating. */
export function copyInputFrame(dst: InputFrame, src: InputFrame): void {
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.lookX = src.lookX;
  dst.lookY = src.lookY;
  dst.panX = src.panX;
  dst.panY = src.panY;
  dst.zoom = src.zoom;
  dst.held = src.held;
  dst.pressed = src.pressed;
  dst.released = src.released;
  dst.pointerX = src.pointerX;
  dst.pointerY = src.pointerY;
  dst.pointerActive = src.pointerActive;
  dst.clicked = src.clicked;
  dst.primaryDown = src.primaryDown;
  dst.device = src.device;
}

/** Clears one-shot fields after a fixed step consumed them. */
export function consumeEdges(frame: InputFrame): void {
  frame.pressed = 0;
  frame.released = 0;
  frame.clicked = false;
  frame.lookX = 0;
  frame.lookY = 0;
  frame.panX = 0;
  frame.panY = 0;
  frame.zoom = 0;
}

/** Keyboard codes follow `KeyboardEvent.code`; mouse buttons are `Mouse0..Mouse4`; gamepad `Pad0..Pad16`. */
export type InputBindings = Record<ActionName, readonly string[]>;

export const DEFAULT_BINDINGS: InputBindings = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight', 'Pad10'],
  jump: ['Space', 'Pad1'],
  interact: ['KeyE', 'Pad0'],
  throw: ['KeyG', 'Pad7'],
  emoteWheel: ['KeyQ', 'Pad3'],
  raiseHand: ['KeyH', 'Pad12'],
  pushToTalk: ['KeyV', 'Pad5'],
  mute: ['KeyM', 'Pad4'],
  deafen: ['KeyN'],
  chat: ['Enter'],
  focusScreen: ['KeyF', 'Pad2'],
  theater: ['KeyT'],
  debug: ['F3'],
  back: ['Escape', 'Pad8'],
  lookDrag: ['Mouse2'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  slot6: ['Digit6'],
  cameraCycle: ['KeyC', 'Pad9'],
  cameraReset: ['KeyR', 'Pad11'],
  flyDown: ['KeyZ', 'Pad6'],
  useItem: ['KeyX', 'Pad13'],
};

/**
 * Codes that can never be bound: the left button clicks, walks and drags the camera, so an
 * action on it would fire on every click (a throw per camera drag, for example).
 */
const RESERVED_CODES: ReadonlySet<string> = new Set(['Mouse0']);

export function isBindableCode(code: string): boolean {
  return code.length > 0 && !RESERVED_CODES.has(code);
}

/**
 * Merges user overrides onto the defaults, ignoring unknown actions and reserved codes. An
 * override made only of reserved codes falls back to the default (an empty one stays empty).
 */
export function mergeBindings(
  base: InputBindings,
  overrides: Partial<Record<string, readonly string[]>>,
): InputBindings {
  const result: Record<string, readonly string[]> = { ...base };
  for (const [action, codes] of Object.entries(overrides)) {
    if (!isActionName(action) || !Array.isArray(codes)) continue;
    const valid = codes.filter((c): c is string => typeof c === 'string');
    const bindable = valid.filter(isBindableCode).slice(0, 4);
    if (bindable.length > 0 || valid.length === 0) result[action] = bindable;
  }
  return result as InputBindings;
}

/** Builds a reverse lookup from device code to the actions bound to it. */
export function buildCodeMap(bindings: InputBindings): Map<string, ActionName[]> {
  const map = new Map<string, ActionName[]>();
  for (const action of ACTIONS) {
    for (const code of bindings[action]) {
      const list = map.get(code);
      if (list) list.push(action);
      else map.set(code, [action]);
    }
  }
  return map;
}
