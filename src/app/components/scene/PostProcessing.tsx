"use client";

import * as THREE from "three";
import {
  EffectComposer,
  Outline,
  SelectiveBloom,
  Vignette,
  Noise,
  SMAA,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";

type Props = {
  selected: THREE.Object3D[];
};

export default function PostProcessing({ selected }: Props) {
  return (
    <EffectComposer multisampling={0} autoClear={false}>
      <Outline
        selection={selected}
        blendFunction={BlendFunction.ALPHA} // set this to BlendFunction.ALPHA for dark outlines
        edgeStrength={10} // the edge strength
        pulseSpeed={0.0} // a pulse speed. A value of zero disables the pulse effect
        visibleEdgeColor={0xffffff} // the color of visible edges
        hiddenEdgeColor={0xffffff} // the color of hidden edges
        width={4000} // render width
        blur={false} // whether the outline should be blurred
        xRay={false} // indicates whether X-Ray outlines are enabled
      />

      <SMAA />

      <SelectiveBloom
        selectionLayer={1}
        intensity={1.15}
        luminanceThreshold={0.55}
        luminanceSmoothing={0.8}
        mipmapBlur
      />

      <Vignette eskil={false} offset={0.2} darkness={0.7} />
      <Noise premultiply opacity={0.4} />
    </EffectComposer>
  );
}
