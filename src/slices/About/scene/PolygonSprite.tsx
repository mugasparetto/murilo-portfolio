import {
  useRef,
  useMemo,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useThree, useFrame, type Size } from "@react-three/fiber";
import * as THREE from "three";

import { setPageCursor } from "@/app/helpers/cursor";

// New exported handle type
//
// The readers all take an optional `out`. The collision loop calls them several
// times a frame for three pieces, and handing them somewhere to write is what
// keeps that loop from minting a fresh vector on every read.
export type SpriteHandle = {
  getPosition: (out?: THREE.Vector3) => THREE.Vector3;
  setPosition: (v: THREE.Vector3) => void;
  getVelocity: (out?: THREE.Vector3) => THREE.Vector3;
  setVelocity: (v: THREE.Vector3) => void;
  /**
   * Polygon in world XY space. The array and its vectors are reused between
   * calls on the same sprite, so copy anything you need to keep past the next
   * call. Two different sprites never share a buffer, which is what lets a
   * pairwise test hold both polygons at once.
   */
  getWorldPolygon: () => THREE.Vector2[];
  isDragging: () => boolean;
  getCentreBox: () => THREE.Box3 | null;
  /**
   * A second box to narrow this sprite's own walls with, in the same space as
   * `bounds`; the walls in force become the intersection of the two. Copied, not
   * held. `null` clears it.
   *
   * It exists so a caller that has bonded several sprites together can hold each
   * of them to the walls of *all* of them. Without it the wall a group is
   * drifting into only stops the one piece that reaches it first, and the rest
   * carry on through — which for a group meant to be rigid means it comes apart
   * against the wall.
   */
  setExtraBounds: (box: THREE.Box3 | null) => void;
  setEnabled: (enabled: boolean) => void;
  getGroup: () => THREE.Object3D;
  setInteractable: (value: boolean) => void;
};

// ─── Throw tuning ─────────────────────────────────────────────────────────────

/**
 * The throw is measured from the *pointer*, in screen pixels, and only turned
 * into world units at release.
 *
 * Measuring the sprite's world position instead — which is what this did — reads
 * the camera's motion as if it were the user's. The parallax rig keeps easing
 * the camera toward the cursor for a few hundred ms after the pointer stops, and
 * the world point under a stationary cursor slides ~40 units with it. Since the
 * sprite only re-aimed on `pointermove`, the next twitch of the hand cashed all
 * of that drift in at once: one huge jump over a couple of milliseconds, in a
 * direction that had nothing to do with the drag. Hence "nudge it slightly, let
 * go, watch it rocket off sideways".
 */

/** Pointer speed, in world units/sec, below which a release is not a throw. */
const THROW_SPEED_THRESHOLD = 260;
/** Ceiling on the launch speed, in world units/sec. */
const MAX_THROW_SPEED = 900;
/**
 * How hard speed above the threshold turns into launch speed. The launch ramps
 * up *from* a standstill at the threshold rather than starting there, so a flick
 * that barely clears it barely moves the piece.
 */
const THROW_GAIN = 1.15;
/** Fraction of the coasting velocity that survives one second of friction. */
const FRICTION = 0.2;
/** Fraction of the wall-normal speed that survives a bounce off the bounds. */
const WALL_RESTITUTION = 0.65;
/** Only pointer motion from the last this-many ms feeds the throw… */
const VELOCITY_WINDOW_MS = 90;
/** …and that window has to span at least this long before it's trusted. */
const MIN_VELOCITY_SPAN_MS = 24;
/** Below this speed, in world units/sec, a coasting piece is parked. */
const REST_SPEED = 1;
/** Longest step the coast loop integrates, so a frame hitch can't tunnel. */
const MAX_COAST_STEP = 1 / 30;
/**
 * How far a piece may drift between two frames and still count as parked, in
 * world units. Parked is what buys a piece the right not to be shoved by a wall
 * moving onto it — see the walls loop.
 *
 * Not zero, because a piece being carried by one it is bonded to closes the last
 * of that gap asymptotically and never quite stops. Under this it is close
 * enough to standing still that letting a wall stop on it costs the wall the
 * same fraction of a unit.
 */
const PARKED_EPSILON = 0.05;
/**
 * How far outside its walls a piece at rest has to be found before it is walked
 * back in, in world units.
 *
 * With `viewport` bounds the walls are re-measured from the live camera every
 * frame, so they move — the parallax sway slides them tens of units, and a
 * resize or an orientation change moves them by however much the frustum
 * changed. A piece that has come to rest is touched by nothing else: the drag
 * loop wants a drag and the coast loop wants a velocity. So a wall can sweep
 * across a parked piece and simply leave it outside, hanging over the edge of
 * the screen until something happens to move it again.
 *
 * The slack is what keeps the fix from welding parked pieces to the screen edge
 * and walking them around with the sway. At the About pose the rig moves the
 * camera by at most half its `strength` (±50 world units on X), and the pieces
 * sit ~23% of the way from the camera to the look-at target, so the walls at
 * their depth slide about ±40: an ordinary pointer sweep opens up far less than
 * this slack and goes on being ignored. A corner-to-corner sweep against a piece
 * parked at the far extreme can just reach it, and by then the piece really is
 * that far out of frame, so bringing it back is the right answer anyway.
 *
 * Once it does trigger the piece is walked all the way back in rather than back
 * to the slack, or it would park on the new edge of it and strand again on the
 * next nudge.
 */
