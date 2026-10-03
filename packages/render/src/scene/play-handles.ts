/** One line of the hoop scoreboard. */
export interface ScoreRow {
  name: string;
  points: number;
  /** Accent color (CSS) of the player. */
  color: string;
  /** The viewer's own line (highlighted). */
  self: boolean;
}

export interface HoopHandle {
  /** A ball dropped through: the net ripples (render clock). */
  swish(time: number): void;
}

export interface ScoreboardHandle {
  draw(rows: readonly ScoreRow[]): void;
}

/** Live pieces of the playful props a room built (hoop nets, scoreboards). */
export interface PlayHandles {
  readonly hoops: Map<string, HoopHandle>;
  readonly scoreboards: ScoreboardHandle[];
}

export function createPlayHandles(): PlayHandles {
  return { hoops: new Map(), scoreboards: [] };
}
