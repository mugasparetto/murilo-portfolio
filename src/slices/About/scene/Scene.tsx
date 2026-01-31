import * as THREE from "three";
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { ThreeElements } from "@react-three/fiber";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

type LinePosition = {
  x: number;
  y: number;
};

type VerticalLinesProps = {
  lines: LinePosition[]; // ✅ one array
  height: number;
  thickness?: number;
  z?: number;
  color?: THREE.ColorRepresentation;
} & Omit<ThreeElements["instancedMesh"], "args">;

function VerticalLines({
  lines,
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

    lines.forEach(({ x, y }, i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });

    ref.current.instanceMatrix.needsUpdate = true;
  }, [lines, z, dummy]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, lines.length]}
      {...props}
    >
      <planeGeometry args={[thickness, height]} />
      <primitive object={mat} attach="material" />
    </instancedMesh>
  );
}

// --- NEW: curved plane geometry (U-curve along TOP edge) ---
function useUCurvePlaneGeometry(
  width: number,
  height: number,
  curveDepth: number, // how far down the U dips at center
  segments = 64, // curve smoothness
) {
  return useMemo(() => {
    const w = width;
    const h = height;

    const left = -w / 2;
    const right = w / 2;
    const bottom = -h / 2;
    const top = h / 2;

    // Clamp so you don't invert the shape accidentally
    const d = THREE.MathUtils.clamp(curveDepth, 0, h * 0.95);

    const shape = new THREE.Shape();

    // Start bottom-left, go clockwise
    shape.moveTo(left, bottom);
    shape.lineTo(right, bottom);
    shape.lineTo(right, top);

    // Top edge: go from (right, top) to (left, top) with a U dip
    // Using a cubic Bezier where both control points are lower than the top.
    const cx1 = right - w * 0.25;
    const cy1 = top - d;
    const cx2 = left + w * 0.25;
    const cy2 = top - d;
    shape.bezierCurveTo(cx1, cy1, cx2, cy2, left, top);

    shape.lineTo(left, bottom);
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape, segments);

    // Optional: give it plane-like UVs (helps if you later use textures)
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const size = new THREE.Vector2(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
    const uv: number[] = [];
    const pos = geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.push((x - bb.min.x) / size.x, (y - bb.min.y) / size.y);
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));

    return geometry;
  }, [width, height, curveDepth, segments]);
}

export default function Scene() {
  const { up } = useBreakpoints(BREAKPOINTS);

  const lines = [
    { x: -690, y: -28 },
    { x: -495, y: -36 },
    { x: -300, y: -42 },
    { x: -100, y: -45 },
    { x: 100, y: -45 },
    { x: 300, y: -42 },
    { x: 495, y: -36 },
    { x: 690, y: -28 },
  ];

  const planeGeo = useUCurvePlaneGeometry(
    2000,
    2000,
    60, // 👈 increase/decrease this for a deeper/shallower U
    96, // 👈 smoothness
  );

  const planePos: [number, number, number] = [0, !up.md ? -1250 : -1005, 2200];

  return (
    <group>
      <mesh position={planePos}>
        <primitive object={planeGeo} attach="geometry" />
        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
      </mesh>

      <group position={planePos}>
        <VerticalLines lines={lines} height={2000} thickness={1.5} z={0.1} />
      </group>
    </group>
  );
}
