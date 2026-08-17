import { RefObject, useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useTexture, Line } from "@react-three/drei";
import MetaBalls, { FieldMask, MetaBallsHandle } from "./MetaBalls";
import PolygonSprite, { UV, SpriteHandle, SpriteBounds } from "./PolygonSprite";
import ThirdEye, { ThirdEyeHandle } from "./ThirdEye";

// ─── Snap configuration ───────────────────────────────────────────────────────

/**
 * XY offset from head → eyes and eyes → mouth in the assembled face.
 * Z is ignored — each sprite keeps its own Z (render layering only).
 */
const EYES_OFFSET = new THREE.Vector2(0, -33.5); // eyes sit below head centre
const MOUTH_OFFSET = new THREE.Vector2(0, -33.5); // mouth sits below eyes

/**
 * Shared iso-surface tuning for every metaball field on the face.
 * Small, varied balls read past a raised threshold, so the thin necks between
 * them break and the goo strings out instead of fusing into one slab.
 *
 * The strings come from the *shape* of each ball's field rather than from the
 * layout: `ballYScale` stretches it along Y so a ball bonds hard with the bars
 * above and below it but only weakly with its sideways neighbours, and
 * `ballTaper` skews that stretch upward so each strand tapers to a thin tail at
 * the top and pools into a bulb underneath — dripping honey, not a bead.
 *
 * The pair that decides whether you see strings or a sheet is `ballRadius` vs.
 * the lane spacing (≈ 0.8 * animationSize * clumpFactor / ballCount). A strand
 * is roughly 2 * ballRadius / sqrt(fieldThreshold) wide, so once that
 * approaches the spacing the strands touch and fuse back into a slab. Keep the
 * radius small and buy the length back with `ballYScale`.
 */
const GOO = {
  ballRadius: 1,
  ballRadiusVariance: 0.9,
  ballYScale: 5,
  ballYScaleVariance: 0.8,
  ballTaper: 0.15,
  // Slightly fatter kernel tail so a strand keeps its bond to the bars as it
  // stretches, instead of snapping the moment it drifts.
  fieldPower: 0.95,
  fieldThreshold: 1.35,
  fieldEdge: 0.01,
  // Volume: thick centres fall into shadow, thin silhouettes catch a wet
  // highlight. Without this the field renders as a flat sticker.
  coreShade: 0.85,
  rimLight: 0.15,
  rimWidth: 5.5,
  // Strands overshoot the iso-surface far less than a fat ball did, so the
  // range that maps to "fully thick" has to come down with them or they read
  // as all rim and no body.
  thicknessRange: 2,
} as const;

/**
 * Overrides for the rear layer of each pair. Depth here is sold by contrast,
 * not by Z — nothing in this group writes depth, so `renderOrder` decides
 * occlusion and everything below is a painterly cue:
 *   darker + softer edge + weaker rim = further away and out of focus,
 *   slower drift + weaker mouse response = parallax against the front layer.
 */
const GOO_BACK = {
  shade: 0.2,
  opacity: 1,
  fieldEdge: 0.5,
  rimLight: 0.08,
  speed: 0.32,
  mouseStrength: 0,
  fieldPower: 0.75,
} as const;

/** Render order for the goo. Sprites sit at 10, so both stay behind the face. */
const BACK_ORDER = 5;
const FRONT_ORDER = 6;

/**
 * Where the head stops, read off the skull cap's own alpha.
 *
 * The plane the goo renders on is deliberately bigger than the head (it has to
 * be, or strands would be cut off before they finished falling), so the field
 * runs off both sides of the face and up over the scalp — the anchor bars alone
 * reach ±15 animation units, wider than the head is at that height.
 *
 * The cap alone is enough to describe the whole outline. Above the floor its
 * alpha traces the dome, which is the only part of the head that actually
 * narrows; below it the width is held, so the seam the goo hangs in — and the
 * eye band under that — stay filled. Measured from the texture, the cap is
 * opaque down to v = 0.7117 and spans u = 0.046–0.997 over its last few rows,
 * the same width the eye band starts at, so the held edge lines up with the
 * face below it.
 */
