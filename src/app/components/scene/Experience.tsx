"use client";

import { OrbitControls, Stats, Html, Text } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";

import { useFrame } from "@react-three/fiber";

import { defaultParams, type SceneParams } from "../scene-core/params";
import { useLilGui } from "../scene-core/useLilGui";

import Postprocessing from "./PostProcessing";
import Terrain from "./Terrain";
import Steps from "./Steps";
import Door from "./Door";
import HumanModel from "./HumanModel";
import Sky from "./Sky";
import { useFluidMaterials } from "./FluidMaterial";
import { useHeroPrimary } from "../../../slices/Hero/hero-context";
import ParallaxRig from "./ParallaxRig";

export default function Experience() {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const { first_name, last_name, tag_line, description } = useHeroPrimary();

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

  const basePos = useMemo(
    () =>
      new THREE.Vector3(
        paramsRef.current.cameraX,
        paramsRef.current.cameraY,
        paramsRef.current.cameraZ
      ),
    []
  );

  const baseTarget = useMemo(
    () =>
      new THREE.Vector3(
        paramsRef.current.targetX,
        paramsRef.current.targetY,
        paramsRef.current.targetZ
      ),
    []
  );

  const applyCameraFromParams = useCallback(() => {
    const p = paramsRef.current;

    // set camera
    camera.position.copy(basePos);
    camera.fov = p.fov;
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(baseTarget);

      // ✅ important: after changing camera/target, call update()
      controls.update();
    } else {
      camera.lookAt(baseTarget);
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

  const textRef = useRef<THREE.Mesh | null>(null);

  // --- billboard both to camera every frame
  useFrame(() => {
    const q = camera.quaternion;
    if (textRef.current) textRef.current.quaternion.copy(q);
  });

  return (
    <>
      <color attach="background" args={[0x000000]} />

      {/* <OrbitControls ref={controlsRef} /> */}

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

      <Suspense fallback={null}>
        <group ref={textRef}>
          <Text
            position={[-1900, 2350, -5750]}
            font="/fonts/Morganite-Black.ttf"
            fontSize={2000}
            color="white"
          >
            {first_name}
          </Text>
          <Text
            position={[2450, 600, -5650]}
            font="/fonts/Morganite-Black.ttf"
            fontSize={2000}
            color="white"
          >
            {last_name}
          </Text>
        </group>
      </Suspense>

      <Html
        position={[-1470, 870, 0]}
        className="w-[24rem] flex flex-col pointer-events-none"
      >
        <span
          className="font-bold text-white lowercase text-2xl relative with-star"
          style={{ wordSpacing: 56 }}
        >
          {tag_line}
        </span>
        <span className="lowercase">{description}</span>
      </Html>

      <Postprocessing selected={outlined} />

      <ParallaxRig
        basePosition={basePos}
        baseTarget={baseTarget}
        strength={170}
        damp={6}
        targetStrength={0.2}
      />

      <Stats />
    </>
  );
}
