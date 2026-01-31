import * as THREE from "three";
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { ThreeElements } from "@react-three/fiber";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

type VerticalLinesProps = {
  xs: number[]; // X positions in local space of the parent mesh
  height: number; // line height (Y)
  thickness?: number; // line thickness (X)
  z?: number; // local Z offset (so it can sit on top of a plane)
  color?: THREE.ColorRepresentation;
} & Omit<ThreeElements["instancedMesh"], "args">;

function VerticalLines({
  xs,
  height,
  thickness = 0.02,
  z = 0.001,
  color = "white",
  ...props
}: VerticalLinesProps) {
  const ref = useRef<THREE.InstancedMesh>(null!);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color }), [color]);

  useLayoutEffect(() => {
    if (!ref.current) return;

    xs.forEach((x, i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });

    ref.current.instanceMatrix.needsUpdate = true;
  }, [xs, z, dummy]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, xs.length]}
      {...props}
    >
      {/* A thin vertical rectangle centered at y=0 */}
      <planeGeometry args={[thickness, height]} />
      <primitive object={mat} attach="material" />
    </instancedMesh>
  );
}
export default function Scene() {
  const { up } = useBreakpoints(BREAKPOINTS);
  const lineXs = [-700, -500, -300, -100, 100, 300, 500, 700]; // you control these

  return (
    <group>
      <mesh position={[0, !up.md ? -1250 : -1050, 2200]}>
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
      </mesh>

      {/* Put lines in the same transform space as the plane */}
      <group position={[0, !up.md ? -1250 : -1050, 2200]}>
        <VerticalLines xs={lineXs} height={2000} thickness={1.5} z={0.1} />
      </group>
    </group>
  );
}
