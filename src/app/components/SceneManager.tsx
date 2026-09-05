"use client";

import { Stats } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";
import { setSectionOnScreen } from "@/app/helpers/sectionVisibility";
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

/**
 * Hoisted so the array keeps its identity across renders. <ScrollRig /> memoises
 * a sorted copy and a `Vector3` clone of the first pose off it, and now that the
 * sections publish their own visibility this component re-renders as they come
 * and go — inline, every one of those would rebuild.
 */
const CAMERA_WINDOWS = [
  {
    window: {
      startVh: 115,
      endVh: 250,
    },
    from: HERO_POSE,
    to: ABOUT_POSE,
  },
];

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

  // Everything registered, drawn or not. `active` used to filter here, which
  // unmounted the subtree and made the flag unusable mid-scroll — see
  // {@link setSectionOnScreen} for why it drives `visible` instead.
  const ordered = Object.values(entries).sort(
    (a, b) => a.priority - b.priority,
  );

  // Mirrored out to the per-frame readers that `visible` can't reach: hiding a
  // group stops it being drawn, not the `useFrame`s inside it.
  useEffect(() => {
    for (const e of ordered) setSectionOnScreen(e.name ?? e.id, e.active);
  }, [ordered]);

  return (
    <>
      {ordered.map((e) => (
        // Two groups, not one: <Diagnostics />'s bisect toggle writes `visible`
        // on the *named* one imperatively, and a React-owned prop on the same
        // object would take it back on the next render — which is now every
        // time a section enters or leaves. Nested, the two compose instead of
        // fighting, and either one hides the subtree.
        <group key={e.id} name={e.name ?? e.id}>
          <group visible={e.active}>{e.node}</group>
        </group>
      ))}

      <ScrollRig
        windows={CAMERA_WINDOWS}
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
