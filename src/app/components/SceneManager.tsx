"use client";

import { Stats } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";
import {
  defaultParams,
  type SceneParams,
} from "@/slices/Hero/scene-core/params";
import Diagnostics from "./Diagnostics";
import ParallaxRig from "./ParallaxRig";
import ScrollRig from "./ScrollRig";
import { ABOUT_POSE, HERO_POSE } from "./poses";
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
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });

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

  // the `parallax` of the pose <ScrollRig /> is holding, so <ParallaxRig />
  // sways as much as the section being looked at wants
  const parallaxIntensityRef = useRef(1);

  const ordered = Object.values(entries)
    .filter((e) => e.active)
    .sort((a, b) => a.priority - b.priority);

  return (
    <>
      {ordered.map((e) => (
        <group key={e.id} name={e.name ?? e.id}>
          {e.node}
        </group>
      ))}

      <ScrollRig
        windows={[
          {
            window: {
              startVh: 115,
              endVh: 250,
            },
            from: HERO_POSE,
            to: ABOUT_POSE,
          },
        ]}
        basePoseRef={poseRef}
        intensityRef={parallaxIntensityRef}
        smoothing={-25}
        applyToCamera={!up.md}
        priority={0}
      />

      <Postprocessing />

      {up.md && (
        <ParallaxRig
          poseRef={poseRef}
          strength={100}
          damp={4}
          targetStrength={0.3}
          intensityRef={parallaxIntensityRef}
        />
      )}

      {/* both are development instrumentation — `<Stats />` was shipping a
          DOM panel and a per-frame canvas redraw to production */}
      {process.env.NODE_ENV !== "production" && (
        <>
          <Stats />
          {/* <Diagnostics /> */}
        </>
      )}
    </>
  );
}
