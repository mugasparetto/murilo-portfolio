import * as THREE from "three";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  Suspense,
  useState,
  useCallback,
} from "react";
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

const EYES_AREA: Quad = {
  p0: [-120, -820, 2600],
  p1: [120, -820, 2600],
  p2: [120, -730, 2600],
  p3: [-100, -730, 2600],
};

const MOUTH_AREA: Quad = {
  p0: [-58, -1020, 2600],
  p1: [68, -1020, 2600],
  p2: [120, -870, 2600],
  p3: [-100, -870, 2600],
};

export default function Scene({ scrollWindow, content }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS);
  const head = useRef<THREE.Group | null>(null);

  const headContentRef = useRef<HTMLDivElement>(null);
  const [progressHeadConnector, setProgresHeadConnector] = useState(0);
  const headBillboardRef = useRef<THREE.Group | null>(null);

  const eyesContentRef = useRef<HTMLDivElement>(null);
  const [progressEyesConnector, setProgressEyesConnector] = useState(0);
  const eyesBillboardRef = useRef<THREE.Group | null>(null);

  const mouthContentRef = useRef<HTMLDivElement>(null);
  const [progressMouthConnector, setProgressMouthConnector] = useState(0);
  const mouthBillboardRef = useRef<THREE.Group | null>(null);

  const [grabbing, setGrabbing] = useState<null | "head" | "eyes" | "mouth">(
    null,
  );
  const timeRef = useRef(0);

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

  useFrame((_, delta) => {
    const t = progressInVhWindow(scrollVh.current, scrollWindow);

    const pHeadContent = segmentProgress(t, PHASES, 0);
    const pHeadConnector = segmentProgress(t, PHASES, 1);
    const pEyesContent = segmentProgress(t, PHASES, 2);
    const pEyesConnector = segmentProgress(t, PHASES, 3);
    const pMouthContent = segmentProgress(t, PHASES, 4);
    const pMouthConnector = segmentProgress(t, PHASES, 5);

    if (headContentRef.current) {
      headContentRef.current.style.transform = `translateY(${(1 - pHeadContent) * 100}%)`;
    }

    if (headBillboardRef.current) {
      headBillboardRef.current.visible =
        grabbing !== "head" && pHeadConnector >= 0.999;
    }

    if (grabbing === "head") {
      setProgresHeadConnector(300);
    } else {
      setProgresHeadConnector(
        pHeadConnector * 301 > 300 ? 700 : pHeadConnector * 300,
      );
    }

    if (eyesContentRef.current) {
      eyesContentRef.current.style.transform = `translateY(${(1 - pEyesContent) * 100}%)`;
    }

    if (eyesBillboardRef.current) {
      eyesBillboardRef.current.visible =
        grabbing !== "eyes" && pEyesConnector >= 0.999;
    }

    if (grabbing === "eyes") {
      setProgressEyesConnector(300);
    } else {
      setProgressEyesConnector(
        pEyesConnector * 301 > 300 ? 700 : pEyesConnector * 300,
      );
    }

    if (mouthContentRef.current) {
      mouthContentRef.current.style.transform = `translateY(${(1 - pMouthContent) * 100}%)`;
    }

    if (mouthBillboardRef.current) {
      mouthBillboardRef.current.visible =
        grabbing !== "mouth" && pMouthConnector >= 0.999;
    }

    if (grabbing === "mouth") {
      setProgressMouthConnector(300);
    } else {
      setProgressMouthConnector(
        pMouthConnector * 301 > 300 ? 700 : pMouthConnector * 300,
      );
    }

    if (head.current && grabbing == null) {
      timeRef.current += delta;
      head.current.position.y = Math.sin(timeRef.current * 0.35) * 10;
    }
  });

  const handleGrabbing = useCallback(
    (payload: null | "head" | "eyes" | "mouth") => {
      setGrabbing(payload);
    },
    [],
  );

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
        <Head ref={head} onGrabbing={handleGrabbing} />

        <TeleportingBillboard
          quad={HEAD_AREA}
          svgScale={0.45}
          width={15}
          height={15}
          intervalMs={200}
          // debug={true}
          strokeWidth={1.25}
          lineAnchor={[-470, -852.5, 2600]}
          lineAttachment="left"
          lineColor="#ffffff"
          lineWidth={2}
          progress={progressHeadConnector}
          progressMode="distance"
          billboardRef={headBillboardRef}
          divider={0.0000000000002}
        />

        <TeleportingBillboard
          quad={EYES_AREA}
          svgScale={0.45}
          width={15}
          height={15}
          intervalMs={200}
          // debug={true}
          strokeWidth={1.25}
          lineAnchor={[471, -673, 2600]}
          lineAttachment="right"
          lineColor="#ffffff"
          lineWidth={2}
          progress={progressEyesConnector}
          progressMode="distance"
          billboardRef={eyesBillboardRef}
          divider={0.00000000006}
        />

        <TeleportingBillboard
          quad={MOUTH_AREA}
          svgScale={0.45}
          width={15}
          height={15}
          intervalMs={200}
          // debug={true}
          strokeWidth={1.25}
          lineAnchor={[511, -903, 2600]}
          lineAttachment="right"
          lineColor="#ffffff"
          lineWidth={2}
          progress={progressMouthConnector}
          progressMode="distance"
          billboardRef={mouthBillboardRef}
          divider={0.00000000006}
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
          className="bg-black/60 p-8 w-[31.5rem] flex flex-col gap-2 select-none"
        >
          <span className="lowercase text-3xl font-bold">
            {content.head.title}
          </span>
          <span className="lowercase text-lg leading-5.5">
            {content.head.description}
          </span>
        </div>
      </Html>

      <Html
        transform
        position={[320, -620, 2600]}
        wrapperClass="fixed!"
        className="overflow-hidden"
        distanceFactor={240}
      >
        <div
          ref={eyesContentRef}
          className="bg-black/60 p-8 w-[31.5rem] flex flex-col gap-2 select-none"
        >
          <span className="lowercase text-3xl font-bold">
            {content.eyes.title}
          </span>
          <span className="lowercase text-lg leading-5.5">
            {content.eyes.description}
          </span>
        </div>
      </Html>

      <Html
        transform
        position={[360, -850, 2600]}
        wrapperClass="fixed!"
        className="overflow-hidden"
        distanceFactor={240}
      >
        <div
          ref={mouthContentRef}
          className="bg-black/60 p-8 w-[31.5rem] flex flex-col gap-2 select-none"
        >
          <span className="lowercase text-3xl font-bold">
            {content.mouth.title}
          </span>
          <span className="lowercase text-lg leading-5.5">
            {content.mouth.description}
          </span>
        </div>
      </Html>
    </group>
  );
}