const HEAD_OUTLINE = {
  /** Just inside the cap's bottom edge (v = 0.7117), with room to spare. */
  floor: 0.74,
};

/**
 * The same trick one slab lower, for the goo hanging in the eye ↔ mouth seam.
 * Reading the eye band instead of the cap does both jobs at once:
 *
 *   above — the band's alpha stops dead at its top edge (v = 0.6623), which is
 *   the floor of the *upper* seam. So the lower goo simply cannot be drawn up
 *   there; the cut lands exactly on the band's own edge, where an opaque sprite
 *   covers it, so nothing shows for it.
 *
 *   below — the width is held, leaving the lower seam and the mouth beneath it
 *   filled, which is the one gap this goo is meant to show through.
 *
 * The floor has to clear the band's bottom cut, which is an arc: full width
 * down to v ≈ 0.450, then gone within another 0.015. Sampling below that would
 * hold the narrow tail of the arc and pinch the goo into a wedge.
 */
const EYE_BAND_OUTLINE = {
  /** Well clear of the arc, where the band still spans u = 0.022–0.985. */
  floor: 0.47,
};

/**
 * Where a piece is allowed to go.
 *
 * `viewport` puts the side and top/bottom walls on the actual screen edges,
 * re-measured every frame at the piece's own depth. Fixed world-unit walls only
 * line up with the screen at the camera's rest pose, and the parallax rig never
 * leaves it there — the piece then bounces off thin air on the side the camera
 * has swayed away from, and off nothing at all on the other.
 *
 * The numbers left below are the outer limit the screen walls are clipped to,
 * and all they still do is catch the camera leaving for another section of the
 * page: the About pose is the last one the scroll rig holds, so the head band
 * is off screen entirely while the hero is up, and without a limit the walls
 * would follow the camera up there and drag the pieces with them. X is handed
 * to the screen outright — a wall there is only ever a wall you can see, and on
 * a wide monitor the frustum is already past where a fixed one would sit.
 */
const PIECE_BOUNDS: SpriteBounds = {
  viewport: true,
  min: [-Infinity, -1100, 2559],
  max: [Infinity, -500, 2601],
};

/** Same, with the mouth's slightly deeper Z ceiling. */
const MOUTH_BOUNDS: SpriteBounds = {
  ...PIECE_BOUNDS,
  max: [Infinity, -500, 2605],
};

/** World-unit XY distance below which two pieces snap together. */
const SNAP_DISTANCE = 20;

/**
 * Lerp factor toward the snap target, expressed per 60Hz frame and rescaled by
 * the real delta below — otherwise the snap is twice as springy on a 120Hz
 * display as it is on a 60Hz one.
 * 1.0 = instant lock; 0.1 = springy follow.
 */
const SNAP_LERP = 0.18;

/**
 * Fraction of the closing speed that survives a piece-to-piece hit. The bounce
 * used to be perfectly elastic, so pieces traded speed forever and a pair
 * resting in contact buzzed against each other.
 */
const COLLISION_RESTITUTION = 0.55;

/**
 * Overlap below this is left alone. Separating every last unit re-triggers on
 * the next frame and reads as a jitter, and nobody can see half a unit.
 */
const CONTACT_SLOP = 0.5;

// ─── Snap state ───────────────────────────────────────────────────────────────

type SnapState = {
  headEyes: boolean; // eyes is locked relative to head
  eyesMouth: boolean; // mouth is locked relative to eyes
};

// ─── Types ────────────────────────────────────────────────────────────────────

type DiskProps = {
  radius: number;
  position: [number, number, number];
  scale: [number, number, number];
  thickness: number;
  renderOrder: number;
};

function HalfCircleWithDisk({
  radius,
  position,
  scale,
  thickness,
  renderOrder = 0,
}: DiskProps) {
  const segments = 100;

  const points = useMemo(() => {
    const curve = new THREE.ArcCurve(0, 0, radius, Math.PI, 0, false);
    return curve.getPoints(segments);
  }, [radius]);

  return (
    <group position={position} scale={scale} renderOrder={renderOrder}>
      {/* Black disk */}
      <mesh position={[0, 0, -1.8]}>
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial color="black" />
      </mesh>

      {/* Thick white arc */}
      <Line
        points={points}
        color="white"
        lineWidth={thickness}
        rotation={[0, 0, Math.PI]}
      />
    </group>
  );
}

