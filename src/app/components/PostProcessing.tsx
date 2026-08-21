"use client";

import { useSyncExternalStore } from "react";
import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  SMAA,
} from "@react-three/postprocessing";

import {
  onPostBypass,
  postBypassed,
  postBypassedOnServer,
} from "./diagFlags";

export default function PostProcessing() {
  // <Diagnostics />'s bisect toggle. In a production build nothing ever calls
  // `setPostBypassed`, so this reads `false` on the first render and never
  // moves — and the composer below is what it always was.
  const bypassed = useSyncExternalStore(
    onPostBypass,
    postBypassed,
    postBypassedOnServer,
  );

  // <Diagnostics /> takes over the render call while this is out of the frame
  if (bypassed) return null;

  return (
    <EffectComposer multisampling={0} depthBuffer>
      <SMAA />

      <Bloom
        intensity={1.35}
        luminanceThreshold={0.8}
        luminanceSmoothing={0.8}
        mipmapBlur
      />

      <Vignette eskil={false} offset={0.2} darkness={0.7} />
      <Noise premultiply opacity={0.4} />
    </EffectComposer>
  );
}
