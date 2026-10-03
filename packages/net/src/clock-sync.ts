const MAX_SAMPLES = 9;

interface Sample {
  rtt: number;
  offset: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * NTP-style offset between the local monotonic clock and the server clock. Each ping/pong gives
 * `offset = server + rtt / 2 - received`; the estimate is the median offset of the faster half of
 * recent samples, which rejects the ones delayed by queuing.
 */
export class ClockSync {
  private readonly samples: Sample[] = [];
  private estimate = 0;
  private roundTrip = 0;
  private seeded = false;

  /** Server time ≈ local time + offset (ms). */
  get offset(): number {
    return this.estimate;
  }

  /** Median round trip of recent pings (ms). */
  get rtt(): number {
    return this.roundTrip;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** A rough first estimate from a server timestamp, before any ping came back. */
  seed(serverTime: number, receivedAt: number): void {
    if (this.samples.length > 0) return;
    this.estimate = serverTime - receivedAt;
    this.seeded = true;
  }

  /** One exchange: ping sent at `sentAt`, stamped `serverTime`, pong received at `receivedAt`. */
  add(sentAt: number, serverTime: number, receivedAt: number): void {
    const rtt = Math.max(0, receivedAt - sentAt);
    this.samples.push({ rtt, offset: serverTime + rtt / 2 - receivedAt });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    const fastest = [...this.samples]
      .sort((a, b) => a.rtt - b.rtt)
      .slice(0, Math.ceil(this.samples.length / 2));
    this.estimate = median(fastest.map((s) => s.offset));
    this.roundTrip = median(this.samples.map((s) => s.rtt));
  }

  serverNow(localNow: number): number {
    return localNow + (this.synced || this.seeded ? this.estimate : 0);
  }

  reset(): void {
    this.samples.length = 0;
    this.seeded = false;
    this.estimate = 0;
    this.roundTrip = 0;
  }
}
