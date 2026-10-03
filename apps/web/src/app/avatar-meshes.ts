import type { AvatarMeshData } from '@huddle/render/avatars';
import { encodeAvatar, type AvatarSpec, type Logger } from '@huddle/shared';

interface Job {
  id: number;
  spec: string;
  resolve: (data: AvatarMeshData) => void;
  reject: (err: Error) => void;
}

const CACHE_LIMIT = 32;

/**
 * Worker pool that sculpts avatar meshes off the main thread, with an LRU cache keyed by the
 * encoded spec. The local player's avatar can jump the queue so it appears first.
 */
export class AvatarMeshService {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private readonly cache = new Map<string, Promise<AvatarMeshData>>();
  private readonly log: Logger;
  private seq = 1;

  constructor(
    log: Logger,
    size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2)),
  ) {
    this.log = log;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../workers/avatar-worker.ts', import.meta.url), {
        type: 'module',
        name: `avatars-${i}`,
      });
      w.onmessage = (event: MessageEvent<{ id: number; data?: AvatarMeshData; error?: string }>) =>
        this.finish(w, event.data);
      w.onerror = (event) => this.fail(w, new Error(`Avatar worker failed: ${event.message}`));
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** Mesh data for a spec (shared across avatars with the same look). */
  build(spec: AvatarSpec, priority = false): Promise<AvatarMeshData> {
    const key = encodeAvatar(spec);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const promise = new Promise<AvatarMeshData>((resolve, reject) => {
      const job: Job = { id: this.seq++, spec: key, resolve, reject };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
    promise.catch(() => this.cache.delete(key));
    this.cache.set(key, promise);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return promise;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const job of this.queue) job.reject(new Error('Avatar service disposed'));
    this.queue.length = 0;
    this.running.clear();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      if (!w || !job) break;
      this.running.set(w, job);
      w.postMessage({ id: job.id, spec: job.spec });
    }
  }

  private finish(w: Worker, msg: { id: number; data?: AvatarMeshData; error?: string }): void {
    const job = this.running.get(w);
    this.running.delete(w);
    this.idle.push(w);
    if (job && job.id === msg.id) {
      if (msg.data) {
        this.log.debug('avatar sculpted', { ms: msg.data.ms });
        job.resolve(msg.data);
      } else {
        job.reject(new Error(msg.error ?? 'avatar build failed'));
      }
    }
    this.pump();
  }

  private fail(w: Worker, err: Error): void {
    const job = this.running.get(w);
    this.running.delete(w);
    this.idle.push(w);
    job?.reject(err);
    this.pump();
  }
}
