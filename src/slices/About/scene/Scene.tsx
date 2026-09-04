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
import { aboutExitProgress } from "./aboutExit";
import { publishBackdrop } from "@/app/helpers/backdrop";
import { useScrollY } from "@/app/hooks/ScrollY";
import { ABOUT_EXIT_LIFT, ABOUT_POSE, poseFrame } from "@/app/components/poses";
import { smoothstep } from "@/slices/Works/scene-core/path";
import { worksProgress } from "@/slices/Works/scene/worksScroll";
import {
  TUNNEL,
  WALL_Z,
  wallCell,
  wallColumnCount,
  wallColumns,
  wallRows,
  worksSectionVh,
} from "@/slices/Works/scene-core/presets";

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
  /**
   * How far through the section's exit the scene is, 0 to 1 — see the exit in
   * <Scene />, which is what writes it.
   *
   * A uniform object rather than a number, shared by both grids: the exit is
   * read every frame off a scroll React never sees, and handing it over this
   * way keeps it that way. Setting `.value` is the entire update.
   */
  exit: { value: number };
  /**
   * The flat alpha the grid arrives at when `exit` reaches 1 — see
   * {@link GRID_EXIT_OPACITY}, which is the one this is set from.
   */
  exitOpacity: number;
  /**
   * Whether this grid is still the one carrying the wall, 1 to 0 — see
   * {@link HANDOVER_VH}. A uniform object for `exit`'s reason: it is written
   * every frame off a scroll React never sees.
   */
  live: { value: number };
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
  uniform float uExit;
  uniform float uExitOpacity;
  uniform float uLive;

  varying vec2 vWorld;

  void main() {
    // an ellipse inscribed in the viewport: 0 at the centre and 1 on all four
    // edges whatever the aspect is
    float d = length((vWorld - uCenter) / uRadius);

    // smoothstep rather than the raw distance: it clamps at both ends, so the
    // parts of a line that run off screen stay pinned at full strength, and it
    // eases in and out instead of kinking where the ramp starts
    float t = smoothstep(uStops.x, uStops.y, d);

    float alpha = mix(uOpacity.x, uOpacity.y, t);

    // The exit, in one mix, because the two halves of it are the same move.
    // The vignette is anchored to the screen while the lines rise through it,
    // so once the section is moving that hole in the middle stops reading as
    // depth and starts reading as a mark on the glass — a still shape over
    // travelling content. Both ends of the falloff are walked onto a single
    // value as the lift runs, which is what takes the mask off; that the value
    // is a level of its own is what carries the grid up to (or down to) it on
    // the way. So the grid leaves the top of the screen even, at whatever
    // uExitOpacity is set to.
    alpha = mix(alpha, uExitOpacity, uExit);

    // And then out altogether, once the wall itself is drawing this lattice —
    // see {@link HANDOVER_VH}. Two copies of one grid is one grid too many, and
    // the copy that has to go is the one with edges.
    gl_FragColor = vec4(uColor, alpha * uLive);
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
  exit,
  exitOpacity,
  live,
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
      uExit: exit,
      uExitOpacity: { value: exitOpacity },
      uLive: live,
    }),
    [color, opacity, mask, exit, exitOpacity, live],
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
        // The wall these are ruled on carries its own lines a tenth of a unit
        // behind them — see {@link WALL_Z} — and a transparent line that wrote
        // depth would reject every one of those along its whole length.
        depthWrite={false}
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

/**
 * How far the plane's top edge has dipped by the time it reaches `x`.
 *
 * The same cubic {@link useUCurvePlane} cuts the shape with, asked the other
 * way round: the curve is written in `t` and the grid wants the depth at a
 * given x. x(t) runs monotonically from one side to the other, so a bisection
 * inverts it exactly; the y half collapses to `3 * d * t * (1 - t)`, both
 * control points being the same depth down.
 */
function topEdgeDip(x: number, width: number, depth: number) {
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const u = 1 - t;
    const at =
      width *
      (0.5 * u * u * u + 0.75 * u * u * t - 0.75 * u * t * t - 0.5 * t * t * t);

    if (at > x) lo = t;
    else hi = t;
  }

  const t = (lo + hi) / 2;
  return 3 * depth * t * (1 - t);
}

