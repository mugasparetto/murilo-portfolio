"use client";

import { useEffect, useRef } from "react";
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

export default function PostprocessingR3F({ selected }: Props) {
  const outlineRef = useRef<any>(null);

  useEffect(() => {
    const outline = outlineRef.current;
    if (!outline) return;

    const selection = outline.selection;
    if (!selection) return;

    selection.clear();
    selection.enabled = true;

    if (selected && selected.length > 0) {
      selection.set(selected);
    }

    // Debug
    // console.log("Outline selection set:", selected.map((o) => o.type));
  }, [selected]);

  return (
    <EffectComposer multisampling={0} autoClear={false}>
      <Outline
        ref={outlineRef}
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
        selectionLayer={1} // ✅ THIS is the key
        intensity={1.15}
        luminanceThreshold={0.55}
        luminanceSmoothing={0.8}
        mipmapBlur
      />

      {/* optional polish, very Huly-like */}
      <Vignette eskil={false} offset={0.2} darkness={0.7} />
      <Noise premultiply opacity={0.4} />
    </EffectComposer>
  );
}
