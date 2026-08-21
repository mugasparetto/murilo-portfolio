import * as THREE from "three";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  Suspense,
  useState,
  useCallback,
} from "react";
import { ThreeElements, useFrame, useThree } from "@react-three/fiber";
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
import { ABOUT_POSE, poseFrame } from "@/app/components/poses";

type LinePosition = {
  x: number;
  y: number;
};

/**
 * A radial falloff applied to the grid's own alpha, so the lines don't just
 * stop dead at the ends of their span.
 *
 * It lives on the lines rather than on a black plane laid over them, which is
 * the other way to get the same picture. Masking at the source is exact — the
 * falloff is on the thing being faded, not on whatever happens to sit in front
 * of it — it can't be undone by transparency sort order, and it leaves the
 * backdrop behind free for anything else. A wash could only ever paint over
 * that too.
 *
 * Measured in world units, because the ellipse is a *screen* measurement: see
 * {@link poseFrame} for how the two are bridged.
 */
type RadialMask = {
  /** world x/y the ellipse is centred on */
  center: [number, number];
  /** the ellipse's half-width and half-height, in world units */
  radius: [number, number];
  /**
   * Where the fade starts and finishes, as fractions of the ellipse. A ramp
   * run across the whole of it (0 -> 1) spends nearly all its range out at the
   * margins where the lines are already at full strength, so the visible part
   * of the grid barely moves; pulling the stops in concentrates the whole
   * falloff into a band you can actually see.
   */
  stops?: [number, number];
};

type LinesProps = {
  lines: LinePosition[];
  span: number; // height if vertical, width if horizontal
  mask: RadialMask;
  orientation?: "vertical" | "horizontal";
  thickness?: number;
  z?: number;
  color?: THREE.ColorRepresentation;
  /**
   * How opaque the lines are at each end of the mask's falloff, as
   * `[centre, edges]`. Neither end is special — swapping the two is what
   * inverts the effect, so it replaces the old "which end is solid" flag
   * rather than sitting alongside it. Holding the centre a little above zero
   * leaves a ghost of the grid there instead of a hole.
   */
  opacity?: [number, number];
} & Omit<ThreeElements["instancedMesh"], "args">;

/**
 * World position is the one thing the mask needs and the only reason this
 * isn't a MeshBasicMaterial. Three declares `instanceMatrix` and defines
 * USE_INSTANCING for any non-raw shader drawn by an InstancedMesh, but a
 * hand-written vertex shader still has to apply it.
 */
const LINE_VERTEX = /* glsl */ `
  varying vec2 vWorld;

  void main() {
    vec4 local = vec4(position, 1.0);

    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif

    vec4 world = modelMatrix * local;

    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  // x at the centre of the falloff, y at its edges
  uniform vec2 uOpacity;
  uniform vec2 uCenter;
  uniform vec2 uRadius;
  uniform vec2 uStops;

  varying vec2 vWorld;

  void main() {
    // an ellipse inscribed in the viewport: 0 at the centre and 1 on all four
    // edges whatever the aspect is
    float d = length((vWorld - uCenter) / uRadius);

    // smoothstep rather than the raw distance: it clamps at both ends, so the
    // parts of a line that run off screen stay pinned at full strength, and it
    // eases in and out instead of kinking where the ramp starts
    float t = smoothstep(uStops.x, uStops.y, d);

    gl_FragColor = vec4(uColor, mix(uOpacity.x, uOpacity.y, t));
  }
`;

function Lines({
  lines,
  span,
  mask,
  orientation = "vertical",
  thickness = 0.02,
  z = 0.001,
  color = "white",
  opacity = [0, 0.05],
  ...props
}: LinesProps) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // `mask` only changes on resize, so this is nowhere near per-frame work
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: new THREE.Vector2(...opacity) },
      uCenter: { value: new THREE.Vector2(...mask.center) },
      uRadius: { value: new THREE.Vector2(...mask.radius) },
      uStops: { value: new THREE.Vector2(...(mask.stops ?? [0, 1])) },
    }),
    [color, opacity, mask],
  );

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
      <shaderMaterial
        vertexShader={LINE_VERTEX}
        fragmentShader={LINE_FRAGMENT}
        uniforms={uniforms}
        transparent
      />
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

/** depth the backdrop plane sits at */
const BACKDROP_Z = 2200;

/** how far in front of it the grid sits, clear of z-fighting */
const GRID_OFFSET = 0.1;

/**
 * The grid's alpha at each end of the falloff, `[centre, edges]`.
 *
 * This pair is the entire range the effect has to work in, so it's worth
 * spending: the two numbers being close together is what makes a falloff read
 * as nothing at all, especially under a Noise pass running at 0.4. Reverse
 * them to fade the grid out into the margins instead of into the middle.
 */
const GRID_OPACITY: [number, number] = [0, 0.1];

/**
 * Where the fade runs, as fractions of the viewport ellipse: nothing at all
 * until a quarter of the way out, all of it done by three quarters. That keeps
 * the transition inside the part of the screen you're looking at instead of
 * spreading it out to the corners.
 */
const GRID_FADE: [number, number] = [0.65, 1];

type Props = {
  scrollWindow: VhWindow;
};

export default function Scene({ scrollWindow }: Props) {
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
    () => [0, !up.md ? -1205 : -1005, BACKDROP_Z],
    [up.md],
  );

  const size = useThree((s) => s.size);
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov);

  /**
   * The falloff the grid is drawn through: an ellipse inscribed in the
   * viewport, sized at the grid's own depth so it tracks the screen edges
   * rather than the backdrop's arbitrary 2000-unit span. Resize work only.
   */
  const gridMask = useMemo(() => {
    const frame = poseFrame(
      ABOUT_POSE,
      fov,
      size.width / size.height,
      BACKDROP_Z + GRID_OFFSET,
    );

    return {
      center: frame.center,
      radius: [frame.width / 2, frame.height / 2] as [number, number],
      stops: GRID_FADE,
    };
  }, [fov, size.width, size.height]);

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
        <Lines
          lines={lines}
          span={2000}
          mask={gridMask}
          opacity={GRID_OPACITY}
          thickness={1.5}
          z={GRID_OFFSET}
        />
        <Lines
          lines={hLines}
          span={2000}
          mask={gridMask}
          opacity={GRID_OPACITY}
          orientation="horizontal"
          thickness={1.5}
          z={GRID_OFFSET}
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
