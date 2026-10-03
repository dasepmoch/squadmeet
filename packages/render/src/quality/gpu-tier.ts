import type { QualityLevel } from './presets.ts';

export interface GpuInfo {
  renderer: string;
  vendor: string;
  tier: QualityLevel;
  reason: string;
}

/**
 * Heuristic GPU tier from the unmasked renderer string. Only a starting point: the runtime
 * auto-scaler corrects it from measured frame times.
 */
export function detectGpuTier(
  gl: WebGL2RenderingContext,
  mobile: boolean,
  memoryGb: number | null,
): GpuInfo {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  const vendor = String(
    ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  );
  const r = renderer.toLowerCase();
  const pick = (tier: QualityLevel, reason: string): GpuInfo => ({
    renderer,
    vendor,
    tier,
    reason,
  });
  if (mobile) {
    if (/apple gpu|adreno \(tm\) (7|8)\d\d|mali-g7[1-9]|mali-g[89]\d0|immortalis/.test(r))
      return pick('medium', 'recent mobile GPU');
    return pick('low', 'mobile GPU');
  }
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(r))
    return pick('low', 'software rendering');
  if (/rtx|radeon rx [67]\d{3}|radeon pro|geforce gtx 1[06-9]|arc a[57]/.test(r))
    return pick('ultra', 'discrete GPU');
  if (/apple m[1-9]\s*ultra/.test(r)) return pick('ultra', 'Apple silicon Ultra');
  if (/apple m[1-9]\s*(pro|max)/.test(r)) return pick('high', 'Apple silicon Pro/Max');
  // Base M-series GPUs drive Retina panels: Medium holds 60 fps with every person in the room.
  if (/apple m[1-9]|apple gpu/.test(r)) return pick('medium', 'Apple silicon');
  if (/iris\(r\) xe|iris xe|radeon(tm)? (graphics|780m|760m|680m)/.test(r))
    return pick('medium', 'modern integrated GPU');
  if (/intel|uhd|hd graphics/.test(r)) return pick('low', 'older integrated GPU');
  if (memoryGb !== null && memoryGb <= 4) return pick('low', 'low device memory');
  return pick('medium', 'unknown GPU');
}
