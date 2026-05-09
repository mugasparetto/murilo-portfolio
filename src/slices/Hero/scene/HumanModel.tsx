import * as THREE from "three";
import { useRef, JSX, useEffect, useMemo, useState } from "react";
import { useGLTF, useAnimations, Outlines } from "@react-three/drei";
import { GLTF } from "three-stdlib";

import { useStore } from "@/app/hooks/store";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { useAdaptiveGate } from "@/app/hooks/adaptiveGate";

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
    "/models/human.glb",
  ) as unknown as GLTFResult;

  const { actions, names } = useAnimations(animations, group);

  const [hovered, setHovered] = useState(false);

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
   * Play animation
   */
  useEffect(() => {
    const name = names?.[0];
    const action = name ? actions?.[name] : undefined;

    action?.reset().play();

    return () => {
      action?.stop();
    };
  }, [actions, names]);

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
      rotationY: Math.PI - Math.PI * 0.05,
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

useGLTF.preload("/models/human.glb");
