import { useMemo } from "react";
import * as THREE from "three";

function SkyBoundsDebug({
  bounds,
  domeRadius,
}: {
  bounds: { minY: number; maxY: number; minZ: number; maxZ: number };
  domeRadius: number;
}) {
  const width = domeRadius * 2;
  const height = bounds.maxY - bounds.minY;
  const depth = bounds.maxZ - bounds.minZ;

  const center = useMemo(
    () =>
      new THREE.Vector3(0, bounds.minY + height / 2, bounds.minZ + depth / 2),
    [bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ]
  );

  return (
    <mesh position={center}>
      <boxGeometry args={[width, height, depth]} />
      <meshBasicMaterial
        color="cyan"
        wireframe
        transparent
        opacity={0.35}
        depthWrite={false}
      />
    </mesh>
  );
}

export default SkyBoundsDebug;
