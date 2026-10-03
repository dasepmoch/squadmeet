import { hashString } from '@huddle/shared';

/** Name tag / chat accents, stable per player id. */
const ACCENTS = [
  '#8D6BFF',
  '#33D6C1',
  '#FFB547',
  '#FF6F91',
  '#5CC8FF',
  '#B6E35A',
  '#FF8A4C',
  '#C08BFF',
  '#4FE0A0',
  '#FFD166',
];

export function accentFor(id: string): string {
  return ACCENTS[hashString(id) % ACCENTS.length] as string;
}
