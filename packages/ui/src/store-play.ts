/** The local player's playful state, as the dock and the aim hint show it. */
export interface PlayUi {
  /** What is in hand (a held item id), or null. */
  held: string | null;
  /** "Don't hit me": thrown things pass through you (and you don't throw). */
  shield: boolean;
  /** Paper-plane wing tilt for the next throw, -1 (bank left) .. 1 (bank right). */
  tilt: number;
}

export const INITIAL_PLAY: PlayUi = { held: null, shield: false, tilt: 0 };

/** Things the emote wheel's Hold strip offers (the rest come from the room: coffee, pizza). */
export const WHEEL_ITEMS = ['phone', 'signPlus', 'signAsk', 'signBrb', 'signLove'] as const;