/**
 * How far behind the wall the black plane hangs.
 *
 * The depth is not this section's to pick any more: the grid is ruled on the
 * Works tunnel's opening wall — see {@link WALL_Z}, where the reasoning is —
 * and the backdrop is what stands behind it. It has to stand *clear* of it,
 * because two opaque coplanar planes z-fight across the whole screen the moment
 * the tunnel is drawn. Ten units is invisible at this distance and settles it.
 */
const BACKDROP_BEHIND = 10;

/** depth the backdrop plane sits at */
const BACKDROP_Z = WALL_Z - BACKDROP_BEHIND;

/** how far in front of the wall the grid sits, clear of z-fighting */
const GRID_OFFSET = 0.1;

/**
 * How much of the flight's opening the grid takes to hand the wall over, in vh.
 *
 * From the frame the flight starts, the tunnel draws this same lattice on this
 * same plane — so this grid is a second copy of it, and a copy that stops at
 * the edges of a 2000 unit plane where the wall carries on. Left drawn, that
 * edge sweeps up the screen as the camera falls, which is a seam in a surface
 * that is supposed to be continuous. So it goes out over the opening instead.
 *
 * Short enough to be gone before the plane's own bottom edge rises into frame:
 * that edge starts about 180 units below the fold, and the launch opens at
 * about 5.7 units of fall per vh — see `flightDistance` in
 * ../../Works/scene-core/presets.
 */
const HANDOVER_VH = 25;

/** the backdrop plane's span, and how deep its top edge dips at the centre */
const PLANE_W = 2000;
const PLANE_H = 2000;
const PLANE_CURVE = 60;

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
 * The flat alpha the grid lands on once the section has fully left, reached
 * over the same screen the lift takes.
 *
 * It used to be the knob here. It isn't one any more, and it can't be: the grid
 * does not end when the section does — the Works tunnel's wall carries the same
 * lattice on the same plane, see {@link WALL_Z} — so this is that wall's own
 * level, read off it. Set the two apart and the background changes brightness
 * on the frame the flight takes it over, which is the one thing the whole
 * arrangement exists to avoid. The knob moved with it: it is TUNNEL.level.
 *
 * One number and not a pair, because the falloff is the other thing the exit is
 * spending: both ends of {@link GRID_OPACITY} converge here as it runs, so the
 * grid goes out the top of the screen even, with the vignette gone. Which end
 * of GRID_OPACITY it lands against is still the character of the move — above
 * the edge figure (0.07) the grid comes up out of the vignette as it leaves, at
 * it the mask simply dissolves at the strength it already had.
 */
const GRID_EXIT_OPACITY = TUNNEL.level;

/**
 * The plane the face is authored on, as a plane the pointer maths can hit.
 * `n dot p + c = 0` with n = +Z solves to `p.z = -c`, so the constant is the
 * depth negated.
 */
const facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -FACE_HOME.z);

/**
 * How far the whole scene rises as the section leaves.
 *
 * One screen at the face's depth, so that what the exit spends is one screen
 * *for the head* — which sends it up the page at exactly the rate the column
 * beside it goes. The figure itself is worked out in {@link ABOUT_EXIT_LIFT},
 * which is shared: the Works section starts its flight at the speed this ends
 * on, because the two sections are moving the same wall.
 *
 * The whole group moves rather than the camera, and the two are the same
 * picture: the camera holds ABOUT_POSE looking straight down -Z, so translating
 * everything up by `d` and dropping the camera by `d` put every pixel in the
 * same place. What differs is what else is in the frame. The camera is shared
 * with the section below, which has its own geometry and no reason to be looked
 * at from lower down; the group is this section's alone.
 *
 * A rigid translation, so the depths sort themselves out: a share of the screen
 * is a *smaller* distance the nearer a thing is to the camera, so the same
 * world units the face spends crossing one screen carry the grid and the
 * backdrop 800 units behind it about two thirds of one. The scene comes apart
 * with depth as it goes, which is the parallax a camera move has and a page
 * scrolling away does not — and it is why the head, not the grid, is the piece
 * the figure is taken at. It is the one the column is built around.
 */
