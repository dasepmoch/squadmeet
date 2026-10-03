import type { PlayerInfo, ServerMessage, SnapshotEntry, WirePose } from '@huddle/shared';
import { PoseBuffer } from './interpolation.ts';

/**
 * Everyone in the room as the server describes them: info by id, the slot → id mapping used by
 * binary snapshots, and an interpolation buffer per remote player.
 */
export class NetPlayers {
  private readonly infos = new Map<string, PlayerInfo>();
  private readonly bySlot = new Map<number, string>();
  private readonly buffers = new Map<string, PoseBuffer>();

  /** Replaces everything with the `welcome` roster; positions seed the buffers at `time`. */
  reset(list: readonly PlayerInfo[], time: number): void {
    this.infos.clear();
    this.bySlot.clear();
    this.buffers.clear();
    for (const p of list) this.add(p, time);
  }

  get(id: string): PlayerInfo | undefined {
    return this.infos.get(id);
  }

  all(): IterableIterator<PlayerInfo> {
    return this.infos.values();
  }

  get size(): number {
    return this.infos.size;
  }

  /** Keeps the roster in step with membership and profile events. */
  apply(msg: ServerMessage, time: number): void {
    switch (msg.t) {
      case 'joined':
        this.add(msg.player, time);
        return;
      case 'left': {
        const p = this.infos.get(msg.id);
        if (p) this.bySlot.delete(p.slot);
        this.infos.delete(msg.id);
        this.buffers.delete(msg.id);
        return;
      }
      case 'away':
        this.patch(msg.id, { away: msg.away });
        return;
      case 'profile':
        this.patch(msg.id, { name: msg.name, avatar: msg.avatar });
        return;
      case 'hand':
        this.patch(msg.id, { hand: msg.raised ? msg.at : null });
        return;
      case 'voice':
        this.patch(msg.id, { muted: msg.muted, deafened: msg.deafened });
        return;
      case 'hold':
        this.patch(msg.id, { held: msg.item });
        return;
      case 'pickup':
        this.patch(msg.id, { held: 'plane' });
        return;
      case 'shield':
        this.patch(msg.id, { shield: msg.on });
        return;
      case 'score':
        this.patch(msg.id, { points: msg.total });
        return;
      case 'scoreReset':
        for (const p of this.infos.values()) p.points = 0;
        return;
      case 'seat':
        for (const p of this.infos.values()) if (p.seat === msg.seat) p.seat = null;
        if (msg.id) this.patch(msg.id, { seat: msg.seat });
        return;
      default:
        return;
    }
  }

  /** Feeds a decoded snapshot into the buffers (the own slot is skipped). */
  pushSnapshot(time: number, entries: readonly SnapshotEntry[], selfSlot: number): void {
    for (const e of entries) {
      if (e.slot === selfSlot) continue;
      const id = this.bySlot.get(e.slot);
      if (id !== undefined) this.buffers.get(id)?.push(time, e);
    }
  }

  /** Interpolated pose of `id` at server time `t`; false without data. */
  pose(id: string, t: number, out: WirePose, extrapolationCapMs: number): boolean {
    return this.buffers.get(id)?.sample(t, out, extrapolationCapMs) ?? false;
  }

  private add(p: PlayerInfo, time: number): void {
    const prev = this.infos.get(p.id);
    if (prev) this.bySlot.delete(prev.slot);
    this.infos.set(p.id, { ...p });
    this.bySlot.set(p.slot, p.id);
    const buffer = new PoseBuffer();
    buffer.push(time, { ...p.pos, yaw: p.yaw, speed: 0, flags: 1 });
    this.buffers.set(p.id, buffer);
  }

  private patch(id: string, patch: Partial<PlayerInfo>): void {
    const p = this.infos.get(id);
    if (p) Object.assign(p, patch);
  }
}
