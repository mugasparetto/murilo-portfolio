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
import { useCoarsePointer } from "@/app/hooks/pointer";
import Head, { FACE_HEIGHT, FACE_HOME } from "./Head";
import Title from "./Title";
import { readFaceSlot } from "./faceSlot";
import { publishBackdrop } from "@/app/helpers/backdrop";
import { useScrollY } from "@/app/hooks/ScrollY";
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
const GRID_OPACITY: [number, number] = [0, 0.07];

/**
 * Where the fade runs, as fractions of the viewport ellipse: nothing at all
 * until a quarter of the way out, all of it done by three quarters. That keeps
 * the transition inside the part of the screen you're looking at instead of
 * spreading it out to the corners.
 */
const GRID_FADE: [number, number] = [0.65, 1];

/**
 * The plane the face is authored on, as a plane the pointer maths can hit.
 * `n dot p + c = 0` with n = +Z solves to `p.z = -c`, so the constant is the
 * depth negated.
 */
const facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -FACE_HOME.z);

/**
 * How much of its authored size the face keeps between `lg` and `xl`, where
 * the copy column beside it is at its narrowest — see the placement in
 * `useFrame`.
 */
const LG_FACE_SCALE = 0.8;

/**
 * The viewport aspect the `lg`-and-up placement is authored at, and the widest
 * the face is ever allowed to be relative to the screen.
 *
 * The camera's fov is vertical and the face sits at a fixed depth, so at a
 * fixed scale it covers a fixed share of the viewport's *height* — about 88% —
 * whatever shape the window is. The copy around it is placed the other way
 * round: everything in <AboutContent /> is positioned in percentages of the
 * layer's width. On a 16:10 window those two agree, and the face stops a few
 * pixels short of the column at 64.8%. Stand the same window on its end — an
 * iPad Pro in portrait is 0.75 — and the height the face is claiming buys it
 * far more of the width than the layout left for it, so it grows straight
 * across the description.
 *
 * So below this aspect the face is scaled by however much narrower the window
 * is, which holds its *width* share at what it is here instead of its height
 * share. 16:10 rather than 16:9 because it's the shallower of the two shapes
 * the section is actually laid out in, and the cap has to leave both alone.
 */
const FACE_FIT_ASPECT = 16 / 10;

const faceRay = new THREE.Raycaster();
const faceNdc = new THREE.Vector2();
const slotTop = new THREE.Vector3();
const slotBottom = new THREE.Vector3();
const slotMid = new THREE.Vector3();

/**
 * Where a point on the screen lands on {@link facePlane}, written into `out`.
 *
 * A ray through the live camera rather than a formula off the fov, because the
 * camera is only square-on to the plane at the rest pose: it is still pitching
 * on its way into the section, and the parallax rig sways it about at `md` and
 * up. A ray is right in every one of those states, which is what keeps the face
 * *in* its hole rather than near it.
 */
function screenToFacePlane(
  x: number,
  y: number,
  camera: THREE.Camera,
  width: number,
  height: number,
  out: THREE.Vector3,
) {
  faceNdc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  faceRay.setFromCamera(faceNdc, camera);

  return faceRay.ray.intersectPlane(facePlane, out);
}

