import type { Unsubscribe } from './socket.ts';

/** Strongly typed synchronous event bus. `Events` maps event names to payload types. */
export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as (payload: never) => void;
    set.add(h);
    return () => set.delete(h);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as (payload: Events[K]) => void)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