const exitLift = ABOUT_EXIT_LIFT;

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
  const root = useRef<THREE.Group | null>(null);
  const grid = useRef<THREE.Group | null>(null);
  const head = useRef<THREE.Group | null>(null);
  // the page position Lenis has eased to this frame — the same one the layer
  // the head is being fitted into is placed by
  const { scrollY } = useScrollY();

  /**
   * The exit progress the two grids are drawn through — see the `exit` prop.
   * Written in the frame loop right beside the lift it is taken from, so the
   * fade and the movement can't end up a frame apart.
   */
  const gridExit = useMemo(() => ({ value: 0 }), []);

  /**
   * And whether it is still the grid being looked at, or the wall is — see
   * {@link HANDOVER_VH}. Written in the same place and for the same reason.
   */
  const gridLive = useMemo(() => ({ value: 1 }), []);

  /** the section below's scroll, in vh, so its progress can be read as one */
  const flightVh = useMemo(() => Math.max(1, worksSectionVh() - 100), []);

  const [grabbing, setGrabbing] = useState<null | "head" | "eyes" | "mouth">(
    null,
  );
  const timeRef = useRef(0);
  const shouldFloat = useRef(true);

  const { geometry: planeGeo, outline: planeOutline } = useUCurvePlane(
    PLANE_W,
    PLANE_H,
    PLANE_CURVE, // 👈 increase/decrease this for a deeper/shallower U
    96, // 👈 smoothness
  );

  const planePos = useMemo<[number, number, number]>(
    () => [0, !up.md ? -1205 : -1005, BACKDROP_Z],
    [up.md],
  );

  /**
   * How many columns the wall is ruled into: the tunnel's own count, because
   * this grid is that wall. A coarse pointer gets fewer of them, and that is
   * the one thing about the lattice that isn't fixed.
   */
  const columns = wallColumnCount(coarsePointer);

  /**
   * The verticals.
   *
   * Their x is the wall's rather than a table of this section's, so what the
   * flight opens on is the grid already on screen instead of a second one laid
   * over it — see {@link WALL_Z}. Where each line *hangs from* is still this
   * section's: the tops are set on the U the plane is cut with, so the grid
   * ends along that curve rather than straight across it.
   */
  const lines = useMemo(
    () =>
      wallColumns(columns, PLANE_W / 2).map((x) => ({
        x,
        y: planePos[1] - topEdgeDip(x, PLANE_W, PLANE_CURVE),
      })),
    [columns, planePos],
  );

  /**
   * And the rows, which are the wall's rings. In world y, not against the
   * plane: the plane drops at `md` and the tunnel does not, and a grid that
   * went with it would be off the rings by that much.
   *
   * One row further down than the plane's own bottom edge, because the section
   * rises a screen as it leaves (see {@link exitLift}) and the grid rises
   * with it — that last row is the one that comes up into the empty band the
   * lift would otherwise open at the foot of the screen.
   */
  const hLines = useMemo(() => {
    const cell = wallCell(columns);

    return wallRows(
      columns,
      planePos[1] - PLANE_H / 2 - cell,
      planePos[1] + PLANE_H / 2,
    ).map((y) => ({ x: 0, y }));
  }, [columns, planePos]);

  const size = useThree((s) => s.size);
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov);

  /** see {@link FACE_FIT_ASPECT} — 1 on anything as wide as the design */
  const faceFit = useMemo(
    () => Math.min(1, size.width / size.height / FACE_FIT_ASPECT),
    [size.width, size.height],
  );

  /**
   * How far the *grid* rises over that same screen: the lift, snapped to a
   * whole number of cells.
   *
   * Snapped because the lattice has to still be the wall's on the frame the
   * flight takes it over. The grid is the only part of the scene the tunnel
   * also draws, and a rise of any old distance leaves its rows a fraction of a
   * cell off the rings — and a grid a fraction of a cell out is not one grid
   * slightly wrong, it is two grids. What the rounding costs is the difference
   * between the lift and the nearest whole number of cells: 33 world units at
   * the full column count, 25 at the coarse one, both around a thirtieth of a
   * screen at this depth. Nobody can read that as the background having risen
   * the wrong distance. Two grids they can read.
   */
  const gridLift = useMemo(() => {
    const cell = wallCell(columns);
    return Math.round(exitLift / cell) * cell;
  }, [columns]);

  /**
   * The falloff the grid is drawn through: an ellipse inscribed in the
   * viewport, sized at the grid's own depth so it tracks the screen edges
   * rather than the backdrop's arbitrary 2000-unit span. Resize work only.
   *
   * The pose's frustum and not the group's own position, so the vignette stays
   * where the *screen* is while the grid rises through it as the section leaves
   * — a falloff that travelled with the lift would be no falloff at all.
   *
   * Which is the same reason it doesn't survive the lift: being pinned to the
   * screen is exactly what makes it wrong once the scene is moving, so the
   * shader retires it over that screen. See LINE_FRAGMENT.
   */
  const gridMask = useMemo(() => {
    const frame = poseFrame(
      ABOUT_POSE,
      fov,
      size.width / size.height,
      WALL_Z + GRID_OFFSET,
    );

    return {
      center: frame.center,
      radius: [frame.width / 2, frame.height / 2] as [number, number],
      stops: GRID_FADE,
    };
  }, [fov, size.width, size.height]);

  // The plane is the only thing in the page that can occlude the hero's DOM
  // overlays, so publish where it is. Once is enough: the only thing that ever
  // moves it is the exit above, and by then the overlays reading this are three
  // sections up the page and have nothing left to hide behind.
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
    // ── The exit ───────────────────────────────────────────────────────────
    //
    // The last screen of the section, where <AboutContent /> comes unpinned all
    // at once and rides the wheel off the top of the page — see ./aboutExit,
    // which is where the moment is decided, and {@link exitLift} for how far
    // this goes in that time. Set before the early return below, so the scene
    // still leaves on a frame where the head has not mounted.
    //
    // Only from `lg` up, and that is not a taste. Below it the head is placed
    // *from the column*, in screen coordinates, against a group this would have
    // moved out from under it — and there is nothing to solve down there
    // anyway, where the whole section is ordinary flow and leaves by scrolling.
    const exit = up.lg ? aboutExitProgress(scrollY.current) : 0;

    if (root.current) root.current.position.y = exit * exitLift;
    // and the grid rides the rounding back off the group — see {@link gridLift}
    if (grid.current) grid.current.position.y = exit * (gridLift - exitLift);

    // Handed over to the wall as the flight opens — see {@link HANDOVER_VH}.
    // The Works section's own progress, read the way that section reads it, so
    // the two cannot disagree about when the flight has started.
    const flown = worksProgress(scrollY.current);
    gridLive.value =
      flown <= 0 ? 1 : 1 - smoothstep((flown * flightVh) / HANDOVER_VH);

    // The grid leaves on the same figure, in both senses of leaving: its
    // vignette flattens out and the lines come up to {@link GRID_EXIT_OPACITY}
    // across that screen. See LINE_FRAGMENT, where the two are actually spent.
    gridExit.value = exit;

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
      const scale = (up.xl ? 0.92 : LG_FACE_SCALE) * faceFit;

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
    /* The box the section leaves in — see {@link exitLift}. Everything the
       About scene is made of hangs off it, the backdrop included: the plane is
       what stands behind the grid, so leaving it where it was would be a lift
       that slid its own bottom edge up into frame. */
    <group ref={root}>
      <mesh ref={plane} position={planePos}>
        <primitive object={planeGeo} attach="geometry" />
        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
      </mesh>

      {/* On the wall, not on the plane — see {@link WALL_Z}. The lines carry
          their own world y so the rows stay on the tunnel's rings; the only
          thing the group is for is the depth, and the rounding the exit rides
          off the rest of the scene. */}
      <group ref={grid} position-z={WALL_Z}>
        <Lines
          lines={lines}
          span={PLANE_H}
          mask={gridMask}
          opacity={GRID_OPACITY}
          exit={gridExit}
          exitOpacity={GRID_EXIT_OPACITY}
          live={gridLive}
          thickness={1.5}
          z={GRID_OFFSET}
        />
        <Lines
          lines={hLines}
          span={PLANE_W}
          mask={gridMask}
          opacity={GRID_OPACITY}
          exit={gridExit}
          exitOpacity={GRID_EXIT_OPACITY}
          live={gridLive}
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
