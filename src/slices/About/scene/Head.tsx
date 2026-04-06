import { RefObject, useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";

type Props = {
  ref: RefObject<THREE.Group | null>;
  pointerUvRefA: React.RefObject<THREE.Vector2 | null>;
  pointerActiveRefA: React.RefObject<boolean>;
  displayMatA: THREE.ShaderMaterial;
  pointerUvRefB: React.RefObject<THREE.Vector2 | null>;
  pointerActiveRefB: React.RefObject<boolean>;
  displayMatB: THREE.ShaderMaterial;
};

export default function Head({
  ref,
  pointerUvRefA,
  pointerActiveRefA,
  displayMatA,
  pointerUvRefB,
  pointerActiveRefB,
  displayMatB,
}: Props) {
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
        scale={[1, 0.11, 1]}
        renderOrder={999}
        material={displayMatA}
        onPointerMove={(e) => {
          pointerActiveRefA.current = true;
          if (e.uv) pointerUvRefA.current = e.uv.clone();
        }}
        onPointerOut={() => {
          pointerActiveRefA.current = false;
          pointerUvRefA.current = null;
        }}
        onPointerLeave={() => {
          pointerActiveRefA.current = false;
          pointerUvRefA.current = null;
        }}
      >
        <circleGeometry args={[128, 48]} />
      </mesh>

      <sprite position={[0, -800, 2600]} scale={scale}>
        <spriteMaterial map={middle} transparent depthWrite={false} />
      </sprite>

      <mesh
        position={[9, -860, 2600]}
        scale={[1, 0.11, 1]}
        renderOrder={999}
        material={displayMatB}
        onPointerMove={(e) => {
          pointerActiveRefB.current = true;
          if (e.uv) pointerUvRefB.current = e.uv.clone();
        }}
        onPointerOut={() => {
          pointerActiveRefB.current = false;
          pointerUvRefB.current = null;
        }}
        onPointerLeave={() => {
          pointerActiveRefB.current = false;
          pointerUvRefB.current = null;
        }}
      >
        <circleGeometry args={[122, 48]} />
      </mesh>

      <sprite position={[0, -800, 2600]} scale={scale} renderOrder={0}>
        <spriteMaterial map={bottom} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}
