"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF, useAnimations } from "@react-three/drei";

type Props = {
  onMeshesReady?: (meshes: THREE.Object3D[]) => void;
};

export default function HumanModel({ onMeshesReady }: Props) {
  const group = useRef<THREE.Group>(null);

  const gltf = useGLTF("/models/human.glb");
  const { actions, names } = useAnimations(gltf.animations, group);

  useEffect(() => {
    // similar to your: animations[1]
    const name = names?.[1];
    const action = name ? actions?.[name] : undefined;
    action?.reset().play();

    return () => {
      action?.stop();
    };
  }, [actions, names]);

  useEffect(() => {
    if (!group.current || !onMeshesReady) return;
    const meshes: THREE.Object3D[] = [];
    group.current.traverse((obj) => {
      // @ts-expect-error runtime flag
      if (obj.isMesh) meshes.push(obj);
    });
    onMeshesReady(meshes);
  }, [onMeshesReady]);

  const transform = useMemo(
    () => ({
      scale: 100,
      rotationY: Math.PI - Math.PI * 0.05,
      position: new THREE.Vector3(-750, 238, -3100),
    }),
    []
  );

  return (
    <group
      ref={group}
      position={transform.position}
      scale={transform.scale}
      rotation={[0, transform.rotationY, 0]}
    >
      <primitive object={gltf.scene} />
    </group>
  );
}

useGLTF.preload("/models/human.glb");