const HEAD_POLYGON: UV[] = [
  [0.03, 0.73],
  [0.45, 0.71],
  [1, 0.72],
  [0.95, 0.84],
  [0.75, 0.96],
  [0.55, 1],
  [0.35, 0.98],
  [0.12, 0.9],
];

const EYES_POLYGON: UV[] = [
  [0.01, 0.45],
  [0.5, 0.43],
  [0.98, 0.45],
  [1, 0.67],
  [0.5, 0.64],
  [0.04, 0.67],
];

const MOUTH_POLYGON: UV[] = [
  [0.4, 0.01],
  [0.8, 0.02],
  [0.97, 0.2],
  [0.99, 0.38],
  [0.5, 0.37],
  [0.02, 0.38],
  [0.1, 0.15],
];

// ── Frame-loop scratch ────────────────────────────────────────────────────────
//
// Everything the loops below need to read a position, a velocity or a separating
// axis is preallocated here. Read straightforwardly — a vector per axis, a
// projection object per test, a clone per position read — three pairs of pieces
// came to a few hundred short-lived objects a frame, and the loop is at its
// busiest exactly while a piece is in flight, so the minor collections landed in
// the middle of a throw.
//
// None of it outlives the frame it is written in.

/** Where the assembled face sits. */
const HOME = new THREE.Vector3(0, -800, 2600);
const ZERO = new THREE.Vector3();

const posA = new THREE.Vector3();
const posB = new THREE.Vector3();
const posC = new THREE.Vector3();
const clampPos = new THREE.Vector3();
const velA = new THREE.Vector3();
const velB = new THREE.Vector3();
const boundsA = new THREE.Box2();
const boundsB = new THREE.Box2();

// ── SAT Helpers ───────────────────────────────────────────────────────────────

/**
 * Candidate separating axes, as flat (x, y) pairs. One axis per edge of each
 * polygon, so a pair needs `polyA.length + polyB.length` of them: 15 at most
 * for the three faces below, against the 32 there is room for here. Widen this
 * if a polygon ever grows past that — a typed array drops out-of-range writes
 * silently, and a dropped axis is a missed separation, not a crash.
 */
const satAxes = new Float64Array(64);
/** Filled in by the last `satCollide` that returned true. */
const satHit = { depth: 0, axisX: 0, axisY: 0 };

/** Append one outward edge normal per edge of `poly`, starting at `at`.
 *  Returns the new write head. */
function pushAxes(poly: THREE.Vector2[], at: number): number {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[i + 1 === n ? 0 : i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    satAxes[at++] = -ey / len;
    satAxes[at++] = ex / len;
  }
  return at;
}

/** World-space AABB of a polygon, written into `out`. */
function polygonBounds(poly: THREE.Vector2[], out: THREE.Box2): THREE.Box2 {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const { x, y } = poly[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  out.min.set(minX, minY);
  out.max.set(maxX, maxY);
  return out;
}

/**
 * Separating-axis test. Returns whether the two polygons overlap; on a hit,
 * `satHit` carries the minimum translation depth and the axis to push `b` along
 * to separate them, pointing from `a`'s centre toward `b`'s. Overwritten by the
 * next call.
 */
function satCollide(polyA: THREE.Vector2[], polyB: THREE.Vector2[]): boolean {
  const axisCount = pushAxes(polyB, pushAxes(polyA, 0));

  let minDepth = Infinity;
  let axisX = 0;
  let axisY = 0;

  for (let i = 0; i < axisCount; i += 2) {
    const ax = satAxes[i];
    const ay = satAxes[i + 1];

    let aMin = Infinity,
      aMax = -Infinity;
    for (let j = 0; j < polyA.length; j++) {
      const p = ax * polyA[j].x + ay * polyA[j].y;
      if (p < aMin) aMin = p;
      if (p > aMax) aMax = p;
    }

    let bMin = Infinity,
      bMax = -Infinity;
    for (let j = 0; j < polyB.length; j++) {
      const p = ax * polyB[j].x + ay * polyB[j].y;
      if (p < bMin) bMin = p;
      if (p > bMax) bMax = p;
    }

    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap <= 0) return false;
    if (overlap < minDepth) {
      minDepth = overlap;
      axisX = ax;
      axisY = ay;
    }
  }

  let acx = 0,
    acy = 0;
  for (let i = 0; i < polyA.length; i++) {
    acx += polyA[i].x;
    acy += polyA[i].y;
  }
  acx /= polyA.length;
  acy /= polyA.length;

  let bcx = 0,
    bcy = 0;
  for (let i = 0; i < polyB.length; i++) {
    bcx += polyB[i].x;
    bcy += polyB[i].y;
  }
  bcx /= polyB.length;
  bcy /= polyB.length;

  if (axisX * (bcx - acx) + axisY * (bcy - acy) < 0) {
    axisX = -axisX;
    axisY = -axisY;
  }

  satHit.depth = minDepth;
  satHit.axisX = axisX;
  satHit.axisY = axisY;
  return true;
}

