"use client";

import { Stats } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";
import { useStore } from "@/app/hooks/store";
import {
  defaultParams,
  type SceneParams,
} from "@/slices/Hero/scene-core/params";
import ParallaxRig from "./ParallaxRig";
import ScrollRig from "./ScrollRig";
import Postprocessing from "./PostProcessing";
import { BREAKPOINTS, useBreakpoints } from "../hooks/breakpoints";

export type CameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

export default function SceneManager() {
  const { entries } = useSceneRegistry();
  // ✅ single stable params object that GUI mutates
  const paramsRef = useRef<SceneParams>({ ...defaultParams });
  const { up } = useBreakpoints(BREAKPOINTS);
  const { outlined } = useStore();

  const poseRef = useRef<CameraPose>({
    position: new THREE.Vector3(
      paramsRef.current.cameraX,
      paramsRef.current.cameraY,
      paramsRef.current.cameraZ,
    ),
    target: new THREE.Vector3(
      paramsRef.current.targetX,
      paramsRef.current.targetY,
      paramsRef.current.targetZ,
    ),
  });

  const ordered = Object.values(entries)
    .filter((e) => e.active)
    .sort((a, b) => a.priority - b.priority);

  return (
    <>
      {ordered.map((e) => (
        <group key={e.id}>{e.node}</group>
      ))}

      <ScrollRig
        windows={[
          {
            window: {
              startVh: 190,
              endVh: 320,
            },
            from: {
              position: [0, 200, 3380], // pose A
              lookAt: [0, 820, 0],
            },
            to: {
              position: [0, -800, 3380], // pose B
              lookAt: [0, -800, 0],
            },
          },
        ]}
        basePoseRef={poseRef}
        smoothing={-25}
        applyToCamera={!up.md}
        priority={0}
      />

      <Postprocessing selected={outlined} />

      {up.md && (
        <ParallaxRig
          poseRef={poseRef}
          strength={170}
          damp={6}
          targetStrength={0.2}
        />
      )}

      <Stats />
    </>
  );
}
