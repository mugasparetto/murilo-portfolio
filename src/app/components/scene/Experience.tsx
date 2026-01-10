"use client";

import { OrbitControls, Stats } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultParams, type SceneParams } from "../scene-core/params";
import { useLilGui } from "../scene-core/useLilGui";

import Postprocessing from "./PostProcessing";
import Terrain from "./Terrain";
import Steps from "./Steps";
import Door from "./Door";
import HumanModel from "./HumanModel";
import Sky from "./Sky";

export default function Experience() {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  // ✅ single stable params object that GUI mutates
  const paramsRef = useRef<SceneParams>({ ...defaultParams });

  // ✅ just forces rerender when GUI changes values
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  // outline selection
  const [outlined, setOutlined] = useState<THREE.Object3D[]>([]);
  const handleMeshesReady = useCallback(
    (meshes: THREE.Object3D[]) => setOutlined(meshes),
    []
  );

  const applyCameraFromParams = useCallback(() => {
    const p = paramsRef.current;

    // set camera
    camera.position.set(p.cameraX, p.cameraY, p.cameraZ);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();

    // set orbit target (crucial)
    const target = new THREE.Vector3(p.targetX, p.targetY, p.targetZ);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(target);

      // ✅ important: after changing camera/target, call update()
      controls.update();
    } else {
      camera.lookAt(target);
    }
  }, [camera]);

  // apply on mount
  useEffect(() => {
    applyCameraFromParams();
  }, [applyCameraFromParams]);

  // GUI wiring
  useLilGui(paramsRef.current, {
    onCameraChange: () => {
      applyCameraFromParams();
      forceRender();
    },
    onRebuildTerrain: () => {
      forceRender();
    },
    onStepsChange: () => {
      forceRender();
    },
    onDoorChange: () => {
      forceRender();
    },
    onGroupChange: () => {
      forceRender();
    },
  });

  const p = paramsRef.current;

  const groupPosition = useMemo<[number, number, number]>(
    () => [0, p.groupY, 0],
    [p.groupY]
  );

  return (
    <>
      <color attach="background" args={[0x000000]} />

      <OrbitControls ref={controlsRef} />

      <group position={groupPosition}>
        <Terrain params={p} tiles={3} />
        <Steps params={p} />
        <Door params={p} />
        <HumanModel onMeshesReady={handleMeshesReady} />
      </group>

      <Sky />

      <Postprocessing selected={outlined} />
      <Stats />
    </>
  );
}
