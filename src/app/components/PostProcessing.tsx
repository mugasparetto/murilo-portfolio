"use client";

import * as THREE from "three";
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
import { useFrame } from "@react-three/fiber";

type Props = {
  selected: THREE.Object3D[];
};

export default function PostProcessing({ selected }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS);

  const hiRes = useAdaptiveGate({ disableBelow: 30, enableAbove: 31 });

  useFrame((state) => {
    const fps = 1 / state.clock.getDelta();
    if (fps < 30) {
      // lower resolution, disable effects, etc
    }
  });

  return (
    <EffectComposer multisampling={0} autoClear={false}>
      <></>
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
  );
}
