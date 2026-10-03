/** Runs a one-shot module worker and resolves with its first message. */
export function runWorker<TIn, TOut>(
  create: () => Worker,
  input: TIn,
  transfer: Transferable[] = [],
): Promise<TOut> {
  return new Promise<TOut>((resolve, reject) => {
    const worker = create();
    worker.onmessage = (event: MessageEvent<TOut>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(`Worker failed: ${event.message}`));
      worker.terminate();
    };
    worker.postMessage(input, transfer);
  });
}

export function createTextureWorker(): Worker {
  return new Worker(new URL('./texture-worker.ts', import.meta.url), {
    type: 'module',
    name: 'textures',
  });
}

export function createNavWorker(): Worker {
  return new Worker(new URL('./nav-worker.ts', import.meta.url), { type: 'module', name: 'nav' });
}
