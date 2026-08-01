"use client";

import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  EffectComposer,
  Outline,
  SelectiveBloom,
  Bloom,
  Vignette,
  Noise,
  SMAA,
} from "@react-three/postprocessing";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { useAdaptiveGate } from "@/app/hooks/adaptiveGate";
import ClearStencilPass from "./ClearStencilPass";
import { NAME_LAYER } from "@/slices/Hero/scene/Name";

type Props = {
  selected: THREE.Object3D[];
};

// Renders objects on NAME_LAYER directly on top of the composer's output,
// so they're unaffected by Vignette/Bloom/Noise. Must run after the
// EffectComposer's own render (default renderPriority 1), hence priority 2.
//
// The composer's own depth buffer never reaches the canvas (its final pass
// is a plain color blit), so without help Name would draw over everything
// regardless of what's actually in front of it. We first redo a depth-only
// pass of the normal scene (color writes disabled) to seed the canvas depth
// buffer, then render Name against it so it correctly hides behind nearer
// opaque geometry (eg. the About plane).
function NameLayerOverlay() {
  useFrame(({ gl, scene, camera }) => {
    const prevMask = camera.layers.mask;
    const prevAutoClear = gl.autoClear;
    const ctx = gl.getContext();

    gl.autoClear = false;
    gl.clear(false, true, false);

    ctx.colorMask(false, false, false, false);
    gl.render(scene, camera);
    ctx.colorMask(true, true, true, true);

    camera.layers.set(NAME_LAYER);
    gl.render(scene, camera);

    camera.layers.mask = prevMask;
    gl.autoClear = prevAutoClear;
  }, 2);

  return null;
}

export default function PostProcessing({ selected }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS);

  const hiRes = useAdaptiveGate({ disableBelow: 30, enableAbove: 31 });

  return (
    <>
      <EffectComposer
        multisampling={0}
        autoClear={false}
        stencilBuffer
        depthBuffer
      >
        <ClearStencilPass />
        <>
          {up.md && hiRes && (
            <Outline
              selection={selected}
              edgeStrength={2} // the edge strength
              pulseSpeed={0.0} // a pulse speed. A value of zero disables the pulse effect
              visibleEdgeColor={0xffffff} // the color of visible edges
              hiddenEdgeColor={0xffffff} // the color of hidden edges
              width={1500} // render width
            />
          )}
        </>

        <SMAA />

        <Bloom
          intensity={1.35}
          luminanceThreshold={0.8}
          luminanceSmoothing={0.8}
          mipmapBlur
        />

        {/* <SelectiveBloom
          selectionLayer={1}
          intensity={1.15}
          luminanceThreshold={0.55}
          luminanceSmoothing={0.8}
          mipmapBlur
        /> */}

        <Vignette eskil={false} offset={0.2} darkness={0.7} />
        <Noise premultiply opacity={0.4} />
      </EffectComposer>
      <NameLayerOverlay />
    </>
  );
}
