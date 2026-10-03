/** Simulation and networking constants shared by client, server and tests. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Max fixed steps per rendered frame before we drop time (spiral-of-death guard). */
export const MAX_SUBSTEPS = 5;

export const PLAYER = {
  radius: 0.28,
  /** Total standing height of the collision capsule (meters). */
  height: 1.62,
  walkSpeed: 2.7,
  sprintSpeed: 5.2,
  acceleration: 22,
  airControl: 0.35,
  gravity: 20,
  jumpVelocity: 4.4,
  /** Server-side tolerance multiplier on sprint speed before a move is rejected. */
  speedTolerance: 1.6,
  eyeHeight: 1.48,
  interactRange: 1.9,
} as const;

export const NET = {
  /** 2: voice, screen sharing and WebRTC signaling. 3: the playful layer (baskets, held items). */
  protocolVersion: 3,
  /** Client movement send rate. */
  moveHz: 20,
  /** Server snapshot broadcast rate. */
  snapshotHz: 20,
  /** Remote interpolation delay. */
  interpolationDelayMs: 100,
  /** Max time we extrapolate past the newest snapshot. */
  extrapolationCapMs: 250,
  /** Reconnect grace window in which a session can be resumed with the same seat and state. */
  resumeGraceMs: 45_000,
  /** Session descriptions with audio and video sections run to 10-20 KB. */
  maxMessageBytes: 64 * 1024,
  maxChatLength: 280,
  maxNameLength: 24,
  chatHistory: 60,
} as const;

export const ROOM_LIMITS = {
  defaultCapacity: 24,
  maxCapacity: 50,
  /** Mesh WebRTC practical cap; larger rooms should use the LiveKit transport. */
  meshCap: 8,
} as const;
