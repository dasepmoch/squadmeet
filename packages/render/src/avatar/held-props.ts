import { ACTION_LENGTH, LOWER_HAND_SECONDS } from './emotes.ts';

export interface ActionSlot {
  id: string;
  startedAt: number;
}

/**
 * The upper-body action to show this frame: finished emotes end, a raised hand comes back up
 * after an emote and eases down when lowered.
 */
export function resolveAction(
  current: ActionSlot | null,
  handRaised: boolean,
  time: number,
): ActionSlot | null {
  let a = current;
  if (
    a &&
    a.id !== 'raiseHand' &&
    a.id !== 'lowerHand' &&
    time - a.startedAt > (ACTION_LENGTH[a.id] ?? 2) + 0.35
  )
    a = null;
  if (a?.id === 'lowerHand' && time - a.startedAt > LOWER_HAND_SECONDS) a = null;
  if (handRaised) {
    if (!a || a.id === 'lowerHand') a = { id: 'raiseHand', startedAt: time };
  } else if (a?.id === 'raiseHand') {
    a = { id: 'lowerHand', startedAt: time };
  }
  return a;
}
