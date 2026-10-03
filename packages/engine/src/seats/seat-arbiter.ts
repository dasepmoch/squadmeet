/**
 * Seat claims are arbitrated outside the simulation (by the server when online). Results arrive
 * asynchronously and are applied at the next fixed step, keeping the simulation deterministic.
 */
export interface SeatArbiter {
  requestSeat(seatId: string, playerId: string): void;
  releaseSeat(seatId: string, playerId: string): void;
  occupantOf(seatId: string): string | null;
  /** Set by the simulation. Called when a request is granted or denied. */
  onResult: ((seatId: string, playerId: string, granted: boolean) => void) | null;
}

/** Offline arbiter: first come, first served within this client (local player and bots). */
export class LocalSeatArbiter implements SeatArbiter {
  onResult: ((seatId: string, playerId: string, granted: boolean) => void) | null = null;
  private readonly occupants = new Map<string, string>();

  requestSeat(seatId: string, playerId: string): void {
    const current = this.occupants.get(seatId);
    const granted = current === undefined || current === playerId;
    if (granted) {
      for (const [id, who] of this.occupants) if (who === playerId) this.occupants.delete(id);
      this.occupants.set(seatId, playerId);
    }
    this.onResult?.(seatId, playerId, granted);
  }

  releaseSeat(seatId: string, playerId: string): void {
    if (this.occupants.get(seatId) === playerId) this.occupants.delete(seatId);
  }

  occupantOf(seatId: string): string | null {
    return this.occupants.get(seatId) ?? null;
  }

  /** Test/offline helper: mark a seat as taken by someone else. */
  occupyForOther(seatId: string, playerId: string): void {
    this.occupants.set(seatId, playerId);
  }
}

/**
 * Forwards to a swappable arbiter, so a simulation created offline can go online later (the
 * local arbiter while alone, the server's once joined).
 */
export class SwitchableSeatArbiter implements SeatArbiter {
  onResult: ((seatId: string, playerId: string, granted: boolean) => void) | null = null;
  private target: SeatArbiter;

  constructor(initial: SeatArbiter = new LocalSeatArbiter()) {
    this.target = this.adopt(initial);
  }

  get current(): SeatArbiter {
    return this.target;
  }

  use(next: SeatArbiter): void {
    if (this.target !== next) this.target.onResult = null;
    this.target = this.adopt(next);
  }

  requestSeat(seatId: string, playerId: string): void {
    this.target.requestSeat(seatId, playerId);
  }

  releaseSeat(seatId: string, playerId: string): void {
    this.target.releaseSeat(seatId, playerId);
  }

  occupantOf(seatId: string): string | null {
    return this.target.occupantOf(seatId);
  }

  private adopt(a: SeatArbiter): SeatArbiter {
    a.onResult = (seatId, playerId, granted) => this.onResult?.(seatId, playerId, granted);
    return a;
  }
}
