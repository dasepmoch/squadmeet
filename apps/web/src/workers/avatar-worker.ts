import { buildAvatarMeshData, meshDataTransferables } from '@huddle/render/avatars';
import { decodeAvatar } from '@huddle/shared';

// Long-lived worker that sculpts avatar meshes on request (the SDF meshing is ~0.5-1 s of math).
self.onmessage = (event: MessageEvent<{ id: number; spec: string }>) => {
  const { id, spec } = event.data;
  try {
    const data = buildAvatarMeshData(decodeAvatar(spec));
    self.postMessage({ id, data }, { transfer: meshDataTransferables(data) });
  } catch (err: unknown) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
