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
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import Head from "./Head";
import Title from "./Title";
import { AboutOverlayDriver } from "./AboutOverlay";
import { KeyTextField } from "@prismicio/client";
import {
  makeRanges,
  segmentProgress,
  progressInVhWindow,
  useScrollVhAbsolute,
  VhWindow,
} from "@/app/helpers/scroll";
import { publishBackdrop } from "@/app/helpers/backdrop";

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
      <primitive object={mat} attach="material" transparent opacity={0.05} />
    </instancedMesh>
  );
}
// --- NEW: curved plane geometry (U-curve along TOP edge) ---
/**
 * Returns the mesh geometry *and* the shape's outline, both off the same
 * `THREE.Shape`. The hero's DOM overlays clip themselves against that outline,
 * so taking it from here rather than rebuilding it from the numbers is what
 * keeps the mask and the plane from drifting apart.
 */
function useUCurvePlane(
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

    // `closePath` leaves the start point repeated at the end; drop it, the
    // consumers close the loop themselves
    const outline = shape.getPoints(24);
    if (outline.length > 1 && outline[outline.length - 1].equals(outline[0])) {
      outline.pop();
    }

    return { geometry, outline };
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

export default function Scene({ scrollWindow, content }: Props) {
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });
  const head = useRef<THREE.Group | null>(null);

  const [grabbing, setGrabbing] = useState<null | "head" | "eyes" | "mouth">(
    null,
  );
  const timeRef = useRef(0);
  const shouldFloat = useRef(true);

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

  const { geometry: planeGeo, outline: planeOutline } = useUCurvePlane(
    2000,
    2000,
    60, // 👈 increase/decrease this for a deeper/shallower U
    96, // 👈 smoothness
  );

  const planePos = useMemo<[number, number, number]>(
    () => [0, !up.md ? -1205 : -1005, 2200],
    [up.md],
  );

  // the plane is the only thing in the page that can occlude the hero's DOM
  // overlays, so publish where it is; it never moves again, so once is enough
  const plane = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    const mesh = plane.current;
    if (!mesh) return;

    mesh.updateWorldMatrix(true, false);
    publishBackdrop(
      planeOutline.map((p) =>
        new THREE.Vector3(p.x, p.y, 0).applyMatrix4(mesh.matrixWorld),
      ),
    );

    return () => publishBackdrop(null);
  }, [planeOutline, planePos]);

  useFrame((_, delta) => {
    if (head.current && grabbing == null && shouldFloat.current) {
      timeRef.current += delta;
      head.current.position.y = Math.sin(timeRef.current * 0.35) * 10;
    }
  });

  const handleGrabbing = useCallback(
    (payload: null | "head" | "eyes" | "mouth") => {
      setGrabbing(payload);
      shouldFloat.current = false;
    },
    [],
  );

  return (
    <group>
      <mesh ref={plane} position={planePos}>
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
        <Title />
      </Suspense>

      <Suspense fallback={null}>
        <Head ref={head} onGrabbing={handleGrabbing} />
      </Suspense>

      {/* the section's HTML is a DOM overlay in <About />; this only drives it */}
      <AboutOverlayDriver />
    </group>
  );
}
