"use client";

import {
  OrbitControls,
  Stats,
  Html,
  ScrollControls,
  useHelper,
} from "@react-three/drei";
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
import ScrollRig from "./ScrollRig";
import Name from "./Name";
import Headline from "./Headline";

const PAGES_COUNT = 10;

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
    () => [0, p.groupY, 0],
    [p.groupY]
  );

  const sceneRef = useRef<THREE.Object3D | null>(null);

  return (
    <>
      <color attach="background" args={[0x000000]} />

      {/* <OrbitControls ref={controlsRef} /> */}

      <ScrollControls pages={PAGES_COUNT} damping={0.15}>
        <group ref={sceneRef}>
          <group position={groupPosition}>
            <Terrain params={p} tiles={3} />
            <Steps
              params={p}
              doorFluidTextureRef={fluidTextureRef}
              totalPagesCount={PAGES_COUNT}
              scrollWindow={{ startPage: 3, endPage: 6 }}
            >
              <HumanModel onMeshesReady={handleMeshesReady} />
            </Steps>
            <Door
              params={p}
              displayMat={displayMat}
              pointerUvRef={pointerUvRef}
              pointerActiveRef={pointerActiveRef}
              totalPagesCount={PAGES_COUNT}
              scrollWindow={{ startPage: 6, endPage: 7 }}
            />
          </group>

          <Sky />

          <Suspense fallback={null}>
            <Name
              firstName={first_name}
              lastName={last_name}
              totalPagesCount={PAGES_COUNT}
              scrollWindow={{ startPage: 1, endPage: 3 }}
            />
          </Suspense>

          <Headline
            tagline={tag_line}
            description={description}
            totalPagesCount={PAGES_COUNT}
            scrollWindow={{ startPage: 1, endPage: 3 }}
          />
        </group>
        <ScrollRig
          pages={PAGES_COUNT}
          targetRef={sceneRef}
          windows={[{ startPage: 7, endPage: 11 }]}
          unit="viewport"
          viewportDistancePerWeight={2}
          smoothing={8}
          direction={1}
        />
      </ScrollControls>

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