export default function Scene() {
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });
  const coarsePointer = useCoarsePointer();
  const head = useRef<THREE.Group | null>(null);
  // the page position Lenis has eased to this frame — the same one the layer
  // the head is being fitted into is placed by
  const { scrollY } = useScrollY();

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

  /** see {@link FACE_FIT_ASPECT} — 1 on anything as wide as the design */
  const faceFit = useMemo(
    () => Math.min(1, size.width / size.height / FACE_FIT_ASPECT),
    [size.width, size.height],
  );

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

  useFrame((state, delta) => {
    const group = head.current;
    if (!group) return;

    if (grabbing == null && shouldFloat.current) {
      timeRef.current += delta;
    }
    const float = Math.sin(timeRef.current * 0.35) * 10;

    // ── From `lg` up: the authored world placement, floating in place ───────
    //
    // The placement is authored at `xl` and up, where the column beside the
    // face has all the width it wants. Between `lg` and `xl` that column is
    // narrower and the face crowds it, so the face is stepped down a little —
    // scaled about FACE_HOME rather than about the group's own origin, which
    // is a long way below and in front of it, so it shrinks where it stands
    // instead of sliding towards the middle of the world. The float rides on
    // top scaled, same as below `lg`: a smaller face bobs by proportionally
    // less.
    //
    // `faceFit` is the other half of that: the step down handles the column
    // getting narrower at a fixed window shape, and the fit handles the window
    // itself getting narrower than the shape it was all drawn at.
    if (up.lg) {
      const scale = (up.xl ? 1 : LG_FACE_SCALE) * faceFit;

      group.scale.setScalar(scale);
      group.position.set(
        (1 - scale) * FACE_HOME.x,
        (1 - scale) * FACE_HOME.y + scale * float,
        (1 - scale) * FACE_HOME.z,
      );
      group.visible = true;
      return;
    }

    // ── Below `lg`: a block in the column, wherever the column has got to ───
    //
    // The head is the one part of this section that is geometry rather than
    // type, and below `lg` it is set *in* the type — see <AboutContent />,
    // which reserves a box for it between the stat cards and the skills list.
    // So the group is put where that box is, at the size that box is, every
    // frame: the column scrolls, and the face goes with it because it is being
    // read off the column rather than merely started in the same place.
    //
    // Both ends of the box are traced onto the face's own plane, which gives
    // the middle to sit on and the height to scale by in one pair of rays.
    const slot = readFaceSlot();
    if (!slot) {
      // measured before the column has been laid out, or across a resize past
      // the breakpoint: better nowhere than a full-size face over the copy
      group.visible = false;
      return;
    }

    // The column is ordinary page content now, so the box's document position
    // is fixed and the only thing that moves is the page under it — see
    // ./faceSlot. One subtraction, against a scroll the frame loop has already
    // read, in place of the projection the old fixed layer needed.
    const top = slot.pageTop - scrollY.current;
    const x = slot.left + slot.width / 2;

    if (
      !screenToFacePlane(
        x,
        top,
        state.camera,
        size.width,
        size.height,
        slotTop,
      ) ||
      !screenToFacePlane(
        x,
        top + slot.height,
        state.camera,
        size.width,
        size.height,
        slotBottom,
      )
    ) {
      return; // the plane is behind the camera; keep the last good placement
    }

    const scale = slotTop.distanceTo(slotBottom) / FACE_HEIGHT;
    slotMid.addVectors(slotTop, slotBottom).multiplyScalar(0.5);

    // The group is scaled about its own origin, so the anchor has to be scaled
    // with it: this is the transform that puts FACE_HOME — the point the whole
    // face is laid out around — on the middle of the slot. The float rides on
    // top of it, scaled too, so a smaller face bobs by proportionally less
    // rather than swimming in its hole.
    group.scale.setScalar(scale);
    group.position.set(
      slotMid.x - scale * FACE_HOME.x,
      slotMid.y - scale * (FACE_HOME.y - float),
      slotMid.z - scale * FACE_HOME.z,
    );
    group.visible = true;
  });

  const handleGrabbing = useCallback(
    (payload: null | "head" | "eyes" | "mouth") => {
      setGrabbing(payload);
    },
    [],
  );

  /**
   * The face has actually been disturbed — a piece moved, not merely pressed.
   *
   * This is what retires the float, rather than the grab itself: holding a
   * piece pauses the bob on its own (see the frame loop's `grabbing` check), so
   * a press that puts the piece straight back down leaves the scene exactly as
   * it found it and the bob picks up where it paused. Only a piece that has
   * actually gone somewhere stops it for good, because from then on the face is
   * something being played with rather than something sitting there.
   */
  const handleDisturbed = useCallback(() => {
    shouldFloat.current = false;
  }, []);

  /**
   * The part of the mount state that isn't <Head />'s to put back.
   *
   * The float is retired by the first piece that actually moves and never
   * started again, so a face returned to its home spot would otherwise sit
   * there dead still. Picked up
   * where it was left rather than rewound to the top of its cycle: the bob is a
   * sine of the accumulated time and the face has been sitting at whatever
   * height that sine was frozen at ever since, so starting the clock again from
   * zero would drop it up to the full amplitude in a single frame — which is
   * the one snap in a reset that is otherwise all easing. Nobody can tell which
   * part of a bob they are watching; they can tell it jumped.
   */
  const handleReset = useCallback(() => {
    setGrabbing(null);
    shouldFloat.current = true;
  }, []);

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

      {/* The mobile draft has no giant "ABOUT" behind the column, and there is
          nowhere for one to be: it is a fixed piece of world geometry, so it
          would hang in the middle of the screen while the column scrolled past
          it. The <h2> in <AboutContent /> is the heading either way. */}
      {up.lg && (
        <Suspense fallback={null}>
          <Title />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {/* no hands on it under a finger — see the prop */}
        <Head
          ref={head}
          onGrabbing={handleGrabbing}
          onDisturbed={handleDisturbed}
          onReset={handleReset}
          still={coarsePointer || !up.lg}
        />
      </Suspense>
    </group>
  );
}
