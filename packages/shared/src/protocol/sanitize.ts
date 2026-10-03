import { NET } from '../constants.ts';

/**
 * Control characters, zero-width joiners and bidirectional overrides (which can spoof names and
 * messages). Chat is rendered as text everywhere, so this is about readability, not HTML.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Strips unsafe characters, collapses whitespace, trims and caps the length (code points). */
export function sanitizeText(raw: string, max: number): string {
  const clean = raw.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  const points = Array.from(clean);
  return points.length > max ? points.slice(0, max).join('').trimEnd() : clean;
}

/** A chat message ready to broadcast, or null when nothing readable is left. */
export function sanitizeChat(raw: string): string | null {
  const text = sanitizeText(raw, NET.maxChatLength);
  return text.length > 0 ? text : null;
}

/** A display name, or `fallback` when nothing readable is left. */
export function cleanName(raw: string, fallback: string): string {
  const name = sanitizeText(raw, NET.maxNameLength);
  return name.length > 0 ? name : fallback;
}

/** Unambiguous characters for generated codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A fresh 6-character room code. */
export function generateRoomCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** Uppercases user input and drops separators; null unless 4-8 letters or digits remain. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && code.length <= 8 ? code : null;
}