function clampToBounds(sprite: SpriteHandle) {
  const box = sprite.getCentreBox();
  if (!box) return;
  const pos = sprite.getPosition(clampPos);
  pos.clamp(box.min, box.max);
  sprite.setPosition(pos);
}

function dampVelocity(sprite: SpriteHandle, damp: number) {
  const vel = sprite.getVelocity(velA);
  vel.multiplyScalar(damp);
  sprite.setVelocity(vel);
}

/**
 * Resolve one unsnapped pair: separate them along the shallowest axis, then
 * trade an impulse so the hit reads as a knock rather than a silent shove.
 */
function resolvePair(a: SpriteHandle, b: SpriteHandle) {
  const polyA = a.getWorldPolygon();
  polygonBounds(polyA, boundsA);
  const polyB = b.getWorldPolygon();
  polygonBounds(polyB, boundsB);

  // Cheap reject first. A thrown piece spends most of its flight nowhere near
  // the other two, and an AABB miss skips ~thirty axis projections — which is
  // most of the frames of a throw.
  //
  // It also covers for a wrinkle in the test below. SAT only decides convex
  // shapes, and two of the three faces aren't quite convex: EYES dips at
  // [0.5, 0.64] and MOUTH at [0.5, 0.37], each a midpoint sitting a hair below
  // the line between its neighbours. A reflex vertex costs SAT its guarantee
  // that a disjoint pair has a separating edge normal, so it occasionally
  // called a contact between pieces a few units apart. Those were always
  // shallow — sub-unit on a 500-unit sprite, mostly under CONTACT_SLOP — but
  // the box test rules them out for real. Straighten those two vertices if you
  // want the guarantee back rather than the workaround.
  if (!boundsA.intersectsBox(boundsB)) return;
  if (!satCollide(polyA, polyB)) return;

  const { depth, axisX, axisY } = satHit;
  if (depth <= CONTACT_SLOP) return;

  const aDragging = a.isDragging();
  const bDragging = b.isDragging();

  if (!aDragging && !bDragging) {
    const pa = a.getPosition(posA);
    const pb = b.getPosition(posB);
    pa.x -= axisX * depth * 0.5;
    pa.y -= axisY * depth * 0.5;
    pb.x += axisX * depth * 0.5;
    pb.y += axisY * depth * 0.5;
    a.setPosition(pa);
    b.setPosition(pb);
    clampToBounds(a);
    clampToBounds(b);
  } else if (aDragging) {
    const pb = b.getPosition(posB);
    pb.x += axisX * depth;
    pb.y += axisY * depth;
    b.setPosition(pb);
    clampToBounds(b);
  } else {
    const pa = a.getPosition(posA);
    pa.x -= axisX * depth;
    pa.y -= axisY * depth;
    a.setPosition(pa);
    clampToBounds(a);
  }

  const va = a.getVelocity(velA);
  const vb = b.getVelocity(velB);
  const impactSpeed = (va.x - vb.x) * axisX + (va.y - vb.y) * axisY;
  if (impactSpeed <= 0) return; // already separating

  // Equal masses share the impulse; a held piece is effectively infinitely
  // heavy, so the free one takes all of it and gets genuinely knocked away
  // rather than just displaced.
  const held = aDragging || bDragging;
  const impulse = impactSpeed * (1 + COLLISION_RESTITUTION) * (held ? 1 : 0.5);

  if (!aDragging) {
    va.x -= impulse * axisX;
    va.y -= impulse * axisY;
    a.setVelocity(va);
  }
  if (!bDragging) {
    vb.x += impulse * axisX;
    vb.y += impulse * axisY;
    b.setVelocity(vb);
  }
}

