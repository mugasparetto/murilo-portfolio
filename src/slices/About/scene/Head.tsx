import { RefObject, useMemo } from "react";
import * as THREE from "three";
import { useTexture, useMask } from "@react-three/drei";

type Props = {
  maskId: number;
  ref: RefObject<THREE.Group | null>;
};

export default function Head({ maskId, ref }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  // ✅ stencil test props for THIS head instance
  const mask = useMask(maskId, false);

  const scale = useMemo<[number, number, number]>(() => {
    const size = 550;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  return (
    <group ref={ref}>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={top} transparent depthWrite={false} {...mask} />
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
          {...mask}
        />
      </mesh>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={middle} transparent depthWrite={false} {...mask} />
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
          {...mask}
        />
      </mesh>

      <sprite position={[-380, -800, 2400]} scale={scale} renderOrder={0}>
        <spriteMaterial map={bottom} transparent depthWrite={false} {...mask} />
      </sprite>
    </group>
  );
}
