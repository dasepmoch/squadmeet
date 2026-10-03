import type { SeatArbiter } from '@huddle/engine';
import type { RealtimeClient } from '@huddle/net';

/**
 * Seats decided by the server: claims become `sit` messages and the answer (`seat` naming us,
 * or `seatDenied`) completes the claim. Occupancy is read from the server's roster.
 */
export class NetSeatArbiter implements SeatArbiter {
  onResult: ((seatId: string, playerId: string, granted: boolean) => void) | null = null;
  private readonly client: RealtimeClient;
  private readonly simSelfId: string;
  /** Seat id → simulation id of the local claimant. */
  private readonly pending = new Map<string, string>();

  constructor(client: RealtimeClient, simSelfId: string) {
    this.client = client;
    this.simSelfId = simSelfId;
  }

  requestSeat(seatId: string, playerId: string): void {
    if (playerId !== this.simSelfId || !this.client.send({ t: 'sit', seat: seatId })) {
      this.onResult?.(seatId, playerId, false);
      return;
    }
    this.pending.set(seatId, playerId);
  }

  releaseSeat(_seatId: string, playerId: string): void {
    if (playerId === this.simSelfId) this.client.send({ t: 'stand' });
  }

  occupantOf(seatId: string): string | null {
    for (const p of this.client.players.all()) {
      if (p.seat === seatId) return p.id === this.client.selfId ? this.simSelfId : p.id;
    }
    return null;
  }

  /** The server says who sits at `seatId` now (null = free). */
  seatChanged(seatId: string, netId: string | null): void {
    const who = this.pending.get(seatId);
    if (who === undefined || netId === null) return;
    this.pending.delete(seatId);
    this.onResult?.(seatId, who, netId === this.client.selfId);
  }

  denied(seatId: string): void {
    const who = this.pending.get(seatId);
    if (who === undefined) return;
    this.pending.delete(seatId);
    this.onResult?.(seatId, who, false);
  }

  /** Connection lost: open claims will never be answered. */
  failPending(): void {
    for (const [seatId, who] of this.pending) this.onResult?.(seatId, who, false);
    this.pending.clear();
  }
}
