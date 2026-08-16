"use client";

import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  SMAA,
} from "@react-three/postprocessing";

export default function PostProcessing() {
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
