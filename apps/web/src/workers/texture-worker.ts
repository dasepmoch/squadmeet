import {
  bundleTransferables,
  generateTextureBundle,
  type TextureBundleOptions,
} from '@huddle/render/textures';

// Procedural texture generation off the main thread (tens of milliseconds of pure math).
// `postMessage(message, { transfer })` is valid for DedicatedWorkerGlobalScope.
self.onmessage = (event: MessageEvent<TextureBundleOptions>) => {
  const bundle = generateTextureBundle(event.data);
  self.postMessage(bundle, { transfer: bundleTransferables(bundle) });
};
