import * as THREE from "three";
import { useMemo } from "react";
import { Pass } from "postprocessing";

/**
 * Clears ONLY the stencil buffer on the composer buffers each frame.
 * This lets you keep EffectComposer autoClear={false} (for Outline),
 * while preventing masks from "sticking" when scrolling back.
 */
class ClearStencilPassImpl extends Pass {
  constructor() {
    super("ClearStencilPass");
    // Important: this pass doesn't render a fullscreen quad and doesn't need buffer swapping
    this.needsSwap = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ) {
    const ctx = renderer.getContext();
    const prev = renderer.getRenderTarget();

    ctx.clearStencil(0);

    // Clear stencil in BOTH buffers to be safe (composer ping-pongs)
    renderer.setRenderTarget(inputBuffer);
    renderer.clear(false, false, true);

    renderer.setRenderTarget(outputBuffer);
    renderer.clear(false, false, true);

    renderer.setRenderTarget(prev);
  }
}

export default function ClearStencilPass() {
  const pass = useMemo(() => new ClearStencilPassImpl(), []);
  return <primitive object={pass} />;
}
