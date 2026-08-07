import * as THREE from "three";
import { useRef, JSX, useEffect, useMemo, useState, useCallback } from "react";
import { useGLTF, useAnimations, Outlines } from "@react-three/drei";
import { GLTF } from "three-stdlib";

import { useStore } from "@/app/hooks/store";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { useAdaptiveGate } from "@/app/hooks/adaptiveGate";

const INITIAL_ROTATION_Y = Math.PI - Math.PI * 0.05;

type GLTFResult = GLTF & {
  nodes: {
    Cube: THREE.SkinnedMesh;
    mixamorigHips: THREE.Bone;
  };
  materials: {
    ["Material.003"]: THREE.MeshPhysicalMaterial;
  };
};

export default function HumanModel(props: JSX.IntrinsicElements["group"]) {
  const group = useRef<THREE.Group>(null);

  const { nodes, materials, animations } = useGLTF(
    "/models/looking-cycle.glb",
  ) as unknown as GLTFResult;

  const { actions } = useAnimations(animations, group);

  const [hovered, setHovered] = useState(false);
  const isLooking = useRef(false);

  const setOutlined = useStore((s) => s.setOutlined);
  const clearOutlined = useStore((s) => s.clearOutlined);

  const { up } = useBreakpoints(BREAKPOINTS);
  const hiRes = useAdaptiveGate({
    disableBelow: 30,
    enableAbove: 31,
  });

  /**
   * Clone GLTF material so hover effects
   * don't mutate the shared original material.
   */
  const material = useMemo(() => {
    const cloned = materials["Material.003"].clone();

    cloned.color.set("black");
    cloned.emissive = new THREE.Color("white");
    cloned.emissiveIntensity = 0;

    return cloned;
  }, [materials]);

  /**
   * Hover fill effect
   */
  useEffect(() => {
    material.color.set(hovered ? "white" : "black");

    // stronger white fill
    material.emissiveIntensity = hovered ? 1 : 0;

    material.needsUpdate = true;

    if (hovered) {
      document.body.style.cursor = "pointer";
    } else {
      document.body.style.cursor = "default";
    }
  }, [hovered, material]);

  /**
   * Play idle animation
   */
  const playIdle = useCallback(() => {
    const idleAction = actions?.["Idle"];

    if (!idleAction) return;

    idleAction.reset().play();
  }, [actions]);

  const playLookCycle = useCallback(() => {
    if (isLooking.current) return;

    const idleAction = actions?.["Idle"];
    const lookAction = actions?.["LookCycleIdle"];

    if (!lookAction || !group.current) return;

    isLooking.current = true;

    idleAction?.stop();

    // Play look cycle forward once
    lookAction.reset();
    lookAction.setLoop(THREE.LoopOnce, 1);
    lookAction.clampWhenFinished = true;
    lookAction.timeScale = 1;
    lookAction.play();

    // GSAP Z rotation forward — runs alongside the animation
    // gsap.to(group.current.rotation, {
    //   y: INITIAL_ROTATION_Y + 0.15,
    //   duration: 1,
    //   ease: "power2.inOut",
    // });

    // gsap.to(group.current.rotation, {
    //   y: INITIAL_ROTATION_Y,
    //   duration: 1,
    //   delay: 6,
    //   ease: "power2.inOut",
    // });

    const mixer = lookAction.getMixer();

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== lookAction) return;

      mixer.removeEventListener("finished", onFinished);

      lookAction.stop();
      isLooking.current = false;
      playIdle();
    };

    mixer.addEventListener("finished", onFinished);
  }, [actions, playIdle]);

  /**
   * Initial idle playback
   */
  useEffect(() => {
    playIdle();

    return () => {
      const idleAction = actions?.["Idle"];
      idleAction?.stop();
    };
  }, [actions, playIdle]);

  /**
   * Spacebar → trigger Turn animation
   */
  // useEffect(() => {
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     if (e.code === "Space") {
  //       e.preventDefault();
  //       playLookCycle();
  //     }
  //   };

  //   window.addEventListener("keydown", handleKeyDown);
  //   return () => window.removeEventListener("keydown", handleKeyDown);
  // }, [playLookCycle]);

  /**
   * Outline registration
   */
  useEffect(() => {
    if (!group.current) return;

    const meshes: THREE.Object3D[] = [];

    group.current.traverse((obj) => {
      // @ts-expect-error runtime flag
      if (obj.isMesh) meshes.push(obj);
    });

    setOutlined(meshes);

    return () => {
      clearOutlined();
    };
  }, [clearOutlined, setOutlined]);

  const transform = useMemo(
    () => ({
      scale: 80,
      rotationY: INITIAL_ROTATION_Y,
      position: new THREE.Vector3(-200, 50, -50),
    }),
    [],
  );

  return (
    <group
      ref={group}
      {...props}
      dispose={null}
      position={transform.position}
      scale={transform.scale}
      rotation={[0, transform.rotationY, 0]}
    >
      <group name="Scene">
        <group name="Armature" rotation={[Math.PI / 2, 0, 0]} scale={0.01}>
          <skinnedMesh
            name="Cube"
            geometry={nodes.Cube.geometry}
            material={material}
            skeleton={nodes.Cube.skeleton}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={playLookCycle}
          >
            {(!up.md || !hiRes) && (
              <Outlines
                thickness={1.75}
                color="white"
                renderOrder={10}
                angle={22}
              />
            )}
          </skinnedMesh>

          <primitive object={nodes.mixamorigHips} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload("/models/looking-cycle.glb");
