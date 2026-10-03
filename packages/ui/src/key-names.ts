import type { Translate } from './store.ts';

/** Keyboard codes whose readable name isn't just the code with its prefix trimmed. */
const KEYS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left Meta',
  MetaRight: 'Right Meta',
  Escape: 'Esc',
  CapsLock: 'Caps Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Delete: 'Del',
  ContextMenu: 'Menu',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

/** Standard gamepad mapping, Xbox-style names. */
const PAD = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'LS',
  'RS',
  '↑',
  '↓',
  '←',
  '→',
  'Home',
];

/** Mouse buttons past the left one (which is never bindable), as translation keys. */
const MOUSE = [
  'keys.click',
  'keys.mouseMiddle',
  'keys.mouseRight',
  'keys.mouseBack',
  'keys.mouseForward',
];

/**
 * A binding code (`KeyboardEvent.code`, `Mouse0..4`, `Pad0..16`) as a short readable keycap
 * label: `KeyW` → `W`, `ArrowUp` → `↑`, `Pad7` → `Pad RT`, `Mouse2` → `Right click`.
 */
export function keyName(code: string, t: Translate): string {
  const known = KEYS[code];
  if (known) return known;
  const key = /^(?:Key|Digit)(.)$/.exec(code);
  if (key) return key[1] ?? code;
  const num = /^Numpad(\d)$/.exec(code);
  if (num) return `Num ${num[1] ?? ''}`;
  const pad = /^Pad(\d+)$/.exec(code);
  if (pad) return `Pad ${PAD[Number(pad[1])] ?? pad[1] ?? ''}`;
  const mouse = /^Mouse(\d)$/.exec(code);
  if (mouse) {
    const word = MOUSE[Number(mouse[1])];
    return word ? t(word) : `Mouse ${mouse[1] ?? ''}`;
  }
  return code;
}
