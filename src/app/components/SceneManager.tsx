"use client";

import { Stats } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";
import {
  defaultParams,
  type SceneParams,
} from "@/slices/Hero/scene-core/params";
import ParallaxRig from "./ParallaxRig";
import ScrollRig from "./ScrollRig";
import Postprocessing from "./PostProcessing";
import { BREAKPOINTS, useBreakpoints } from "../hooks/breakpoints";

const PAGES_COUNT = 8;

export default function SceneHost() {
  const { entries } = useSceneRegistry();
  // ✅ single stable params object that GUI mutates
  const paramsRef = useRef<SceneParams>({ ...defaultParams });
  const { up } = useBreakpoints(BREAKPOINTS);

  const basePos = useMemo(
    () =>
      new THREE.Vector3(
        paramsRef.current.cameraX,
        paramsRef.current.cameraY,
        paramsRef.current.cameraZ,
      ),
    [],
  );

  const baseTarget = useMemo(
    () =>
      new THREE.Vector3(
        paramsRef.current.targetX,
        paramsRef.current.targetY,
        paramsRef.current.targetZ,
      ),
    [],
  );

  const ordered = Object.values(entries)
    .filter((e) => e.active)
    .sort((a, b) => a.priority - b.priority);

  return (
    <>
      {ordered.map((e) => (
        <group key={e.id}>{e.node}</group>
      ))}

      <ScrollRig
        pages={PAGES_COUNT + 1}
        windows={[{ startPage: 7, endPage: 10 }]}
        unit="world"
        // viewportDistancePerWeight={0.065}
        worldDistancePerWeight={260}
        smoothing={0}
        direction={1}
      />

      <Postprocessing selected={[]} />

      {up.md && (
        <ParallaxRig
          basePosition={basePos}
          baseTarget={baseTarget}
          strength={170}
          damp={6}
          targetStrength={0.2}
        />
      )}

      <Stats />
    </>
  );
}
