import type { Simulation } from '@huddle/engine';
import { createRng, randomAvatar, type AvatarSpec } from '@huddle/shared';

export const BOT_NAMES = [
  'Raka',
  'Sari',
  'Dimas',
  'Ayu',
  'Bima',
  'Nadia',
  'Tegar',
  'Maya',
  'Joko',
  'Lina',
  'Arif',
  'Putri',
] as const;
export const MAX_BOTS = BOT_NAMES.length;

/**
 * Fills the room with AI office-mates so it feels alive offline: seeded looks and personalities,
 * most of them already seated around the table when you arrive.
 */
export function spawnDemoBots(
  sim: Simulation,
  count: number,
  seed: number,
  setSpec: (id: string, spec: AvatarSpec) => void,
): string[] {
  const rng = createRng(seed);
  const table = sim.room.seats.filter((s) => s.id.startsWith('chair-')).map((s) => s.id);
  for (let i = table.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const a = table[i] as string;
    table[i] = table[j] as string;
    table[j] = a;
  }
  const names: string[] = [...BOT_NAMES];
  const ids: string[] = [];
  const n = Math.max(0, Math.min(MAX_BOTS, Math.floor(count)));
  const seated = Math.ceil(n * 0.7);
  for (let i = 0; i < n; i++) {
    const id = `bot-${i + 1}`;
    const pick = Math.floor(rng.next() * names.length);
    const name = names.splice(pick, 1)[0] ?? `Bot ${i + 1}`;
    setSpec(
      id,
      randomAvatar(() => rng.next()),
    );
    const seatId = i < seated ? table[i] : undefined;
    sim.spawnBot(
      id,
      name,
      Math.floor(rng.next() * 2 ** 31),
      seatId ? { seatId } : { spawnIndex: i },
    );
    ids.push(id);
  }
  return ids;
}

const DEFAULT_BOTS = 7;
/** Fixed seed: the same office-mates (faces, names, habits) greet you every time. */
const BOT_SEED = 20261001;

/**
 * When the offline office-mates come and go: after the walk grid is baked (so they can path
 * around the furniture), never in online rooms. `?bots=N` picks how many.
 */
export class DemoCrew {
  /** Set once the walk grid is installed (or failed to bake). */
  gridReady = false;
  private spawned = false;
  private readonly setSpec: (id: string, spec: AvatarSpec) => void;

  constructor(setSpec: (id: string, spec: AvatarSpec) => void) {
    this.setSpec = setSpec;
  }

  invite(sim: Simulation, search: string): void {
    if (!this.gridReady || this.spawned) return;
    this.spawned = true;
    const requested = Number(new URLSearchParams(search).get('bots') ?? DEFAULT_BOTS);
    spawnDemoBots(
      sim,
      Number.isFinite(requested) ? requested : DEFAULT_BOTS,
      BOT_SEED,
      this.setSpec,
    );
  }

  dismiss(sim: Simulation): void {
    for (const p of sim.view.players.filter((v) => v.isBot)) sim.removePlayer(p.entity);
    this.spawned = false;
  }
}
