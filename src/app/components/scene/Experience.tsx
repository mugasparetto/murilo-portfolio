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
import { useFluidMaterials } from "./FluidMaterial";

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

  useEffect(() => {
    camera.layers.enable(1);
    camera.layers.enable(0);
  }, [camera]);

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
    onFluidChange: () => {
      forceRender();
    },
  });

  const p = paramsRef.current;

  const pointerUvRef = useRef<THREE.Vector2 | null>(null);
  const pointerActiveRef = useRef(false);

  const { displayMat, fluidTextureRef } = useFluidMaterials({
    config: {
      brushSize: p.brushSize,
      brushStrength: p.brushStrength,
      distortionAmount: p.distortionAmount,
      fluidDecay: p.fluidDecay,
      trailLength: p.trailLength,
      stopDecay: p.stopDecay,
      color1: p.color1,
      color2: p.color2,
      color3: p.color3,
      color4: p.color4,
      colorIntensity: p.colorIntensity,
      softness: p.softness,
    },
    simWidth: 512,
    simHeight: 1024,
    pointerUvRef,
    pointerActiveRef,
  });

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
        <Steps params={p} doorFluidTextureRef={fluidTextureRef} />
        <Door
          params={p}
          displayMat={displayMat}
          pointerUvRef={pointerUvRef}
          pointerActiveRef={pointerActiveRef}
        />
        <HumanModel onMeshesReady={handleMeshesReady} />
      </group>

      <Sky />

      <Postprocessing selected={outlined} />
      <Stats />
    </>
  );
}
