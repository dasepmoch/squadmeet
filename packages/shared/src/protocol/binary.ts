/**
 * Fixed-layout little-endian binary frames for the high-frequency traffic: the client's own
 * movement (`MOVE`) and the server's position snapshots (`SNAPSHOT`). Everything else is JSON.
 */
export const OP_MOVE = 1;
export const OP_SNAPSHOT = 2;

export const MOVE_FLAG_GROUNDED = 1;
export const MOVE_FLAG_SPRINT = 2;

/** One player's pose on the wire. Speed is horizontal (m/s), yaw in radians. */
export interface WirePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  flags: number;
}

export interface SnapshotEntry extends WirePose {
  slot: number;
}

/** op u8, seq u16, x/y/z f32, yaw u16, speed u8, flags u8. */
export const MOVE_BYTES = 19;
const SNAPSHOT_HEADER = 11;
/** slot u16, x/y/z f32, yaw u16, speed u8, flags u8. */
const ENTRY_BYTES = 18;
/** Snapshots never carry more people than this (keeps frames under the size limit). */
export const MAX_SNAPSHOT_ENTRIES = 512;

const TAU = Math.PI * 2;
const YAW_STEPS = 65536;
const SPEED_SCALE = 20;

function packYaw(yaw: number): number {
  const turns = (((yaw / TAU) % 1) + 1) % 1;
  return Math.round(turns * YAW_STEPS) % YAW_STEPS;
}

function unpackYaw(v: number): number {
  const a = (v / YAW_STEPS) * TAU;
  return a > Math.PI ? a - TAU : a;
}

function packSpeed(speed: number): number {
  return Math.max(0, Math.min(255, Math.round(speed * SPEED_SCALE)));
}

function writePose(view: DataView, at: number, p: WirePose): void {
  view.setFloat32(at, p.x, true);
  view.setFloat32(at + 4, p.y, true);
  view.setFloat32(at + 8, p.z, true);
  view.setUint16(at + 12, packYaw(p.yaw), true);
  view.setUint8(at + 14, packSpeed(p.speed));
  view.setUint8(at + 15, p.flags & 0xff);
}

/** Reads a pose; false when a coordinate is not finite (malformed or hostile input). */
function readPose(view: DataView, at: number, out: WirePose): boolean {
  out.x = view.getFloat32(at, true);
  out.y = view.getFloat32(at + 4, true);
  out.z = view.getFloat32(at + 8, true);
  out.yaw = unpackYaw(view.getUint16(at + 12, true));
  out.speed = view.getUint8(at + 14) / SPEED_SCALE;
  out.flags = view.getUint8(at + 15);
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
}

function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export function encodeMove(
  seq: number,
  pose: WirePose,
  out = new Uint8Array(MOVE_BYTES),
): Uint8Array {
  const view = viewOf(out);
  view.setUint8(0, OP_MOVE);
  view.setUint16(1, seq & 0xffff, true);
  writePose(view, 3, pose);
  return out;
}

/** Decodes a `MOVE` frame into `out`; returns the sequence number, or null when malformed. */
export function decodeMove(data: Uint8Array, out: WirePose): number | null {
  if (data.byteLength !== MOVE_BYTES || data[0] !== OP_MOVE) return null;
  const view = viewOf(data);
  return readPose(view, 3, out) ? view.getUint16(1, true) : null;
}

/** op u8, server time f64 (ms), count u16, then `count` entries. */
export function encodeSnapshot(serverTime: number, entries: readonly SnapshotEntry[]): Uint8Array {
  const n = Math.min(entries.length, MAX_SNAPSHOT_ENTRIES);
  const out = new Uint8Array(SNAPSHOT_HEADER + n * ENTRY_BYTES);
  const view = viewOf(out);
  view.setUint8(0, OP_SNAPSHOT);
  view.setFloat64(1, serverTime, true);
  view.setUint16(9, n, true);
  for (let i = 0; i < n; i++) {
    const e = entries[i] as SnapshotEntry;
    const at = SNAPSHOT_HEADER + i * ENTRY_BYTES;
    view.setUint16(at, e.slot & 0xffff, true);
    writePose(view, at + 2, e);
  }
  return out;
}

/**
 * Decodes a `SNAPSHOT` frame, reusing the entry objects in `out` (resized to the entry count).
 * Returns the server time, or null when malformed. Entries with non-finite poses are dropped.
 */
export function decodeSnapshot(data: Uint8Array, out: SnapshotEntry[]): number | null {
  if (data.byteLength < SNAPSHOT_HEADER || data[0] !== OP_SNAPSHOT) return null;
  const view = viewOf(data);
  const n = view.getUint16(9, true);
  if (n > MAX_SNAPSHOT_ENTRIES || data.byteLength !== SNAPSHOT_HEADER + n * ENTRY_BYTES)
    return null;
  const time = view.getFloat64(1, true);
  if (!Number.isFinite(time)) return null;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const at = SNAPSHOT_HEADER + i * ENTRY_BYTES;
    const e = (out[count] ??= { slot: 0, x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0 });
    e.slot = view.getUint16(at, true);
    if (readPose(view, at + 2, e)) count++;
  }
  out.length = count;
  return time;
}

/** First byte of a binary frame (0 when empty). */
export function binaryOp(data: Uint8Array): number {
  return data.byteLength > 0 ? (data[0] as number) : 0;
}
