import { RefObject, useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

type Props = {
  ref: RefObject<THREE.Group | null>;
};

export default function Head({ ref }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  const scale = useMemo<[number, number, number]>(() => {
    const size = 500;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  return (
    <group ref={ref}>
      <sprite position={[0, -800, 2600]} scale={scale}>
        <spriteMaterial map={top} transparent depthWrite={false} />
      </sprite>

      <mesh
        position={[8, -734, 2600]}
        rotation={[Math.PI / 2 - 0.02, 0.01, 0]}
        renderOrder={999}
      >
        <circleGeometry args={[128, 48]} />
        <meshBasicMaterial
          color={"hotpink"}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <sprite position={[0, -800, 2600]} scale={scale}>
        <spriteMaterial map={middle} transparent depthWrite={false} />
      </sprite>

      <mesh
        position={[9, -860, 2600]}
        rotation={[Math.PI / 2 + 0.03, -0.01, 0]}
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

      <sprite position={[0, -800, 2600]} scale={scale} renderOrder={0}>
        <spriteMaterial map={bottom} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}
