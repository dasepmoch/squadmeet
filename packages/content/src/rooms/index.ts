import {
  propCatalogSchema,
  resolveRoom,
  roomDataSchema,
  type PropDef,
  type ResolvedRoom,
  type RoomData,
} from '@huddle/shared';
import catalogJson from '../props/catalog.json' with { type: 'json' };

export interface RoomEntry {
  id: string;
  nameKey: string;
  /** Lazy loader so extra rooms are fetched on demand. */
  load(): Promise<unknown>;
}

/** Room registry. Adding a room = adding a JSON file and one entry here (see docs/CONTENT.md). */
export const ROOMS: readonly RoomEntry[] = [
  {
    id: 'boardroom',
    nameKey: 'room.boardroom',
    load: async () => (await import('./boardroom.ts')).default,
  },
];

export const DEFAULT_ROOM_ID = 'boardroom';

let catalogCache: PropDef[] | null = null;

export function propCatalog(): PropDef[] {
  catalogCache ??= propCatalogSchema.parse(catalogJson);
  return catalogCache;
}

export class UnknownRoomError extends Error {
  override name = 'UnknownRoomError';
}

/** Loads, validates and resolves a room by id. */
export async function loadRoom(id: string): Promise<{ data: RoomData; resolved: ResolvedRoom }> {
  const entry = ROOMS.find((r) => r.id === id);
  if (!entry) throw new UnknownRoomError(`Unknown room "${id}"`);
  const data = roomDataSchema.parse(await entry.load());
  return { data, resolved: resolveRoom(data, propCatalog()) };
}
