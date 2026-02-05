import { useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

export default function Head() {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  const scale = useMemo<[number, number, number]>(() => {
    const size = 550;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  return (
    <>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={top} transparent depthWrite={false} />
      </sprite>
      <mesh
        position={[-369, -735, 2400]}
        rotation={[Math.PI / 2 - 0.02, 0.02, 0]}
        renderOrder={999}
      >
        <circleGeometry args={[122, 48]} />
        <meshBasicMaterial
          color={"hotpink"}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={middle} transparent depthWrite={false} />
      </sprite>
      <mesh
        position={[-372, -860, 2400]}
        rotation={[Math.PI / 2 + 0.03, -0.03, 0]}
        renderOrder={999}
      >
        <circleGeometry args={[122, 48]} />
        <meshBasicMaterial
          color={"hotpink"}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <sprite position={[-380, -800, 2400]} scale={scale} renderOrder={0}>
        <spriteMaterial map={bottom} transparent depthWrite={false} />
      </sprite>
    </>
  );
}
