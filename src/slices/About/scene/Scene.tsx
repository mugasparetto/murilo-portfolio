import * as THREE from "three";
import { useLayoutEffect, useMemo, useRef, Suspense } from "react";
import { ThreeElements, useFrame } from "@react-three/fiber";
import { Mask } from "@react-three/drei";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import {
  makeRanges,
  segmentProgress,
  progressInVhWindow,
  useScrollVhAbsolute,
  VhWindow,
  rangeProgress,
} from "@/app/helpers/scroll";
import Head from "./Head";

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

type Props = {
  scrollWindow: VhWindow;
};

export default function Scene({ scrollWindow }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS);
  const portal1 = useRef<THREE.Mesh | null>(null);
  const portal2 = useRef<THREE.Mesh | null>(null);
  const mask = useRef<THREE.Mesh | null>(null);
  const head = useRef<THREE.Group | null>(null);

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

  const planePos: [number, number, number] = [0, !up.md ? -1205 : -1005, 2200];

  const PHASE_WEIGHTS = [0.2, 0.6, 0.2];
  const PHASES = makeRanges(PHASE_WEIGHTS);
  const scrollVh = useScrollVhAbsolute();

  useFrame(() => {
    const t = progressInVhWindow(scrollVh.current, scrollWindow);

    const pIn = segmentProgress(t, PHASES, 0);
    const pSlide = segmentProgress(t, PHASES, 1);

    // --- overlap config ---
    const overlap = 0.3; // 0..1 of the SLIDE segment to overlap (0.35 = starts closing ~65% into slide)

    const slideStart = PHASES[1].start;
    const slideEnd = PHASES[1].end;
    const outEnd = PHASES[2].end;

    // Start "out" before slide finishes:
    const outStart = THREE.MathUtils.lerp(slideEnd, slideStart, overlap);
    // equivalently: slideEnd - overlap*(slideEnd - slideStart)

    const pOut = rangeProgress(t, outStart, outEnd);

    // Open normally, then while in/after slide, start applying pOut
    const base = t < slideStart ? pIn : 1;
    const portalScale = base * (1 - pOut);

    if (portal1.current) {
      portal1.current.scale.setScalar(portalScale);
      portal1.current.position.y = -800 + pSlide * 275;
    }

    if (portal2.current) {
      portal2.current.scale.setScalar(portalScale);
      portal2.current.position.y = -800 + pSlide * -275;
    }

    const maskScale = t < slideStart ? pIn : 1;

    if (mask.current) {
      mask.current.scale.setScalar(maskScale);
      mask.current.scale.y = THREE.MathUtils.clamp(pSlide * 550, 0.001, 550);
    }

    if (head.current) {
      head.current.visible = t > 0.245;
    }
  });

  return (
    <group>
      <mesh position={planePos}>
        <primitive object={planeGeo} attach="geometry" />
        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
      </mesh>

      <group position={planePos}>
        <VerticalLines lines={lines} height={2000} thickness={1.5} z={0.1} />
      </group>

      <mesh
        ref={portal1}
        position={[-360, -800, 2420]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[200, 3, 8, 48]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh
        ref={portal2}
        position={[-360, -800, 2420]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[200, 3, 8, 48]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <group ref={mask} position={[-360, -800, 2420]} rotation={[0, 0, 0]}>
        {/* stencil writer */}
        <Mask id={1} colorWrite={false}>
          <cylinderGeometry args={[185, 185, 1, 48]} />
        </Mask>

        {/* debug visual (does NOT affect stencil) */}
        {/* <mesh>
          <cylinderGeometry args={[185, 185, 1, 48]} />
          <meshBasicMaterial
            color="cyan"
            transparent
            opacity={0.25}
            wireframe
            depthTest={false}
          />
        </mesh> */}
      </group>

      <Suspense fallback={null}>
        {/* Render one head per portal, each clipped by its own mask */}
        <Head maskId={1} ref={head} />
      </Suspense>
    </group>
  );
}
