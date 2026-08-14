"use client";

import { OrbitControls, Stats } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  RefObject,
} from "react";

import { defaultParams, type SceneParams } from "../scene-core/params";
import { useLilGui } from "../scene-core/useLilGui";
import {
  createDoorProjection,
  type DoorProjection,
} from "../scene-core/doorProjection";

import Terrain from "./Terrain";
import Mountains from "./Mountains";
import Steps from "./Steps";
import Door from "./Door";
import HumanModel from "./HumanModel";
import Sky from "./Sky";
import HumanDestruction from "./HumanModelDestruction";
import { useFluidMaterials } from "@/app/components/FluidMaterial";

import { NameDriver } from "./Name";
import { HeadlineDriver } from "./Headline";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import CircularText from "./CircularText";

type Props = {
  scrollRef: RefObject<HTMLDivElement | null>;
};

export default function Scene({ scrollRef }: Props) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });

  // ✅ single stable params object that GUI mutates
  const paramsRef = useRef<SceneParams>({ ...defaultParams });

  // ✅ just forces rerender when GUI changes values
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  useEffect(() => {
    camera.layers.enable(2);
    camera.layers.enable(1);
    camera.layers.enable(0);
  }, [camera]);

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

  const applyCameraFromParams = useCallback(() => {
    const p = paramsRef.current;

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      // set camera
      camera.position.copy(basePos);
      perspective.fov = p.fov;
      perspective.updateProjectionMatrix();

      const controls = controlsRef.current;
      if (controls) {
        controls.target.copy(baseTarget);
      } else {
        camera.lookAt(baseTarget);
      }
    }
  }, [camera, basePos]);

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
    onRebuildMountain: () => {
      forceRender();
    },
  });

  const p = paramsRef.current;

  // <Door /> writes into this every frame rather than replacing it, so the
  // fluid sim reads a stable object and nothing allocates per pointer event
  const pointerUvRef = useRef<THREE.Vector2 | null>(new THREE.Vector2());
  const pointerActiveRef = useRef(false);

  // <Door /> fills this in every frame, <Steps /> reflects it
  const doorProjectionRef = useRef<DoorProjection>(createDoorProjection());

  const { displayMat } = useFluidMaterials({
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
    () => [0, !up.md ? -250 : p.groupY, 0],
    [p.groupY, up.md],
  );

  const sceneRef = useRef<THREE.Object3D | null>(null);

  return (
    <>
      <color attach="background" args={[0x000000]} />

      {/* <OrbitControls ref={controlsRef} /> */}
      <group ref={sceneRef}>
        <group position={groupPosition}>
          <Terrain
            params={p}
            doorMat={displayMat}
            doorProjectionRef={doorProjectionRef}
            tiles={8}
          />
          <Mountains params={p} />
          <Steps
            params={p}
            doorMat={displayMat}
            doorProjectionRef={doorProjectionRef}
            scrollWindow={{ startVh: 75, endVh: 150 }}
          >
            {/* <HumanModel /> */}
            <HumanDestruction
              scale={80}
              position={[0, 25, -50]}
              rotation={[0, Math.PI, 0]}
            />
          </Steps>
          <Door
            params={p}
            displayMat={displayMat}
            pointerUvRef={pointerUvRef}
            pointerActiveRef={pointerActiveRef}
            doorProjectionRef={doorProjectionRef}
            scrollWindow={{ startVh: 150, endVh: 200 }}
          />
        </group>

        <Sky />

        {/* the name, headline and cta are DOM overlays in <Hero />; these only
            drive them */}
        <NameDriver doorProjectionRef={doorProjectionRef} />
        <HeadlineDriver />

        {up.md && (
          <Suspense fallback={null}>
            <CircularText
              position={[1000, 840, -1500]}
              fontSize={55}
              radius={270}
              text="AVAILABLE FOR * NEW PROJECTS * "
            />
          </Suspense>
        )}
      </group>
    </>
  );
}
