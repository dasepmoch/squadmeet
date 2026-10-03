/**
 * Lightweight typed ECS. Entities are integers, components are typed stores, queries are cached
 * and updated incrementally so iterating them never allocates.
 */
export type Entity = number;

export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Phantom field carrying `T` (covariant) for inference only. */
  readonly __value?: T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string): ComponentType<T> {
  return { id: nextComponentId++, name };
}

class Query {
  readonly ids: readonly number[];
  readonly entities: Entity[] = [];
  private readonly index = new Map<Entity, number>();

  constructor(ids: readonly number[]) {
    this.ids = ids;
  }

  matches(mask: ReadonlySet<number>): boolean {
    for (const id of this.ids) if (!mask.has(id)) return false;
    return true;
  }

  add(e: Entity): void {
    if (this.index.has(e)) return;
    this.index.set(e, this.entities.length);
    this.entities.push(e);
  }

  remove(e: Entity): void {
    const i = this.index.get(e);
    if (i === undefined) return;
    const last = this.entities.pop() as Entity;
    if (last !== e) {
      this.entities[i] = last;
      this.index.set(last, i);
    }
    this.index.delete(e);
  }
}

export class World {
  private nextEntity = 1;
  private readonly freeList: Entity[] = [];
  private readonly alive = new Set<Entity>();
  private readonly masks = new Map<Entity, Set<number>>();
  private readonly stores = new Map<number, Map<Entity, unknown>>();
  private readonly queries = new Map<string, Query>();

  create(): Entity {
    const e = this.freeList.pop() ?? this.nextEntity++;
    this.alive.add(e);
    this.masks.set(e, new Set());
    return e;
  }

  destroy(e: Entity): void {
    const mask = this.masks.get(e);
    if (!mask) return;
    for (const q of this.queries.values()) q.remove(e);
    for (const id of mask) this.stores.get(id)?.delete(e);
    this.masks.delete(e);
    this.alive.delete(e);
    this.freeList.push(e);
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  add<T>(e: Entity, type: ComponentType<T>, value: T): T {
    const mask = this.masks.get(e);
    if (!mask) throw new Error(`Entity ${e} is not alive`);
    let store = this.stores.get(type.id);
    if (!store) {
      store = new Map();
      this.stores.set(type.id, store);
    }
    store.set(e, value);
    if (!mask.has(type.id)) {
      mask.add(type.id);
      for (const q of this.queries.values()) if (q.matches(mask)) q.add(e);
    }
    return value;
  }

  remove(e: Entity, type: ComponentType<unknown>): void {
    const mask = this.masks.get(e);
    if (!mask?.has(type.id)) return;
    mask.delete(type.id);
    this.stores.get(type.id)?.delete(e);
    for (const q of this.queries.values()) {
      if (q.ids.includes(type.id)) q.remove(e);
    }
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.id)?.get(e) as T | undefined;
  }

  /** Like `get`, but throws when missing. Use inside systems iterating a matching query. */
  req<T>(e: Entity, type: ComponentType<T>): T {
    const store = this.stores.get(type.id);
    if (!store?.has(e)) throw new Error(`Entity ${e} has no ${type.name}`);
    return store.get(e) as T;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.masks.get(e)?.has(type.id) ?? false;
  }

  /** Returns a live, cached array of entities having all given components. Do not mutate it. */
  query(...types: ComponentType<unknown>[]): readonly Entity[] {
    const ids = types.map((t) => t.id).sort((a, b) => a - b);
    const key = ids.join(',');
    let q = this.queries.get(key);
    if (!q) {
      q = new Query(ids);
      for (const [e, mask] of this.masks) if (q.matches(mask)) q.add(e);
      this.queries.set(key, q);
    }
    return q.entities;
  }

  /** First entity matching the query, if any. */
  first(...types: ComponentType<unknown>[]): Entity | undefined {
    return this.query(...types)[0];
  }
}
