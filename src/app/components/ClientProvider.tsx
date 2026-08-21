"use client";

import { useRef } from "react";
import { ReactLenis } from "lenis/react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import SceneManager from "./SceneManager";
import FrameCap from "./FrameCap";

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
        <Canvas
          dpr={[1, 1.5]}
          // <FrameCap /> below owns the loop; see there for why it's capped.
          frameloop="never"
          // Both buffers the composer makes redundant. The scene is drawn
          // into <Postprocessing />'s own render targets and only the final
          // fullscreen pass reaches the default framebuffer, so MSAA there
          // resolves two triangles and antialiases nothing — <SMAA /> is what
          // actually does it. The stencil went with the hero's mask: the name
          // hides behind the door through a `clip-path` cut-out now, and
          // nothing else has ever asked for one.
          gl={{ antialias: false, alpha: false, stencil: false }}
          eventSource={eventSourceRef}
          eventPrefix="client"
          camera={{
            fov: 40,
            near: 50,
            far: 100000,
            position: [0, 200, 3380],
          }}
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
            height: "100vh",
            position: "fixed",
            inset: 0,
          }}
        >
          <FrameCap fps={82} />

          <ScrollYProvider>
            <SceneManager />
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
