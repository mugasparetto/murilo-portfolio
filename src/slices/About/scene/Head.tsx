import { useMemo } from "react";
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
        <spriteMaterial map={bottom} transparent depthWrite={false} />
      </sprite>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={middle} transparent depthWrite={false} />
      </sprite>
      <sprite position={[-380, -800, 2400]} scale={scale}>
        <spriteMaterial map={top} transparent depthWrite={false} />
      </sprite>
    </>
  );
}