const STRANDED_SLACK = 80;
/** How much of the remaining trip back in a stranded piece makes per 60Hz frame. */
const STRANDED_RECOVER = 0.08;
/** Below this, in world units, the walk back is over. */
const STRANDED_SETTLE = 0.5;
/**
 * How far each collision vertex is pushed off the polygon's centroid, in UV
 * space. Negative shrinks the hull, so pieces have to overlap a little before
 * they push each other apart.
 */
const POLYGON_INFLATE = -0.03;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A 2D point in UV space [0,1] where (0,0) = bottom-left, (1,1) = top-right */
export type UV = [number, number];

export type SpriteBounds = {
  min: [number, number, number];
  max: [number, number, number];
  /**
   * Put the X/Y walls on the screen edges instead of on `min`/`max`, measured
   * every frame at the sprite's own depth. `min`/`max` stay on as the outer
   * limit those walls are clipped to; pass ±Infinity on an axis to hand it to
   * the screen entirely.
   */
  viewport?: boolean;
  /** World units to pull the screen walls in by. Ignored without `viewport`. */
  padding?: number;
};

interface PolygonSpriteProps {
  texture: THREE.Texture;
  /** Polygon vertices in UV space [0,1]. Defined once, clockwise or CCW – doesn't matter. */
  polygon: UV[];
  position?: [number, number, number];
  scale?: [number, number, number] | number;
  /** Allow the sprite to be dragged around the scene. Default: false. */
  draggable?: boolean;
  /**
   * When true, releasing after a fast drag throws the sprite — it coasts
   * with friction until it stops. Requires draggable. Default: false.
   */
  throwable?: boolean;
  /**
   * Axis-aligned world-space box the sprite bounces inside.
   * Only the axes you specify are constrained — omit an axis pair to leave
   * that direction unbounded. Works during both throw and drag.
   * The polygon's own extents are automatically subtracted from each wall,
   * so the visible sprite edge never crosses the boundary.
   *
   * @example
   * bounds={{ min: [-10, -Infinity, -10], max: [10, Infinity, 10] }}
   * bounds={{ viewport: true, min: [-Infinity, -10, 0], max: [Infinity, 10, 5] }}
   */
  bounds?: SpriteBounds;
  /** Fired when the pointer is pressed down inside the polygon */
  onPointerDown?: () => void;
  /** Fired when the pointer is released, after a press that started inside the polygon */
  onPointerUp?: () => void;
  /** Render a coloured debug overlay so you can tune the polygon + bounds box */
  debug?: boolean;
  children?: React.ReactNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pointInPolygon(px: number, py: number, polygon: UV[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// These run on every pointermove, so they reuse one set of instances rather
// than building a Raycaster, a Plane and half a dozen vectors per event.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const spriteWorldPos = new THREE.Vector3();
const planeNormal = new THREE.Vector3();
const facingPlane = new THREE.Plane();
const hitPoint = new THREE.Vector3();
const scaleProbe = new THREE.Vector3();
/** Nearest point inside the walls, for the stranded check in the coast loop. */
const insideWalls = new THREE.Vector3();

/**
 * Which sprite currently owns the pointer.
 *
 * All three listen on `document` and their polygons overlap in world space once
 * the face comes apart, so a press inside an overlap used to start a drag on two
 * pieces at once — both then followed the cursor and shoved each other.
 */
let dragOwner: object | null = null;

/**
 * Whether a press landed on a real DOM control rather than on the scene.
 *
 * The sprites hit-test against their own geometry and know nothing about the
 * HTML layered over the canvas, so without this they happily grab straight
 * through a link. Opt anything else out with `data-no-drag`.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.(
    "a, button, input, textarea, select, label, [data-no-drag]",
  );
}

/**
 * The canvas rect, taken from R3F rather than measured.
 *
 * `size` is the canvas's own bounds — the element R3F observes fills the styled
 * container exactly — kept up to date by a ResizeObserver, so reading it costs
 * nothing. `getBoundingClientRect` here does not: this runs from a `pointermove`
 * handler, three of them per event, and Lenis has already dirtied the layout by
 * scrolling the document in the frame before, so the first call of each event
 * forces a synchronous reflow of the whole page.
 */
function aimAtPointer(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  size: Size,
) {
  ndc.set(
    ((clientX - size.left) / size.width) * 2 - 1,
    -((clientY - size.top) / size.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
}

function pointerToUV(
  clientX: number,
  clientY: number,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  size: Size,
): UV | null {
  aimAtPointer(clientX, clientY, camera, size);

  mesh.getWorldPosition(spriteWorldPos);
  camera.getWorldDirection(planeNormal);
  planeNormal.negate();

  facingPlane.setFromNormalAndCoplanarPoint(planeNormal, spriteWorldPos);
  if (!raycaster.ray.intersectPlane(facingPlane, hitPoint)) return null;

  mesh.worldToLocal(hitPoint);
  return [hitPoint.x + 0.5, hitPoint.y + 0.5];
}

function pointerToWorldPlane(
  clientX: number,
  clientY: number,
  worldPlane: THREE.Plane,
  camera: THREE.Camera,
  size: Size,
): THREE.Vector3 | null {
  aimAtPointer(clientX, clientY, camera, size);

  // still cloned: callers keep the result past the current event
  return raycaster.ray.intersectPlane(worldPlane, hitPoint)
    ? hitPoint.clone()
    : null;
}

/**
 * World units one screen pixel covers on `worldPlane` — the exchange rate that
 * turns a pointer flick into a throw.
 *
 * The drag plane is perpendicular to the view axis, so the scale is uniform
 * across it and one measurement at the centre holds everywhere. Reading it off
 * two rays rather than off the fov keeps it correct for any camera.
 */
function worldUnitsPerPixel(
  worldPlane: THREE.Plane,
  camera: THREE.Camera,
  size: Size,
): number {
  if (size.width < 1) return 1;

  ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(worldPlane, scaleProbe)) return 1;

  ndc.set(2 / size.width, 0);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(worldPlane, hitPoint)) return 1;

  return scaleProbe.distanceTo(hitPoint) || 1;
}

// Screen corners in NDC, and the scratch the frustum measurement works in.
const NDC_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
const zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
const cornerHit = new THREE.Vector3();
const visibleSpan = new THREE.Box2();
const wall = new THREE.Vector2();

/**
 * The part of the world plane at depth `z` that is on screen right now, written
 * into `out`. False — and `out` untouched — if the plane isn't in front of the
 * camera at all.
 *
 * The rig tilts the camera as it sways, so the frustum cuts that plane as a
 * trapezoid rather than a rectangle. Keeping the *innermost* of each opposing
 * pair of corners inscribes a rectangle in it, which is what a wall wants: it
 * then lies on screen along its whole length. The outer extents would put the
 * wall past the narrow end of the trapezoid, which is the bug this replaces,
 * only smaller. Camera roll is a degree or two here and is ignored.
 */
function visibleSpanAtZ(
  z: number,
  camera: THREE.Camera,
  out: THREE.Box2,
): boolean {
  // Plane normal is +Z, so n·p + c = 0 solves to p.z = -c.
  zPlane.constant = -z;

  let minX = -Infinity;
  let maxX = Infinity;
  let minY = -Infinity;
  let maxY = Infinity;

  for (const [nx, ny] of NDC_CORNERS) {
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(zPlane, cornerHit)) return false;

    if (nx < 0) minX = Math.max(minX, cornerHit.x);
    else maxX = Math.min(maxX, cornerHit.x);
    if (ny < 0) minY = Math.max(minY, cornerHit.y);
    else maxY = Math.min(maxY, cornerHit.y);
  }

  out.min.set(minX, minY);
  out.max.set(maxX, maxY);
  return true;
}

/**
 * One axis of the live box — the tighter of the screen wall and the authored
 * one — written into `out` as (min, max).
 *
 * When the two don't overlap at all the authored pair wins. That case is the
 * camera having left for another section of the page: the piece is nowhere near
 * the screen, and letting the walls follow the camera there would drag it along
 * by the clamp. And if the screen is narrower than the piece, the walls meet in
 * the middle rather than crossing over and clamping to a wall that is now the
 * wrong side of the piece.
 */
/**
 * The tighter of two ranges, written into `out` as (min, max). Ranges that miss
 * each other entirely collapse to the point between them rather than crossing
 * over into a box whose min is past its max, which clamps to nonsense.
 */
function narrowRange(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  out: THREE.Vector2,
) {
  const min = Math.max(aMin, bMin);
  const max = Math.min(aMax, bMax);
  if (min <= max) return out.set(min, max);
  const mid = (min + max) * 0.5;
  return out.set(mid, mid);
}

function resolveWall(
  screenMin: number,
  screenMax: number,
  worldMin: number,
  worldMax: number,
  out: THREE.Vector2,
) {
  if (screenMin > screenMax) {
    const mid = (screenMin + screenMax) * 0.5;
    screenMin = mid;
    screenMax = mid;
  }

  const min = Math.max(screenMin, worldMin);
  const max = Math.min(screenMax, worldMax);
  return min <= max ? out.set(min, max) : out.set(worldMin, worldMax);
}

function buildPolygonGeometry(polygon: UV[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  const ordered = area > 0 ? [...polygon].reverse() : polygon;

  const verts: number[] = [];
  for (const [u, v] of ordered) verts.push(u - 0.5, v - 0.5, 0);

  const indices: number[] = [];
  for (let i = 1; i < ordered.length - 1; i++) indices.push(0, i, i + 1);

  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Compute the X/Y half-extents of the polygon in world space.
 * UV coords map to [-0.5, 0.5] in local space, then get multiplied by scale.
 * These are subtracted from the bounds walls so the sprite's visible edge,
 * not just its centre, stays inside the boundary.
 */
function polygonExtents(polygon: UV[], scale: [number, number, number]) {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  for (const [u, v] of polygon) {
    const lx = (u - 0.5) * scale[0];
    const ly = (v - 0.5) * scale[1];
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  }
  return { minX, maxX, minY, maxY };
}

// ─── Component ────────────────────────────────────────────────────────────────

const PolygonSprite = forwardRef<SpriteHandle, PolygonSpriteProps>(
  function PolygonSprite(
    {
      texture,
      polygon,
      position = [0, 0, 0],
      scale = 1,
      draggable = false,
      throwable = false,
      bounds,
      onPointerDown,
      onPointerUp,
      debug = false,
      children,
    },
    ref,
  ) {
    const meshRef = useRef<THREE.Mesh>(null!);
    const groupRef = useRef<THREE.Group>(null!);
    const { camera, scene, size } = useThree();

    const isPressedRef = useRef(false);
    const isInsideRef = useRef(false);
    const isDraggingRef = useRef(false);
    const interactable = useRef(true);

    const enabledRef = useRef(true);

    const dragPlane = useRef(new THREE.Plane());
    const dragOffset = useRef(new THREE.Vector3());

    /** Screen-space pointer track, newest last. Cleared when the drag ends. */
    type Sample = { x: number; y: number; t: number };
    const velocitySamples = useRef<Sample[]>([]);
    const throwVelocity = useRef(new THREE.Vector3());
    /** Pixels → world units on the drag plane, measured once per grab. */
    const worldPerPixel = useRef(1);
    /** Last pointer position, so the frame loop can re-aim a held piece. */
    const pointerPx = useRef<{ x: number; y: number } | null>(null);
    /**
     * Whether a wall has been left across this piece and it is on its way back
     * in. Latched, so the walk finishes instead of stopping the moment the piece
     * is back inside `STRANDED_SLACK` of the wall.
     */
    const recovering = useRef(false);
    /** Identity handed to `dragOwner` while this sprite holds the pointer. */
    const dragToken = useRef({});

    const pushSample = useCallback((x: number, y: number, t: number) => {
      const samples = velocitySamples.current;
      samples.push({ x, y, t });
      // Keep a little more than the read window, so the read always has
      // something to look back at and a 1000Hz mouse can't grow this unbounded.
      while (samples.length > 1 && t - samples[0].t > VELOCITY_WINDOW_MS * 2) {
        samples.shift();
      }
    }, []);

    /**
     * Pointer velocity in world units/sec over the last `VELOCITY_WINDOW_MS`,
     * written into `out`.
     *
     * Measured as one displacement over one span rather than as a mean of
     * per-event velocities: coalesced events can land a millisecond apart, and
     * averaging their individual speeds let a single such pair carry the whole
     * estimate. Ageing against `now` — not against the newest sample — is what
     * makes a pointer that has come to rest read as stopped.
     */
    const readPointerVelocity = useCallback(
      (now: number, out: THREE.Vector3) => {
        out.set(0, 0, 0);

        const samples = velocitySamples.current;
        if (samples.length < 2) return out;

        const newest = samples[samples.length - 1];
        if (now - newest.t > VELOCITY_WINDOW_MS) return out;

        let oldest = newest;
        for (let i = samples.length - 1; i >= 0; i--) {
          if (now - samples[i].t > VELOCITY_WINDOW_MS) break;
          oldest = samples[i];
        }

        const span = newest.t - oldest.t;
        if (span < MIN_VELOCITY_SPAN_MS) return out;

        const k = worldPerPixel.current / (span / 1000);
        // Screen Y grows downward, world Y upward.
        return out.set(
          (newest.x - oldest.x) * k,
          -(newest.y - oldest.y) * k,
          0,
        );
      },
      [],
    );

    const normalizedScale = useMemo<[number, number, number]>(
      () => (typeof scale === "number" ? [scale, scale, scale] : scale),
      [scale],
    );

    const debugGeometry = useMemo(
      () => (debug ? buildPolygonGeometry(polygon) : null),
      [debug, polygon],
    );

    // Half-extents of the polygon in world space — used to inset the bounce walls
    // so the sprite's visible edge (not its centre) lands on the boundary.
    const extents = useMemo(
      () => polygonExtents(polygon, normalizedScale),
      [polygon, normalizedScale],
    );

    // The collision hull in UV space, inflate already applied. It depends on
    // nothing but the polygon, so there is no reason for `getWorldPolygon` to
    // re-derive the centroid and re-push every vertex on each of the six calls
    // the collision loop makes per frame.
    const hull = useMemo(() => {
      const cx = polygon.reduce((sum, [u]) => sum + u, 0) / polygon.length;
      const cy = polygon.reduce((sum, [, v]) => sum + v, 0) / polygon.length;

      return polygon.map(([u, v]): UV => {
        const du = u - cx;
        const dv = v - cy;
        const len = Math.sqrt(du * du + dv * dv) || 1;
        return [
          u + (du / len) * POLYGON_INFLATE,
          v + (dv / len) * POLYGON_INFLATE,
        ];
      });
    }, [polygon]);

    // Where `getWorldPolygon` writes. One buffer per sprite, so a pairwise test
    // can hold two polygons at once without either of them allocating.
    const worldHull = useMemo(
      () => polygon.map(() => new THREE.Vector2()),
      [polygon],
    );

    // worldBox: the region the group's CENTRE is allowed to move within, as
    // authored. With `viewport` on it is only the outer limit — see liveBox.
    const worldBox = useMemo(() => {
      if (!bounds) return null;
      const { min, max } = bounds;
      const { minX, maxX, minY, maxY } = extents;
      return new THREE.Box3(
        new THREE.Vector3(
          isFinite(min[0]) ? min[0] - minX : -Infinity, // minX is negative, so subtract it
          isFinite(min[1]) ? min[1] - minY : -Infinity, // minY is negative, so subtract it
          min[2],
        ),
        new THREE.Vector3(
          isFinite(max[0]) ? max[0] - maxX : Infinity,
          isFinite(max[1]) ? max[1] - maxY : Infinity,
          max[2],
        ),
      );
    }, [bounds, extents]);

    // The screen-tracking walls, rewritten every frame by the loop below. Held
    // in a ref, not a memo, because it is mutated per frame; it starts unbounded
    // because the first measurement lands before anything can read it, and a box
    // that constrains nothing is the safe thing to be caught holding anyway.
    const tracksViewport = !!bounds?.viewport;
    const liveBox = useRef(
      new THREE.Box3(
        new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        new THREE.Vector3(Infinity, Infinity, Infinity),
      ),
    );

    // A second box to narrow the sprite's own walls with, handed in from
    // outside — see `setExtraBounds`. Kept flat rather than as a nullable box so
    // clearing it costs nothing.
    const extraBounds = useRef(new THREE.Box3());
    const hasExtraBounds = useRef(false);
    const narrowedBox = useRef(new THREE.Box3());
    /**
     * Where the piece was when the walls were last measured. NaN until the
     * first measurement, which is seeded from the piece itself — see the walls
     * loop for why a piece that has never moved is treated as parked rather
     * than as moving.
     */
    const lastWallPos = useRef(new THREE.Vector3(NaN, NaN, NaN));

    /**
     * The walls in force right now. Read it at the point of use — with
     * `viewport` on, the box behind it is rewritten every frame, and the extra
     * box on top of it can change just as often.
     */
    const getCentreBox = useCallback(() => {
      const base = tracksViewport ? liveBox.current : worldBox;
      if (!hasExtraBounds.current) return base;

      const extra = extraBounds.current;
      if (!base) return extra;

      const out = narrowedBox.current;
      narrowRange(base.min.x, base.max.x, extra.min.x, extra.max.x, wall);
      out.min.x = wall.x;
      out.max.x = wall.y;
      narrowRange(base.min.y, base.max.y, extra.min.y, extra.max.y, wall);
      out.min.y = wall.x;
      out.max.y = wall.y;
      narrowRange(base.min.z, base.max.z, extra.min.z, extra.max.z, wall);
      out.min.z = wall.x;
      out.max.z = wall.y;
      return out;
    }, [tracksViewport, worldBox]);

    // ── Screen-tracking walls ────────────────────────────────────────────────
    //
    // Re-measured every frame rather than authored once, because the camera
    // doesn't hold still: the parallax rig sways it toward the cursor, so walls
    // pinned to world units sit where the screen edge was at the rest pose. A
    // piece then bounces off nothing a good fifty units short of the edge on
    // one side, and coasts out of frame on the other.
    //
    // Priority 0 and registered ahead of the two loops below, so all three see
    // the same camera — the one the rig left behind at the end of last frame,
    // which is also the one the pointer is aimed through.
    useFrame(() => {
      if (!tracksViewport || !worldBox || !groupRef.current) return;

      const box = liveBox.current;
      // Z is never anything but the authored pair — the screen has nothing to
      // say about depth.
      box.min.z = worldBox.min.z;
      box.max.z = worldBox.max.z;

      // Measured at the piece's own depth, not at some nominal plane: the
      // pieces sit tens of units apart in Z and the frustum widens between them.
      const pos = groupRef.current.position;
      if (!visibleSpanAtZ(pos.z, camera, visibleSpan)) return; // keep last good walls

      const pad = bounds?.padding ?? 0;

      // Same inset the authored box gets: the walls hold the piece's centre, so
      // pull each one in by how far the polygon reaches that way and the
      // visible edge — not the origin — is what lands on the screen edge.
      resolveWall(
        visibleSpan.min.x - extents.minX + pad,
        visibleSpan.max.x - extents.maxX - pad,
        worldBox.min.x,
        worldBox.max.x,
        wall,
      );
      box.min.x = wall.x;
      box.max.x = wall.y;

      resolveWall(
        visibleSpan.min.y - extents.minY + pad,
        visibleSpan.max.y - extents.maxY - pad,
        worldBox.min.y,
        worldBox.max.y,
        wall,
      );
      box.min.y = wall.x;
      box.max.y = wall.y;

      // ── A wall never shoves a piece that isn't going anywhere ──────────────
      //
      // These walls track the camera, and the camera does not only sway: the
      // scroll rig flies it to another section of the page entirely. On the way
      // out the screen edges sweep straight across the parked pieces, and a
      // wall that keeps its grip through that carries them along with it —
      // scroll up to the hero and come back to find the face shoved into a
      // heap. The pieces sit close to their walls to begin with, so it takes
      // very little camera travel: the mouth's own floor is 245 units above the
      // screen's, which at the About pose leaves it about 39 units of room.
      //
      // The authored `min`/`max` are meant to catch exactly this, but they only
      // bite once the screen has left the authored range altogether — some four
      // hundred units later, by which point the damage is done.
      //
      // So a wall that has moved onto a piece which has not moved simply stops
      // at it. Nothing is dragged and nothing is left outside its walls, which
      // is the same guarantee the stranded walk-back makes, arrived at before
      // the piece is ever stranded. Anything actually in motion — held, coasting
      // or carried along by a piece it is bonded to — is clamped as usual, which
      // is what keeps a piece pushed *into* a wall on the right side of it.
      //
      // The first measurement counts as held still, not as moving. A piece
      // that has only just mounted has never been anywhere but where it was
      // authored, so there is nothing for a wall to be catching up with — and
      // the frame it mounts on is not necessarily one the camera is at rest
      // for. The sprites appear only once their textures have loaded, so a
      // reload partway down the page brings them up with the scroll rig
      // already mid-flight: at the poses either side of the About one the
      // screen floor sits a couple of hundred units above the parked mouth, so
      // a wall taking its grip on that first frame hands the piece straight to
      // the stranded walk-back, which walks it up the screen, through the
      // capture radius, and snaps the face together with nobody having touched
      // it.
      if (Number.isNaN(lastWallPos.current.x)) lastWallPos.current.copy(pos);

      if (
        !isDraggingRef.current &&
        pos.distanceToSquared(lastWallPos.current) < PARKED_EPSILON ** 2
      ) {
        if (pos.x < box.min.x) box.min.x = pos.x;
        else if (pos.x > box.max.x) box.max.x = pos.x;
        if (pos.y < box.min.y) box.min.y = pos.y;
        else if (pos.y > box.max.y) box.max.y = pos.y;
      }
      lastWallPos.current.copy(pos);
    });

    // ── Debug: Box3Helper for the OUTER bounds ────────────────────────────────
    // Added imperatively to the scene so it renders in world space, independent
    // of the sprite's group transform, and aligns with the visible bounce walls.
    // With `viewport` on those walls are usually inside this box — what it draws
    // is the limit the screen ones are clipped to, not where they are.
    useEffect(() => {
      if (!debug || !bounds) return;

      const LARGE = 1e5;
      const safeBox = new THREE.Box3(
        new THREE.Vector3(
          Math.max(bounds.min[0], -LARGE),
          Math.max(bounds.min[1], -LARGE),
          Math.max(bounds.min[2], -LARGE),
        ),
        new THREE.Vector3(
          Math.min(bounds.max[0], LARGE),
          Math.min(bounds.max[1], LARGE),
          Math.min(bounds.max[2], LARGE),
        ),
      );

      const helper = new THREE.Box3Helper(safeBox, new THREE.Color(0x00ff88));
      scene.add(helper);
      return () => {
        scene.remove(helper);
      };
    }, [debug, bounds, scene]);

    useEffect(() => {
      // Pinned for the life of the effect so the cleanup below compares against
      // the same identity the handlers claimed with.
      const token = dragToken.current;

      const handlePointerDown = (event: PointerEvent) => {
        if (!enabledRef.current) return;
        if (!interactable.current) return;
        if (!meshRef.current) return;
        if (dragOwner) return; // another piece already has the pointer
        // Real DOM controls win the press. The nav pill is fixed to the bottom
        // centre of the viewport, which is exactly where the lower slices sit,
        // and a click meant for one of its links shouldn't grab the face.
        if (isInteractiveTarget(event.target)) return;
        meshRef.current.updateWorldMatrix(true, false);

        const uv = pointerToUV(
          event.clientX,
          event.clientY,
          meshRef.current,
          camera,
          size,
        );
        if (!uv) return;
        if (!pointInPolygon(uv[0], uv[1], polygon)) return;

        isPressedRef.current = true;
        setPageCursor("grabbing");
        onPointerDown?.();

        if (!draggable) return;

        // Stop any in-flight throw when the user grabs again
        throwVelocity.current.set(0, 0, 0);

        const spriteWorldPos = new THREE.Vector3();
        meshRef.current.getWorldPosition(spriteWorldPos);

        const normal = new THREE.Vector3();
        camera.getWorldDirection(normal);
        normal.negate();
        dragPlane.current.setFromNormalAndCoplanarPoint(normal, spriteWorldPos);

        const worldHit = pointerToWorldPlane(
          event.clientX,
          event.clientY,
          dragPlane.current,
          camera,
          size,
        );
        if (!worldHit) return;

        dragOffset.current.set(
          worldHit.x - groupRef.current.position.x,
          worldHit.y - groupRef.current.position.y,
          worldHit.z - groupRef.current.position.z,
        );

        // The plane is pinned to the camera axis at grab time, so it never
        // tilts mid-drag: Z stays exactly where it was and the pixel→world
        // scale measured here holds for the whole drag.
        worldPerPixel.current = worldUnitsPerPixel(
          dragPlane.current,
          camera,
          size,
        );

        velocitySamples.current.length = 0;
        pointerPx.current = { x: event.clientX, y: event.clientY };
        if (throwable) {
          pushSample(event.clientX, event.clientY, performance.now());
        }

        isDraggingRef.current = true;
        dragOwner = token;

        // Stop the browser starting a gesture of its own from this press. A
        // native link or text drag paints the no-drop cursor over the page and
        // swallows every pointermove until the button comes up, so the piece
        // sits frozen mid-drag and only catches up on release.
        event.preventDefault();
      };

      // preventDefault on pointerdown covers Chrome, but it isn't a guarantee
      // across browsers — refusing the dragstart outright is.
      const handleDragStart = (event: Event) => {
        if (isDraggingRef.current) event.preventDefault();
      };

      /**
       * Give up the pointer without throwing anything.
       *
       * `pointercancel` is how the browser says it has taken the gesture over —
       * a native drag starting, or touch scrolling winning the pan — and it
       * arrives *instead of* `pointerup`, never alongside it. Without this the
       * piece stays stuck to the pointer and, worse, `dragOwner` is never
       * cleared, so no piece can be grabbed again for the rest of the session.
       */
      const abortDrag = () => {
        if (!isPressedRef.current && !isDraggingRef.current) return;

        isPressedRef.current = false;
        isDraggingRef.current = false;
        pointerPx.current = null;
        velocitySamples.current.length = 0;
        throwVelocity.current.set(0, 0, 0);
        if (dragOwner === token) dragOwner = null;

        onPointerUp?.();
        setPageCursor(isInsideRef.current ? "grab" : "default");
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (isDraggingRef.current && draggable) {
          // Recorded, not applied: the frame loop re-aims the piece so it keeps
          // tracking the cursor while the camera drifts between moves.
          pointerPx.current = { x: event.clientX, y: event.clientY };
          if (throwable) {
            pushSample(event.clientX, event.clientY, performance.now());
          }
          return;
        }

        if (dragOwner) return; // hover is meaningless mid-drag
        if (!meshRef.current) return;
        meshRef.current.updateWorldMatrix(true, false);

        const uv = pointerToUV(
          event.clientX,
          event.clientY,
          meshRef.current,
          camera,
          size,
        );
        if (!uv) return;

        const hit = pointInPolygon(uv[0], uv[1], polygon);
        if (hit && !isInsideRef.current) {
          if (!enabledRef.current) return;
          isInsideRef.current = true;
          setPageCursor(interactable.current ? "grab" : "default");
        } else if (!hit && isInsideRef.current) {
          isInsideRef.current = false;
          setPageCursor("default");
        }
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (!isPressedRef.current) return;

        const wasDragging = isDraggingRef.current;
        isPressedRef.current = false;
        isDraggingRef.current = false;
        pointerPx.current = null;
        if (dragOwner === token) dragOwner = null;

        onPointerUp?.();
        setPageCursor(isInsideRef.current ? "grab" : "default");

        throwVelocity.current.set(0, 0, 0);
        if (!throwable || !wasDragging) {
          velocitySamples.current.length = 0;
          return;
        }

        // The release is itself a sample. Without it, letting go after the
        // pointer had come to rest threw the piece at whatever speed it carried
        // when the last pointermove fired, however long ago that was.
        const now = performance.now();
        pushSample(event.clientX, event.clientY, now);
        readPointerVelocity(now, throwVelocity.current);
        velocitySamples.current.length = 0;

        const speed = throwVelocity.current.length();
        if (speed <= THROW_SPEED_THRESHOLD) {
          throwVelocity.current.set(0, 0, 0);
          return;
        }

        const launch = Math.min(
          (speed - THROW_SPEED_THRESHOLD) * THROW_GAIN,
          MAX_THROW_SPEED,
        );
        throwVelocity.current.multiplyScalar(launch / speed);

        // Don't launch a piece that's already pinned against a wall into it —
        // it would only bounce straight back out on the next frame.
        const box = getCentreBox();
        if (box) {
          const p = groupRef.current.position;
          const v = throwVelocity.current;
          const EDGE = 0.5;
          if (p.x <= box.min.x + EDGE && v.x < 0) v.x = 0;
          if (p.x >= box.max.x - EDGE && v.x > 0) v.x = 0;
          if (p.y <= box.min.y + EDGE && v.y < 0) v.y = 0;
          if (p.y >= box.max.y - EDGE && v.y > 0) v.y = 0;
        }
      };

      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", abortDrag);
      document.addEventListener("dragstart", handleDragStart);
      // Releasing outside the window never delivers a pointerup.
      window.addEventListener("blur", abortDrag);

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.removeEventListener("pointercancel", abortDrag);
        document.removeEventListener("dragstart", handleDragStart);
        window.removeEventListener("blur", abortDrag);
        // Unmounting mid-drag would otherwise lock every other piece out.
        if (dragOwner === token) dragOwner = null;
      };
    }, [
      camera,
      size,
      polygon,
      draggable,
      throwable,
      getCentreBox,
      onPointerDown,
      onPointerUp,
      pushSample,
      readPointerVelocity,
    ]);

    // ── Drag tracking ─────────────────────────────────────────────────────────
    //
    // A held piece is re-aimed every frame rather than on pointermove alone. The
    // parallax rig keeps easing the camera toward the cursor for a few hundred
    // ms after the pointer stops, so a piece pinned to a world point slides out
    // from under the cursor in that time and snapped back on the next move.
    //
    // This runs at priority 0, ahead of the composer's render and of the rig's
    // own camera update, so it aims through exactly the camera the next frame is
    // drawn with.
    useFrame(() => {
      if (!draggable || !isDraggingRef.current) return;

      const p = pointerPx.current;
      if (!p || !groupRef.current) return;

      const worldHit = pointerToWorldPlane(
        p.x,
        p.y,
        dragPlane.current,
        camera,
        size,
      );
      if (!worldHit) return;

      groupRef.current.position.set(
        worldHit.x - dragOffset.current.x,
        worldHit.y - dragOffset.current.y,
        worldHit.z - dragOffset.current.z,
      );

      // Clamp to the inset centre box during drag
      const box = getCentreBox();
      if (box) {
        groupRef.current.position.clamp(box.min, box.max);
      }
    });

    // ── Friction / coasting + bounce + recovery loop ─────────────────────────
    //
    // Everything that keeps a piece honest while it is *not* in the user's hand:
    // it coasts to a stop off the walls, and once stopped it stays inside them
    // even though they move underneath it.
    useFrame((_, delta) => {
      if (!groupRef.current) return;

      const vel = throwVelocity.current;
      const pos = groupRef.current.position;

      if (isDraggingRef.current) {
        vel.set(0, 0, 0);
        recovering.current = false;
        return;
      }

      const b = getCentreBox();

      // ── Coasting: integrate, bounce, rub off some speed ────────────────────
      if (throwable && vel.lengthSq() >= 1e-6) {
        recovering.current = false;

        // A long frame integrates as a short one: better to lose a little travel
        // than to jump the piece through a wall or through another piece.
        const step = Math.min(delta, MAX_COAST_STEP);

        pos.addScaledVector(vel, step);

        if (b) {
          if (pos.x < b.min.x) {
            pos.x = b.min.x;
            vel.x = Math.abs(vel.x) * WALL_RESTITUTION;
          } else if (pos.x > b.max.x) {
            pos.x = b.max.x;
            vel.x = -Math.abs(vel.x) * WALL_RESTITUTION;
          }
          if (pos.y < b.min.y) {
            pos.y = b.min.y;
            vel.y = Math.abs(vel.y) * WALL_RESTITUTION;
          } else if (pos.y > b.max.y) {
            pos.y = b.max.y;
            vel.y = -Math.abs(vel.y) * WALL_RESTITUTION;
          }
          if (pos.z < b.min.z) {
            pos.z = b.min.z;
            vel.z = Math.abs(vel.z) * WALL_RESTITUTION;
          } else if (pos.z > b.max.z) {
            pos.z = b.max.z;
            vel.z = -Math.abs(vel.z) * WALL_RESTITUTION;
          }
        }

        vel.multiplyScalar(Math.pow(FRICTION, step));
        if (vel.lengthSq() < REST_SPEED * REST_SPEED) vel.set(0, 0, 0);
        return;
      }

      // ── At rest: has a wall been moved out from under it? ──────────────────
      //
      // Deliberately not a clamp. A clamp here would pin a parked piece to the
      // screen edge and walk it around with the parallax sway, which is a piece
      // moving on its own — worse than the overhang it fixes. See
      // `STRANDED_SLACK` for where the line is drawn instead.
      if (!b) return;

      insideWalls.copy(pos).clamp(b.min, b.max);
      const outside = insideWalls.distanceTo(pos);

      if (outside > STRANDED_SLACK) recovering.current = true;
      if (!recovering.current) return;

      if (outside < STRANDED_SETTLE) {
        pos.copy(insideWalls);
        recovering.current = false;
        return;
      }

      const frames = Math.min(delta, MAX_COAST_STEP) * 60;
      pos.lerp(insideWalls, 1 - Math.pow(1 - STRANDED_RECOVER, frames));
    });

    useImperativeHandle(
      ref,
      () => ({
        getPosition: (out) =>
          (out ?? new THREE.Vector3()).copy(groupRef.current.position),
        setPosition: (v) => groupRef.current.position.copy(v),
        // How fast the piece is actually moving, whatever is moving it. While
        // it's held that's the pointer, read the same parallax-immune way the
        // throw is — a piece shoved into another one used to report zero, so it
        // displaced its neighbour without ever knocking it anywhere.
        getVelocity: (out) => {
          const target = out ?? new THREE.Vector3();
          return isDraggingRef.current
            ? readPointerVelocity(performance.now(), target)
            : target.copy(throwVelocity.current);
        },
        setVelocity: (v) => throwVelocity.current.copy(v),
        isDragging: () => isDraggingRef.current,
        getCentreBox,
        setExtraBounds: (box: THREE.Box3 | null) => {
          hasExtraBounds.current = !!box;
          if (box) extraBounds.current.copy(box);
        },

        getWorldPolygon: () => {
          const pos = groupRef.current.position;
          const s = normalizedScale;

          for (let i = 0; i < hull.length; i++) {
            const [u, v] = hull[i];
            worldHull[i].set(
              pos.x + (u - 0.5) * s[0],
              pos.y + (v - 0.5) * s[1],
            );
          }
          return worldHull;
        },
        setEnabled: (enabled: boolean) => {
          enabledRef.current = enabled;
          if (!enabled) {
            // Clean up any in-progress drag immediately
            isDraggingRef.current = false;
            isPressedRef.current = false;
            pointerPx.current = null;
            velocitySamples.current.length = 0;
            if (dragOwner === dragToken.current) dragOwner = null;
            throwVelocity.current.set(0, 0, 0);
            setPageCursor("default");
          }
        },
        getGroup: () => groupRef.current,
        setInteractable: (value: boolean) => {
          interactable.current = value; // a new ref inside PolygonSprite
        },
      }),
      [hull, worldHull, normalizedScale, getCentreBox, readPointerVelocity],
    );

    return (
      <group ref={groupRef} position={position}>
        {/* Visible sprite — raycast disabled so R3F never interferes */}
        <mesh
          ref={meshRef}
          scale={normalizedScale}
          raycast={() => null}
          renderOrder={10}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            alphaTest={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {children}

        {/* Debug: polygon overlay */}
        {debug && debugGeometry && (
          <mesh
            scale={normalizedScale}
            position={[0, 0, 0.001]}
            geometry={debugGeometry}
            raycast={() => null}
          >
            <meshBasicMaterial
              transparent
              opacity={0.35}
              color="#0088ff"
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
      </group>
    );
  },
);

export default PolygonSprite;
