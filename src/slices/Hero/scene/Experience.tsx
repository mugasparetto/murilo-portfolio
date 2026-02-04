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

import Terrain from "./Terrain";
import Steps from "./Steps";
import Door from "./Door";
import HumanModel from "./HumanModel";
import Sky from "./Sky";
import { useFluidMaterials } from "@/app/components/FluidMaterial";
import { useHeroPrimary } from "../hero-context";

import Name from "./Name";
import Headline from "./Headline";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

type Props = {
  scrollRef: RefObject<HTMLDivElement | null>;
};

export default function Experience({ scrollRef }: Props) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const { first_name, last_name, tag_line, description } = useHeroPrimary();
  const { up } = useBreakpoints(BREAKPOINTS);

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
          <Terrain params={p} tiles={3} />
          <Steps
            params={p}
            doorFluidTextureRef={fluidTextureRef}
            scrollWindow={{ startVh: 120, endVh: 230 }}
          >
            <HumanModel />
          </Steps>
          <Door
            params={p}
            displayMat={displayMat}
            pointerUvRef={pointerUvRef}
            pointerActiveRef={pointerActiveRef}
            scrollWindow={{ startVh: 250, endVh: 300 }}
          />
        </group>

        <Sky />

        <Suspense fallback={null}>
          <Name
            firstName={first_name}
            lastName={last_name}
            scrollWindow={{ startVh: 10, endVh: 110 }}
          />
        </Suspense>

        <Headline
          tagline={tag_line}
          description={description}
          scrollWindow={{ startVh: 10, endVh: 110 }}
        />
      </group>
    </>
  );
}
