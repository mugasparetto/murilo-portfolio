import * as THREE from "three";
import { useLayoutEffect, useMemo, useRef, Suspense, useState } from "react";
import { ThreeElements, useFrame } from "@react-three/fiber";
import { Text, Html } from "@react-three/drei";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import Head from "./Head";
import { KeyTextField } from "@prismicio/client";
import {
  makeRanges,
  segmentProgress,
  progressInVhWindow,
  useScrollVhAbsolute,
  VhWindow,
} from "@/app/helpers/scroll";
import TeleportingBillboard, { type Quad } from "./TeleportingBillboard";

type LinePosition = {
  x: number;
  y: number;
};

type LinesProps = {
  lines: LinePosition[];
  span: number; // height if vertical, width if horizontal
  orientation?: "vertical" | "horizontal";
  thickness?: number;
  z?: number;
  color?: THREE.ColorRepresentation;
} & Omit<ThreeElements["instancedMesh"], "args">;

function Lines({
  lines,
  span,
  orientation = "vertical",
  thickness = 0.02,
  z = 0.001,
  color = "white",
  ...props
}: LinesProps) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color }), [color]);

  const geoArgs: [number, number] =
    orientation === "vertical" ? [thickness, span] : [span, thickness];

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
      <planeGeometry args={geoArgs} />
      <primitive object={mat} attach="material" transparent opacity={0.2} />
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

type BulletContent = {
  title: KeyTextField;
  description: KeyTextField;
};

type Props = {
  scrollWindow: VhWindow;
  content: {
    head: BulletContent;
    eyes: BulletContent;
    mouth: BulletContent;
  };
};

const HEAD_AREA: Quad = {
  p0: [-50, -580, 2600],
  p1: [60, -580, 2600],
  p2: [120, -680, 2600],
  p3: [-100, -680, 2600],
};

export default function Scene({ scrollWindow, content }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS);
  const head = useRef<THREE.Group | null>(null);
  const headContentRef = useRef<HTMLDivElement>(null);
  const [progressHeadConnector, setProgresHeadConnector] = useState(0);
  const headBillboardRef = useRef<THREE.Group | null>(null);

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

  const hLines = [
    { x: 0, y: 800 },
    { x: 0, y: 620 },
    { x: 0, y: 440 },
    { x: 0, y: 260 },
    { x: 0, y: 80 },
    { x: 0, y: -100 },
    { x: 0, y: -280 },
  ];

  const planeGeo = useUCurvePlaneGeometry(
    2000,
    2000,
    60, // 👈 increase/decrease this for a deeper/shallower U
    96, // 👈 smoothness
  );

  const planePos: [number, number, number] = [0, !up.md ? -1205 : -1005, 2200];

  const scrollVh = useScrollVhAbsolute();
  const PHASE_WEIGHTS = [0.2, 0.1333, 0.2, 0.1333, 0.2, 0.1333]; // head content, head connector, eyes content, eyes connector, mouth content, mouth connector
  const PHASES = makeRanges(PHASE_WEIGHTS);

  useFrame(() => {
    const t = progressInVhWindow(scrollVh.current, scrollWindow);

    const pHeadContent = segmentProgress(t, PHASES, 0);
    const pHeadConnector = segmentProgress(t, PHASES, 1);

    if (headContentRef.current) {
      headContentRef.current.style.setProperty(
        "--tw-translate-y",
        `${(1 - pHeadContent) * 100}%`,
      );
    }

    if (headBillboardRef.current) {
      headBillboardRef.current.visible = pHeadConnector >= 0.999;
    }

    setProgresHeadConnector(
      pHeadConnector * 301 > 300 ? 700 : pHeadConnector * 300,
    ); // tweak: extend the connector animation a bit after the billboard appears
  });

  return (
    <group>
      <mesh position={planePos}>
        <primitive object={planeGeo} attach="geometry" />
        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
      </mesh>

      <group position={planePos}>
        <Lines lines={lines} span={2000} thickness={1.5} z={0.1} />
        <Lines
          lines={hLines}
          span={2000}
          orientation="horizontal"
          thickness={1.5}
          z={0.1}
        />
      </group>

      <Suspense fallback={null}>
        <Text
          position={[0, -800, 2210]}
          font="/fonts/Morganite-Black.ttf"
          fontSize={680}
          color="white"
          fillOpacity={0.2}
        >
          ABOUT ME
        </Text>
      </Suspense>

      <Suspense fallback={null}>
        <Head ref={head} />

        <TeleportingBillboard
          quad={HEAD_AREA}
          svgScale={0.45}
          width={15}
          height={15}
          intervalMs={140}
          // debug={true}
          strokeWidth={1.25}
          lineAnchor={[-470, -852.5, 2600]}
          lineAttachment="left"
          lineColor="#ffffff"
          lineWidth={2}
          progress={progressHeadConnector}
          progressMode="distance"
          billboardRef={headBillboardRef}
        />
      </Suspense>

      <Html
        transform
        position={[-320, -800, 2600]}
        wrapperClass="fixed!"
        className="overflow-hidden"
        distanceFactor={240}
      >
        <div
          ref={headContentRef}
          className="bg-black/60 p-8 w-[31.5rem] flex flex-col gap-2 transform translate-y-[101%]"
        >
          <span className="lowercase text-3xl font-bold">
            {content.head.title}
          </span>
          <span className="lowercase text-lg leading-5.5">
            {content.head.description}
          </span>
        </div>
      </Html>
    </group>
  );
}
