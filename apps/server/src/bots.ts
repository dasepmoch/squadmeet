// Load test: `pnpm bots -- --url ws://localhost:8787/ws --room SWARM1 --count 50 --seconds 30`
import { DEFAULT_ROOM_ID, loadRoom } from '@huddle/content';
import { parseArgs } from 'node:util';
import { runSwarm } from './bots/swarm.ts';

// `pnpm bots -- --count 10` forwards the `--` separator; drop it before parsing.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    url: { type: 'string', default: 'ws://localhost:8787/ws' },
    room: { type: 'string', default: 'SWARM1' },
    count: { type: 'string', default: '50' },
    seconds: { type: 'string', default: '30' },
  },
});

const { resolved } = await loadRoom(DEFAULT_ROOM_ID);
const [minX, , minZ] = resolved.bounds.min;
const [maxX, , maxZ] = resolved.bounds.max;
const count = Math.max(1, Number(values.count));
console.log(`${count} bots → ${values.url} room ${values.room} for ${values.seconds}s`);
const stats = await runSwarm({
  url: values.url,
  room: values.room.toUpperCase(),
  count,
  durationMs: Number(values.seconds) * 1000,
  area: { minX: minX + 1, maxX: maxX - 1, minZ: minZ + 1, maxZ: maxZ - 1 },
});
console.log(JSON.stringify(stats, null, 2));
const ok = stats.joined === count && stats.errors.length === 0 && stats.minSeen === count - 1;
console.log(ok ? 'swarm OK' : 'swarm FAILED');
if (stats.errors.some((e) => e.startsWith('full'))) {
  console.log('Room full: start the server with HUDDLE_ROOM_CAPACITY=50 for a 50-bot run.');
}
process.exit(ok ? 0 : 1);
