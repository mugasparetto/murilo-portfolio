"use client";

import { useRef } from "react";
import { ReactLenis } from "lenis/react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import SceneManager from "./SceneManager";

import { ScrollYProvider } from "@/app/hooks/ScrollY";
import { SceneRegistryProvider } from "@/app/hooks/SceneRegistry";

export default function ClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const eventSourceRef = useRef<HTMLDivElement>(null);

  return (
    <ReactLenis
      root
      options={{
        lerp: 0.07,
        smoothWheel: true,
        autoRaf: false,
      }}
    >
      <SceneRegistryProvider>
        {/* Fixed global canvas */}
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true }}
          eventSource={eventSourceRef}
          eventPrefix="client"
          camera={{ fov: 40, near: 50, far: 100000, position: [0, 200, 3380] }}
          onCreated={({ gl }) => {
            // Make colors match the classic "raw" look more closely
            gl.toneMapping = THREE.NoToneMapping; // ✅ prevents whites/yellows being compressed
            gl.toneMappingExposure = 1.0;

            // Ensure output transform is correct & consistent
            // (In modern three, this is preferred over outputEncoding)
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          style={{
            width: "100%",
            height: "100%",
            position: "fixed",
            inset: 0,
          }}
        >
          <ScrollYProvider>
            <SceneManager documentRef={eventSourceRef} />
          </ScrollYProvider>
        </Canvas>

        {/* Normal DOM scroller on top */}
        <main ref={eventSourceRef} style={{ position: "relative" }}>
          {children}
        </main>
      </SceneRegistryProvider>
    </ReactLenis>
  );
}
