"use client";

import { RefObject, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import Experience from "./Experience";

import { ScrollProgressProvider } from "@/app/hooks/ScrollProgress";

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
};

export default function Scene({ scrollRef }: Props) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      camera={{ fov: 40, near: 50, far: 100000, position: [0, 200, 3380] }}
      onCreated={({ gl }) => {
        // Make colors match the classic "raw" look more closely
        gl.toneMapping = THREE.NoToneMapping; // ✅ prevents whites/yellows being compressed
        gl.toneMappingExposure = 1.0;

        // Ensure output transform is correct & consistent
        // (In modern three, this is preferred over outputEncoding)
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <ScrollProgressProvider
        elementTop={useRef(0)}
        elementHeight={useRef(0)}
        elementRef={scrollRef}
      >
        <Experience />
      </ScrollProgressProvider>
    </Canvas>
  );
}