type Props = {
  ref: RefObject<THREE.Group | null>;
  onGrabbing: (payload: null | "head" | "eyes" | "mouth") => void;
};

export default function Head({ ref, onGrabbing }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  const headRef = useRef<SpriteHandle>(null);
  const eyesRef = useRef<SpriteHandle>(null);
  const mouthRef = useRef<SpriteHandle>(null);

  const metaBallsHeadFront = useRef<MetaBallsHandle>(null);
  const metaBallsHeadBack = useRef<MetaBallsHandle>(null);
  const metaBallsMouthFront = useRef<MetaBallsHandle>(null);
  const metaBallsMouthBack = useRef<MetaBallsHandle>(null);

  const isComplete = useRef(false);

  const thirdEye = useRef<ThirdEyeHandle>(null);

  // ── Snap state ──────────────────────────────────────────────────────────────
  const snap = useRef<SnapState>({ headEyes: false, eyesMouth: false });

  const scale = useMemo<[number, number, number]>(() => {
    const size = 500;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  // The head's outline, handed to the goo so it can't escape it. Pinned to the
  // sprites' starting transform rather than tracked live — the goo is hidden
  // the moment any piece leaves that spot (see the visibility loop below), so
  // there is never a frame where the two disagree.
  const headMask = useMemo<FieldMask>(
    () => ({
      texture: top,
      position: [0, -800],
      scale: [scale[0] * 0.96, scale[1] * 0.97],
      ...HEAD_OUTLINE,
    }),
    [top, scale],
  );

  // Same inset as the head mask, so both fields are trimmed by the same margin
  // and the two seams read as one face rather than two differently-clipped ones.
  const mouthMask = useMemo<FieldMask>(
    () => ({
      texture: middle,
      position: [0, -800],
      scale: [scale[0] * 0.96, scale[1] * 0.97],
      ...EYE_BAND_OUTLINE,
    }),
    [middle, scale],
  );

  const handleGrab = useCallback(
    (payload: null | "head" | "eyes" | "mouth") => {
      onGrabbing(payload);

      // ── Un-snap on drag ────────────────────────────────────────────────────
      // When the user grabs a piece, break any bond it participates in so it
      // moves freely. The other piece keeps its current position and coasts.
      if (payload === "head" || payload === "eyes") {
        snap.current.headEyes = false;
      }
      if (payload === "eyes" || payload === "mouth") {
        snap.current.eyesMouth = false;
      }

      const headTarget =
        payload === "head" ? "top" : payload === "eyes" ? "bottom" : null;
      const mouthTarget =
        payload === "mouth" ? "bottom" : payload === "eyes" ? "top" : null;

      metaBallsHeadFront.current?.setPauseTarget(headTarget);
      metaBallsHeadBack.current?.setPauseTarget(headTarget);
      metaBallsMouthFront.current?.setPauseTarget(mouthTarget);
      metaBallsMouthBack.current?.setPauseTarget(mouthTarget);
    },
    [onGrabbing],
  );

  // ── Snap + collision frame loop ────────────────────────────────────────────
  useFrame((_, delta) => {
    const head = headRef.current;
    const eyes = eyesRef.current;
    const mouth = mouthRef.current;
    if (!head || !eyes || !mouth) return;

    if (isComplete.current) return;

    const snapState = snap.current;

    // Every per-frame factor below is tuned at 60Hz and rescaled to the real
    // frame time, so the snap feels the same on a 144Hz monitor as on a 60Hz
    // one. Delta is capped so a hitch can't overshoot past the target.
    const frames = Math.min(delta, 1 / 20) * 60;
    const snapLerp = 1 - Math.pow(1 - SNAP_LERP, frames);

    // ── 1. Un-snap if the user is currently dragging a snapped piece ─────────
    //
    // handleGrab fires on pointerdown, which is enough for most cases, but
    // re-checking isDragging() here is the safety net for rapid grabs where
    // the React state hasn't flushed yet.
    if (snapState.headEyes && (head.isDragging() || eyes.isDragging())) {
      snapState.headEyes = false;
    }
    if (snapState.eyesMouth && (eyes.isDragging() || mouth.isDragging())) {
      snapState.eyesMouth = false;
    }

    // ── 2. Drive snapped pieces toward their target offset ───────────────────
    //
    // Only X and Y are driven — Z stays as-is (render layering).
    // After lerping we clamp to bounds so invisible walls still apply.
    if (snapState.headEyes) {
      const headPos = head.getPosition(posA);
      const eyesPos = eyes.getPosition(posB);

      // Target: head XY minus the offset (eyes sit *below* head, so Y is lower)
      const targetX = headPos.x - EYES_OFFSET.x;
      const targetY = headPos.y - EYES_OFFSET.y;

      eyesPos.x += (targetX - eyesPos.x) * snapLerp;
      eyesPos.y += (targetY - eyesPos.y) * snapLerp;
      eyes.setPosition(eyesPos);
      clampToBounds(eyes);

      // Zero out throw velocity so it doesn't fight the lerp
      const vel = eyes.getVelocity(velA);
      vel.multiplyScalar(1 - snapLerp);
      eyes.setVelocity(vel);
    }

    if (snapState.eyesMouth) {
      const eyesPos = eyes.getPosition(posA);
      const mouthPos = mouth.getPosition(posB);

      const targetX = eyesPos.x - MOUTH_OFFSET.x;
      const targetY = eyesPos.y - MOUTH_OFFSET.y;

      mouthPos.x += (targetX - mouthPos.x) * snapLerp;
      mouthPos.y += (targetY - mouthPos.y) * snapLerp;
      mouth.setPosition(mouthPos);
      clampToBounds(mouth);

      const vel = mouth.getVelocity(velA);
      vel.multiplyScalar(1 - snapLerp);
      mouth.setVelocity(vel);
    }

    // ── 3. Proximity check → snap ─────────────────────────────────────────────
    //
    // We check XY distance only. Neither piece should be dragging when we
    // snap — a drag will have already cleared the flag in step 1.
    if (!snapState.headEyes && !head.isDragging() && !eyes.isDragging()) {
      const hp = head.getPosition(posA);
      const ep = eyes.getPosition(posB);
      const dx = hp.x - ep.x - EYES_OFFSET.x; // distance from ideal position
      const dy = hp.y - ep.y - EYES_OFFSET.y;
      if (Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE) {
        snapState.headEyes = true;
        // Kill velocity on the follower (eyes) so there's no pop
        eyes.setVelocity(ZERO);
      }
    }

    if (!snapState.eyesMouth && !eyes.isDragging() && !mouth.isDragging()) {
      const ep = eyes.getPosition(posA);
      const mp = mouth.getPosition(posB);
      const dx = ep.x - mp.x - MOUTH_OFFSET.x;
      const dy = ep.y - mp.y - MOUTH_OFFSET.y;
      if (Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE) {
        snapState.eyesMouth = true;
        mouth.setVelocity(ZERO);
      }
    }

    // ── 4. SAT collision — skip snapped pairs ─────────────────────────────────
    //
    // When two sprites are snapped they're intentionally overlapping at their
    // correct face position, so running SAT would immediately push them apart.
    // We skip the pair entirely; unsnapped pairs still collide normally.
    if (!snapState.headEyes) resolvePair(head, eyes);
    if (!snapState.eyesMouth) resolvePair(eyes, mouth);
    resolvePair(head, mouth); // head↔mouth never snap

    // ── 5. All pairs snapped → fire onComplete once ───────────────────
    if (snapState.headEyes && snapState.eyesMouth) {
      const SUPER_DAMP = 0.85; // tune: higher = stops faster (0–1), per 60Hz frame
      const damp = Math.pow(1 - SUPER_DAMP, frames);

      dampVelocity(head, damp);
      dampVelocity(eyes, damp);
      dampVelocity(mouth, damp);

      const headPos = head.getPosition(posA);
      const eyesPos = eyes.getPosition(posB);
      const mouthPos = mouth.getPosition(posC);

      const dx1 = eyesPos.x - (headPos.x - EYES_OFFSET.x);
      const dy1 = eyesPos.y - (headPos.y - EYES_OFFSET.y);
      const dx2 = mouthPos.x - (eyesPos.x - MOUTH_OFFSET.x);
      const dy2 = mouthPos.y - (eyesPos.y - MOUTH_OFFSET.y);

      const allSettled =
        Math.sqrt(dx1 * dx1 + dy1 * dy1) < 0.5 &&
        Math.sqrt(dx2 * dx2 + dy2 * dy2) < 0.5;

      if (!isComplete.current && allSettled) {
        isComplete.current = true;
        headRef.current?.setInteractable(false);
        eyesRef.current?.setEnabled(false);
        mouthRef.current?.setEnabled(false);
        thirdEye.current?.open();
      }
    }
  });

  useFrame(() => {
    const head = headRef.current;
    const eyes = eyesRef.current;
    const mouth = mouthRef.current;

    if (head && metaBallsHeadFront.current && metaBallsHeadBack.current) {
      const headPosition = head.getPosition(posA);
      if (headPosition.distanceTo(HOME) > 2) {
        metaBallsHeadFront.current?.setVisible(false);
        metaBallsHeadBack.current?.setVisible(false);
        // Resetting z position to fix collisions
        headPosition.z = 2600;
        head.setPosition(headPosition);
      }
    }

    if (
      eyes &&
      metaBallsHeadFront.current &&
      metaBallsHeadBack.current &&
      metaBallsMouthFront.current &&
      metaBallsMouthBack.current
    ) {
      const eyesPosition = eyes.getPosition(posA);
      if (eyesPosition.distanceTo(HOME) > 2) {
        metaBallsHeadFront.current?.setVisible(false);
        metaBallsHeadBack.current?.setVisible(false);
        metaBallsMouthFront.current?.setVisible(false);
        metaBallsMouthBack.current?.setVisible(false);
        // Resetting z position to fix collisions
        eyesPosition.z = 2600;
        eyes.setPosition(eyesPosition);
      }
    }

    if (mouth && metaBallsMouthFront.current && metaBallsMouthBack.current) {
      const mouthPosition = mouth.getPosition(posA);
      if (mouthPosition.distanceTo(HOME) > 4) {
        metaBallsMouthFront.current?.setVisible(false);
        metaBallsMouthBack.current?.setVisible(false);
        // Resetting z position to fix collisions
        mouthPosition.z = 2600;
        mouth.setPosition(mouthPosition);
      }
    }
  });

  return (
    <group ref={ref}>
      <PolygonSprite
        texture={top}
        polygon={HEAD_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        ref={headRef}
        draggable
        throwable
        bounds={PIECE_BOUNDS}
        onPointerDown={() => handleGrab("head")}
        onPointerUp={() => handleGrab(null)}
      >
        {/* Rides the skull cap, so it stays put through the float, the drag and
            the throw — and only shows itself once the face is whole. */}
        <ThirdEye ref={thirdEye} skin={top} spriteScale={scale} />
      </PolygonSprite>

      <MetaBalls
        ref={metaBallsHeadBack}
        position={[12, -630, 2605]}
        mouseMinX={-11}
        mouseMaxX={11}
        scale={[280, 280, 1]}
        enableTransparency
        animationSize={40}
        renderOrder={BACK_ORDER}
        mask={headMask}
        {...GOO}
        {...GOO_BACK}
        ballSpreadY={4}
        ballCount={8}
        clumpFactor={0.6}
        seed={12}
        pauseYOffset={25}
        // Invisible: the bars still shape the field so the rear balls hang off
        // them, but only the front layer actually draws them. Two identical
        // bars in perfect registration read as one flat slab.
        anchors={[
          {
            x: -1.5,
            y: -7.25,
            radius: 16,
            roundness: 0.6,
            yScale: 0.1,
            visible: false,
          },
          {
            x: -1,
            y: -17,
            radius: 16,
            roundness: 0.6,
            yScale: 0.1,
            visible: false,
          },
        ]}
      />

      <MetaBalls
        ref={metaBallsHeadFront}
        position={[8, -630, 2605]}
        mouseMinX={-10}
        mouseMaxX={10}
        scale={[340, 280, 1]}
        enableTransparency
        animationSize={40}
        renderOrder={FRONT_ORDER}
        seed={10}
        mask={headMask}
        {...GOO}
        ballSpreadY={4}
        ballCount={9}
        pauseYOffset={25}
        // 0.4 * animationSize * clumpFactor must stay inside mouseMaxX, or the
        // outermost balls pile up against the wall and fuse into a solid edge.
        clumpFactor={0.7}
        anchors={[
          { x: -1.5, y: -7.05, radius: 15, roundness: 0.6, yScale: 0.1 },
          { x: -1, y: -17, radius: 15, roundness: 0.6, yScale: 0.1 },
        ]}
      />

      <PolygonSprite
        texture={middle}
        polygon={EYES_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        draggable
        ref={eyesRef}
        throwable
        bounds={PIECE_BOUNDS}
        onPointerDown={() => handleGrab("eyes")}
        onPointerUp={() => handleGrab(null)}
      >
        <HalfCircleWithDisk
          radius={122}
          position={[5, 82, -1]}
          scale={[1, 0.1, 1]}
          thickness={2}
          renderOrder={0}
        />
      </PolygonSprite>

      <MetaBalls
        ref={metaBallsMouthFront}
        position={[5, -830, 2605]}
        scale={[300, 280, 1]}
        mouseMinX={-12}
        mouseMaxX={12}
        enableTransparency
        seed={12}
        // Match the front head metaballs' colour phase (seed 10 → 10 * 10)
        holoTimeOffset={100}
        animationSize={40}
        renderOrder={FRONT_ORDER}
        pauseYOffset={25}
        mask={mouthMask}
        {...GOO}
        ballSpreadY={3}
        ballCount={9}
        clumpFactor={0.9}
        anchors={[
          { x: -1.5, y: 1.5, radius: 15, roundness: 0.6, yScale: 0.1 },
          { x: -0.95, y: -7, radius: 13, roundness: 0.6, yScale: 0.05 },
        ]}
      />

      <MetaBalls
        ref={metaBallsMouthBack}
        position={[10, -830, 2605]}
        scale={[300, 280, 1]}
        mouseMinX={-12}
        mouseMaxX={12}
        enableTransparency
        seed={12}
        // Match the back head metaballs' colour phase (seed 5 → 5 * 10)
        holoTimeOffset={50}
        animationSize={40}
        renderOrder={BACK_ORDER}
        pauseYOffset={25}
        mask={mouthMask}
        {...GOO}
        {...GOO_BACK}
        ballSpreadY={4}
        ballCount={8}
        clumpFactor={0.6}
        // Invisible for the same reason as the rear head layer above.
        anchors={[
          {
            x: -1.5,
            y: 1.5,
            radius: 15,
            roundness: 0.6,
            yScale: 0.1,
            visible: false,
          },
          {
            x: -0.95,
            y: -6,
            radius: 15,
            roundness: 0.6,
            yScale: 0.05,
            visible: false,
          },
        ]}
      />

      <PolygonSprite
        texture={bottom}
        polygon={MOUTH_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        draggable
        throwable
        ref={mouthRef}
        bounds={MOUTH_BOUNDS}
        onPointerDown={() => handleGrab("mouth")}
        onPointerUp={() => handleGrab(null)}
      >
        <HalfCircleWithDisk
          radius={122}
          position={[1, -58, -5]}
          scale={[1, 0.1, 1]}
          thickness={2}
          renderOrder={0}
        />
      </PolygonSprite>
    </group>
  );
}
