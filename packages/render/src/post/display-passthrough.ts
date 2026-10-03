import { BlendFunction, Effect } from 'postprocessing';

/**
 * Restores display pixels after tone mapping and grading. Displays write alpha 0 into the scene
 * buffer (everything else writes 1), so this effect swaps in the untouched scene color there:
 * shared slides show their exact colors and crisp black text, while bloom from the display still
 * spills softly onto the bezel and wall around it. MSAA-resolved edges blend smoothly.
 */
const FRAGMENT = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 sceneColor = texture2D(inputBuffer, uv);
  float display = clamp(1.0 - sceneColor.a, 0.0, 1.0);
  outputColor = vec4(mix(inputColor.rgb, sceneColor.rgb, display), 1.0);
}`;

export class DisplayPassthroughEffect extends Effect {
  constructor() {
    super('DisplayPassthroughEffect', FRAGMENT, { blendFunction: BlendFunction.SRC });
  }
}
