import { RefObject, useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useTexture, Line } from "@react-three/drei";
import MetaBalls, { FieldMask, MetaBallsHandle } from "./MetaBalls";
import PolygonSprite, { UV, SpriteHandle, SpriteBounds } from "./PolygonSprite";
import ThirdEye, { ThirdEyeHandle } from "./ThirdEye";

// ─── The piece chain ──────────────────────────────────────────────────────────
//
// head ── eyes ── mouth, in that order, joined by two bonds: bond `i` is the one
// between piece `i` and piece `i + 1`, so bond HEAD is the head↔eyes join and
// bond EYES the eyes↔mouth one. Head and mouth are not neighbours and never
// snap to each other.
//
// Everything below indexes into that chain rather than naming the pieces,
// because a locked run of it is one rigid body and the piece that *leads* the
// body is whichever one is actually being moved — the one in the user's hand, or
// the one that was thrown. So the chain gets walked in both directions: the
// pieces above the leader follow it exactly as the ones below do.

const HEAD = 0;
const EYES = 1;
const MOUTH = 2;
const PIECE_COUNT = 3;
const BOND_COUNT = PIECE_COUNT - 1;

type PieceName = "head" | "eyes" | "mouth";
const PIECE_INDEX: Record<PieceName, number> = {
  head: HEAD,
  eyes: EYES,
  mouth: MOUTH,
};

/**
 * XY step from one piece to the next along the chain: the assembled face has
 * `pos[i + 1] = pos[i] + CHAIN_STEP[i]`. Z is ignored — each sprite keeps its
 * own Z (render layering only).
 *
 * Each band is pulled *up* onto the one above it rather than left where the
 * texture has it, which closes the two seams. The goo hangs in them while the
 * face is intact, but it is gone for good the moment a piece moves (see the
 * visibility loop below), so a reassembled face with its seams still open would
 * only be a face with two gaps in it.
 */
const CHAIN_STEP = [
  new THREE.Vector2(0, 33.5), // eyes, up onto the head
  new THREE.Vector2(0, 33.5), // mouth, up onto the eyes
];

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

/**
 * World-unit XY distance below which two neighbours snap together.
 *
 * This is a capture radius the user aims at with the piece in hand, not a
 * tolerance checked once on release, so it wants to be wide enough that the
 * snap is something you can feel happening: the other piece flies in to meet
 * the one you are holding while you are still holding it.
 *
 * Hard ceiling of 33.5 — the length of `CHAIN_STEP`, which is how far from
 * assembled the *intact* face parked at HOME already is, since it sits with its
 * seams open and the three sprites exactly on top of each other. Anything at or
 * past that and both bonds are inside the capture radius before the page has
 * even been touched: the face would snap its own seams shut, settle, fly home
 * and open the eye with nobody having taken it apart.
 */
const SNAP_DISTANCE = 15;

/**
 * How far a bond has to be pulled open before it may snap again.
 *
 * Only in force for the grab that broke it. A piece being pulled out of a
 * finished face starts its drag at zero distance and is inside the capture
 * radius for as long as it takes to get clear, so without a release wider than
 * the capture the bond would re-lock on the frame after the grab broke it and
 * the face could never be taken apart at all.
 *
 * Letting go re-arms both bonds regardless of how far they were pulled — a
 * nudge and a release should settle back into the face rather than leave it
 * sitting a few units out of true.
 */
const SNAP_BREAK_DISTANCE = 2 * SNAP_DISTANCE;

/**
 * Lerp factor toward the snap target, expressed per 60Hz frame and rescaled by
 * the real delta below — otherwise the snap is twice as springy on a 120Hz
 * display as it is on a 60Hz one.
 * 1.0 = instant lock; 0.1 = springy follow.
 */
const SNAP_LERP = 0.18;

/** Residual bond error, in world units, below which the face counts as whole. */
const SETTLE_DISTANCE = 0.5;

/**
 * How much of its speed a piece in the finished face loses per 60Hz frame, so
 * the trio stops coasting instead of drifting on into the trip home.
 */
const ASSEMBLED_DAMP = 0.85;

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

// ─── The trip home ────────────────────────────────────────────────────────────
//
// The face snaps together wherever the user happened to assemble it, which is
// almost never where it belongs. So the finished trio flies back to `HOME` as
// one rigid body — the head leads, the other two ride along pinned at their snap
// offsets — and the third eye only opens once it has landed.

/** Beat between the last piece settling and the trip starting. */
const TRAVEL_DELAY = 0.2;

/**
 * How fast the face flies home, in world units/sec, averaged over the trip.
 *
 * A speed rather than a duration, because the distance is entirely up to the
 * user: assemble the face in the far corner and it has some six hundred units to
 * cover, assemble it a nudge off its home spot and it has five. A fixed duration
 * spends the same second on both, so the near case is a face sitting there
 * apparently doing nothing while the eye waits on a trip that has already
 * visually finished.
 *
 * This is the *mean* speed — the ease below peaks at three times it mid-flight —
 * so read it as "the trip takes distance / TRAVEL_SPEED seconds".
 */
const TRAVEL_SPEED = 300;

/**
 * How far off `HOME` the face has to have been assembled for the trip to be
 * worth making at all. Inside this it stays where it is and the eye opens on the
 * spot.
 *
 * A short trip is worse than no trip: it is over in a couple of frames, so it
 * reads as the face twitching rather than as it moving somewhere, and the beat
 * before it buys nothing. Twice `SNAP_DISTANCE`, so a face assembled within the
 * snap's own tolerance of home never twitches — and small next to the 500-unit
 * pieces, so nobody can tell the difference between here and `HOME` anyway.
 */
const TRAVEL_RANGE = 80;

/** Ease in and out, so the face leans into the trip and coasts to a stop. */
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Snap state ───────────────────────────────────────────────────────────────

type Bond = {
  /** The two pieces are held at their face offset, one following the other. */
  locked: boolean;
  /**
   * Whether the bond is allowed to lock at all. Cleared by the grab that breaks
   * it, and set again either by the pieces getting `SNAP_BREAK_DISTANCE` apart
   * or by that grab ending.
   */
  armed: boolean;
};

/**
 * `loose` — the pieces are in play, being dragged, thrown and snapped.
 * `homing` — the face is whole and flying back to `HOME`.
 * `done` — parked, inert, eye open.
 */
type Phase = "loose" | "homing" | "done";

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

/** The three pieces in chain order, filled at the top of the frame loop. */
const chain: SpriteHandle[] = [];
/** How far each bond is from assembled, measured before anything is moved. */
const bondGap = new Float64Array(BOND_COUNT);
/** Which bonds locked this frame, so the new follower can be brought to rest. */
const bondJustLocked = [false, false];
/**
 * Which rigid body each piece belongs to, as the index of the topmost piece in
 * it. Two pieces in the same body are meant to overlap and never collide.
 */
const bodyOf = new Int8Array(PIECE_COUNT);
/**
 * The piece that leads each body, indexed by body — so by the index of the
 * topmost piece in it. A body's motion lives entirely on its leader: the pieces
 * following it are carried, and their own velocity is damped away.
 */
const leaderOf = new Int8Array(PIECE_COUNT);
/** Where each piece stands relative to its leader in the assembled face. */
const leaderOffsetX = new Float64Array(PIECE_COUNT);
const leaderOffsetY = new Float64Array(PIECE_COUNT);
/** The walls a whole body may move within, in its leader's frame. */
const bodyBox = new THREE.Box3();
/** The same box moved out into one piece's frame, to hand to that piece. */
const pieceBox = new THREE.Box3();

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

// ── Chain helpers ─────────────────────────────────────────────────────────────

/** How far bond `b` is from being assembled, in world XY units. */
function measureBond(b: number): number {
  const upper = chain[b].getPosition(posA);
  const lower = chain[b + 1].getPosition(posB);
  const dx = lower.x - upper.x - CHAIN_STEP[b].x;
  const dy = lower.y - upper.y - CHAIN_STEP[b].y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Which piece the body spanning `lo … hi` follows.
 *
 * The one in the user's hand, if it is in this body — the piece being dragged
 * has to stay under the cursor, so everything else comes to *it*. Otherwise the
 * fastest, so a piece thrown into the face tows it along rather than being
 * yanked to a halt by it. Failing both — a body at rest — the topmost, which is
 * the head whenever the whole face is together, and the head is what the trip
 * home is flown by.
 */
function pickLeader(lo: number, hi: number, dragged: number): number {
  if (dragged >= lo && dragged <= hi) return dragged;

  let leader = lo;
  let fastest = 0;
  for (let i = lo; i <= hi; i++) {
    const speed = chain[i].getVelocity(velA).lengthSq();
    if (speed > fastest) {
      fastest = speed;
      leader = i;
    }
  }
  return leader;
}

/**
 * Work out the walls the body `lo … hi` may move within and hand them to every
 * piece in it.
 *
 * The three pieces have different polygons, so their walls sit in different
 * places: against the same screen floor the mouth's own floor is 245 units up
 * and the eyes' only 35, because that is how far each polygon reaches below its
 * origin. Left to themselves they are stopped by different things, so the wall a
 * bonded pair is drifting into stops whichever of them reaches it first and lets
 * the other carry on straight through it — the pair visibly folding into each
 * other against the wall.
 *
 * So every piece's walls are pulled back into the leader's frame — a piece
 * standing `d` along the chain sits at `leader + d`, so its walls say the leader
 * must be inside `box - d` — and the tightest of them wins. Each piece is then
 * held to that same box moved back out into its own frame.
 *
 * That last step is what makes them stop as one rather than merely stop early:
 * the boxes handed out are one box translated by the very offsets the pieces are
 * held at, so clamping a rigid body clamps every piece of it by the same amount
 * and it stays rigid.
 */
function applyBodyWalls(lo: number, hi: number, leader: number) {
  // Walk the offsets out from the leader in both directions. Bond `i` joins
  // piece `i` to `i + 1`, so the step between two pieces is the one named for
  // the upper of them.
  leaderOffsetX[leader] = 0;
  leaderOffsetY[leader] = 0;
  for (let i = leader + 1; i <= hi; i++) {
    leaderOffsetX[i] = leaderOffsetX[i - 1] + CHAIN_STEP[i - 1].x;
    leaderOffsetY[i] = leaderOffsetY[i - 1] + CHAIN_STEP[i - 1].y;
  }
  for (let i = leader - 1; i >= lo; i--) {
    leaderOffsetX[i] = leaderOffsetX[i + 1] - CHAIN_STEP[i].x;
    leaderOffsetY[i] = leaderOffsetY[i + 1] - CHAIN_STEP[i].y;
  }

  bodyBox.min.set(-Infinity, -Infinity, -Infinity);
  bodyBox.max.set(Infinity, Infinity, Infinity);

  let bounded = false;
  for (let i = lo; i <= hi; i++) {
    // Clear first: what is wanted here is the piece's own walls, not the body
    // walls this function left on it last frame. Feeding those back in would
    // ratchet the box tighter every time the screen walls moved.
    chain[i].setExtraBounds(null);

    const box = chain[i].getCentreBox();
    if (!box) continue;
    bounded = true;

    const dx = leaderOffsetX[i];
    const dy = leaderOffsetY[i];
    if (box.min.x - dx > bodyBox.min.x) bodyBox.min.x = box.min.x - dx;
    if (box.max.x - dx < bodyBox.max.x) bodyBox.max.x = box.max.x - dx;
    if (box.min.y - dy > bodyBox.min.y) bodyBox.min.y = box.min.y - dy;
    if (box.max.y - dy < bodyBox.max.y) bodyBox.max.y = box.max.y - dy;
    // Z carries no chain offset — the step between pieces is XY only.
    if (box.min.z > bodyBox.min.z) bodyBox.min.z = box.min.z;
    if (box.max.z < bodyBox.max.z) bodyBox.max.z = box.max.z;
  }

  if (!bounded) return; // nothing in the body has walls; leave them all clear

  // A body with no legal position at all — a face taller than the screen leaves
  // room for — is centred rather than left for the clamp to shove against
  // whichever wall it reads first.
  centreIfEmpty(bodyBox);

  for (let i = lo; i <= hi; i++) {
    pieceBox.copy(bodyBox);
    pieceBox.min.x += leaderOffsetX[i];
    pieceBox.max.x += leaderOffsetX[i];
    pieceBox.min.y += leaderOffsetY[i];
    pieceBox.max.y += leaderOffsetY[i];
    chain[i].setExtraBounds(pieceBox);
  }
}

/** Collapse any axis of `box` whose min has passed its max onto the midpoint. */
function centreIfEmpty(box: THREE.Box3) {
  if (box.min.x > box.max.x) {
    box.min.x = box.max.x = (box.min.x + box.max.x) * 0.5;
  }
  if (box.min.y > box.max.y) {
    box.min.y = box.max.y = (box.min.y + box.max.y) * 0.5;
  }
  if (box.min.z > box.max.z) {
    box.min.z = box.max.z = (box.min.z + box.max.z) * 0.5;
  }
}

/**
 * Move `follower` to where `leader` wants it: carried by however far the leader
 * moved this frame, then sprung the rest of the way in.
 *
 * The carry is what makes the pair read as rigid. A spring on its own is forever
 * chasing a target that moved again before it arrived, so it settles at a
 * standing error proportional to the leader's speed — at drag speed that is a
 * bonded piece trailing a good few frames behind the one it is supposedly stuck
 * to, which looks like the face coming apart again. Carrying the follower by the
 * leader's own step leaves the spring nothing to do but close the gap it started
 * with, so it converges once and stays converged at any speed, and the spring is
 * still there to make the initial snap read as the piece being pulled in rather
 * than teleporting.
 *
 * `lastX`/`lastY` hold every piece's position at the end of last frame. The
 * leader has already been moved by the time this runs — by its own drag or coast
 * loop if it leads the body, by this function if it is itself following someone
 * further up the chain — so the difference is exactly the step to pass on.
 */
function carry(
  follower: number,
  leader: number,
  lerp: number,
  lastX: Float64Array,
  lastY: Float64Array,
) {
  const piece = chain[follower];
  const bond = Math.min(follower, leader);

  // Whatever it was doing under its own steam is over: it is being towed now,
  // and a leftover throw would only fight the tow for the next few frames.
  if (bondJustLocked[bond]) piece.setVelocity(ZERO);

  const leaderPos = chain[leader].getPosition(posA);
  const pos = piece.getPosition(posB);

  // The step belongs to the bond, so it reads the same in both directions and
  // only the sign changes: the piece below its leader sits one step further
  // along the chain, the piece above it one step back.
  const step = CHAIN_STEP[bond];
  const sign = follower > leader ? 1 : -1;
  const targetX = leaderPos.x + sign * step.x;
  const targetY = leaderPos.y + sign * step.y;

  pos.x += leaderPos.x - lastX[leader];
  pos.y += leaderPos.y - lastY[leader];
  pos.x += (targetX - pos.x) * lerp;
  pos.y += (targetY - pos.y) * lerp;
  piece.setPosition(pos);

  // No clamp of its own. The body walls already hold the leader to a box the
  // follower's own walls helped pick, so anywhere the leader can be leaves the
  // follower inside its own — and clamping it here anyway is precisely how a
  // wall used to push one piece of a pair through the other.

  // Bleed off its own coast, which would only fight the carry above.
  dampVelocity(piece, 1 - lerp);
}

/**
 * Shift a piece and everything bonded to it by the same amount.
 *
 * A body is rigid, so a contact with any one of its pieces has to move all of
 * them. Moving only the piece that was touched leaves it out of position, and
 * the carry pass springs it straight back on the next frame — so a loose piece
 * held against a bonded one used to buzz for as long as the contact lasted,
 * pushed out and pulled back once per frame.
 */
function shiftBody(piece: number, dx: number, dy: number) {
  for (let i = 0; i < PIECE_COUNT; i++) {
    if (bodyOf[i] !== bodyOf[piece]) continue;
    const pos = chain[i].getPosition(posC);
    pos.x += dx;
    pos.y += dy;
    chain[i].setPosition(pos);
    clampToBounds(chain[i]);
  }
}

/**
 * Resolve one pair of pieces from different bodies: separate them along the
 * shallowest axis, then trade an impulse so the hit reads as a knock rather than
 * a silent shove.
 *
 * Both sides are handled as whole bodies, not as the two pieces that happen to
 * be touching — a contact moves everything bonded to the piece it landed on, and
 * the impulse is read off and written back to the body's leader, which is where
 * all of its motion lives.
 *
 * A held body is immovable and takes no impulse: the piece in the user's hand
 * belongs to the cursor, and the pieces following it have to survive being
 * bumped into.
 */
function resolvePair(ai: number, bi: number, aHeld: boolean, bHeld: boolean) {
  const a = chain[ai];
  const b = chain[bi];

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

  if (!aHeld && !bHeld) {
    shiftBody(ai, -axisX * depth * 0.5, -axisY * depth * 0.5);
    shiftBody(bi, axisX * depth * 0.5, axisY * depth * 0.5);
  } else if (aHeld) {
    shiftBody(bi, axisX * depth, axisY * depth);
  } else {
    shiftBody(ai, -axisX * depth, -axisY * depth);
  }

  const aLead = chain[leaderOf[bodyOf[ai]]];
  const bLead = chain[leaderOf[bodyOf[bi]]];

  const va = aLead.getVelocity(velA);
  const vb = bLead.getVelocity(velB);
  const impactSpeed = (va.x - vb.x) * axisX + (va.y - vb.y) * axisY;
  if (impactSpeed <= 0) return; // already separating

  // Equal masses share the impulse; a held piece is effectively infinitely
  // heavy, so the free one takes all of it and gets genuinely knocked away
  // rather than just displaced.
  const held = aHeld || bHeld;
  const impulse = impactSpeed * (1 + COLLISION_RESTITUTION) * (held ? 1 : 0.5);

  if (!aHeld) {
    va.x -= impulse * axisX;
    va.y -= impulse * axisY;
    aLead.setVelocity(va);
  }
  if (!bHeld) {
    vb.x += impulse * axisX;
    vb.y += impulse * axisY;
    bLead.setVelocity(vb);
  }
}

type Props = {
  ref: RefObject<THREE.Group | null>;
  onGrabbing: (payload: PieceName | null) => void;
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

  const phase = useRef<Phase>("loose");
  /** Where the head left from, how long that trip takes, and how far in it is. */
  const travel = useRef({
    elapsed: 0,
    duration: 0,
    from: new THREE.Vector3(),
  });

  const thirdEye = useRef<ThirdEyeHandle>(null);

  // ── Snap state ──────────────────────────────────────────────────────────────
  const bonds = useRef<Bond[]>([
    { locked: false, armed: true },
    { locked: false, armed: true },
  ]);

  /**
   * Where each piece was at the end of last frame, so a follower can be carried
   * by exactly the step its leader just took. See `carry`.
   */
  const lastPos = useRef({
    x: new Float64Array(PIECE_COUNT),
    y: new Float64Array(PIECE_COUNT),
    valid: false,
  });

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
    (payload: PieceName | null) => {
      onGrabbing(payload);

      // ── Break on grab, re-arm on release ───────────────────────────────────
      //
      // Grabbing a piece breaks every bond it is *holding* by and disarms them,
      // which is what lets it be pulled clear of a face it currently sits flush
      // inside: the pieces are still touching, so an armed bond would lock again
      // on the very next frame and the face could never come apart. The bond
      // re-arms itself once they are properly apart — or here, the moment the
      // user lets go, because a nudge and a release should drop back into the
      // face rather than leave it a few units out of true.
      //
      // A bond that wasn't holding anything is left armed, so it is free to
      // snap mid-drag: nothing is being pulled out of it, and the drag that
      // assembles the face for the first time is exactly this case.
      //
      // Both flags live in a ref and are written synchronously from
      // `pointerdown`, so the frame loop never sees a stale bond.
      const grabbed = payload === null ? -1 : PIECE_INDEX[payload];
      for (let b = 0; b < BOND_COUNT; b++) {
        const bond = bonds.current[b];
        if (grabbed < 0) {
          bond.armed = true;
        } else if (bond.locked && (grabbed === b || grabbed === b + 1)) {
          bond.locked = false;
          bond.armed = false;
        }
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

    if (phase.current === "done") return;

    chain[HEAD] = head;
    chain[EYES] = eyes;
    chain[MOUTH] = mouth;

    // Every per-frame factor below is tuned at 60Hz and rescaled to the real
    // frame time, so the snap feels the same on a 144Hz monitor as on a 60Hz
    // one. Delta is capped so a hitch can't overshoot past the target.
    const dt = Math.min(delta, 1 / 20);
    const frames = dt * 60;
    const snapLerp = 1 - Math.pow(1 - SNAP_LERP, frames);

    // ── 0. The trip home ─────────────────────────────────────────────────────
    //
    // Nothing else runs while this does: the face is whole, out of the user's
    // hands, and the only two things left in the scene are already touching each
    // other exactly as intended — so both the snap lerp and the collision pass
    // would only fight the flight.
    if (phase.current === "homing") {
      const trip = travel.current;
      trip.elapsed += dt;

      const progress = Math.min(
        Math.max(trip.elapsed - TRAVEL_DELAY, 0) / trip.duration,
        1,
      );

      const headPos = head.getPosition(posA);
      headPos.lerpVectors(trip.from, HOME, easeInOut(progress));
      head.setPosition(headPos);

      // Pinned outright rather than carried and sprung like step 3 does it: the
      // three are one rigid face by now and there is no gap left to close, so
      // there is nothing for a spring to add but a little lag. No clamp either —
      // HOME is where the face belongs, walls or no walls.
      const eyesPos = eyes.getPosition(posB);
      eyesPos.x = headPos.x + CHAIN_STEP[HEAD].x;
      eyesPos.y = headPos.y + CHAIN_STEP[HEAD].y;
      eyes.setPosition(eyesPos);

      const mouthPos = mouth.getPosition(posC);
      mouthPos.x = eyesPos.x + CHAIN_STEP[EYES].x;
      mouthPos.y = eyesPos.y + CHAIN_STEP[EYES].y;
      mouth.setPosition(mouthPos);

      if (progress >= 1) {
        phase.current = "done";
        thirdEye.current?.open();
      }
      return;
    }

    // ── 1. Who is in hand, and where everything was last frame ───────────────
    //
    // Only ever one piece: the sprites hand the pointer to whoever presses
    // first and the rest are locked out until it comes up.
    let dragged = -1;
    for (let i = 0; i < PIECE_COUNT; i++) {
      if (chain[i].isDragging()) dragged = i;
    }

    const last = lastPos.current;
    if (!last.valid) {
      // First frame through: nothing has moved yet, so seed the cache with where
      // the pieces are and let this frame's carry steps come out as zero.
      for (let i = 0; i < PIECE_COUNT; i++) {
        const pos = chain[i].getPosition(posA);
        last.x[i] = pos.x;
        last.y[i] = pos.y;
      }
      last.valid = true;
    }

    // ── 2. Arm and lock the bonds ────────────────────────────────────────────
    //
    // Both halves of the hysteresis: a bond a grab broke stays disarmed until
    // the pieces are properly apart, and only an armed bond inside the capture
    // radius locks. Nothing here asks whether a piece is being dragged — a bond
    // forming under the user's hand is the point, and the pass below sorts out
    // which of the two then follows the other.
    for (let b = 0; b < BOND_COUNT; b++) {
      const bond = bonds.current[b];
      bondJustLocked[b] = false;
      bondGap[b] = measureBond(b);

      if (bond.locked) continue;
      if (!bond.armed) {
        if (bondGap[b] > SNAP_BREAK_DISTANCE) bond.armed = true;
        continue;
      }
      if (bondGap[b] >= SNAP_DISTANCE) continue;

      bond.locked = true;
      bondJustLocked[b] = true;
    }

    // ── 3. Carry each body, from its leader outward ──────────────────────────
    //
    // Every run of locked bonds is one rigid body. Which piece leads it is not
    // fixed — that was the old behaviour, and it is why a bond could only ever
    // survive while the *upper* piece moved: with the head always leading, a
    // dragged eyes had the snap lerp hauling it off the cursor, so the only way
    // out was to break every bond the user touched and re-snap on release.
    // Leading with whichever piece is actually being moved makes the same code
    // work in both directions, and the bond can stay locked through the drag.
    //
    // Only X and Y are driven — Z stays as it is (render layering).
    //
    // A body is one run of locked bonds, so `lo … hi` are the pieces in it: the
    // bonds are numbered by their upper piece, which makes the run of bonds
    // starting at `lo` and the run of pieces it joins the same walk.
    for (let lo = 0; lo < PIECE_COUNT; ) {
      let hi = lo;
      while (hi < BOND_COUNT && bonds.current[hi].locked) hi++;

      const leader = pickLeader(lo, hi, dragged);
      for (let i = lo; i <= hi; i++) bodyOf[i] = lo;
      leaderOf[lo] = leader;

      // Hand every piece the walls of the whole body, so the sprites' own drag
      // and coast loops stop all of them together on the frames that follow.
      // Cleared and rebuilt every frame: the screen walls move, and so does the
      // leader whose frame they are expressed in.
      if (hi > lo) applyBodyWalls(lo, hi, leader);
      else chain[lo].setExtraBounds(null);

      // Outward in both directions, so each piece is only ever carried by a
      // neighbour that has already been moved this frame.
      for (let i = leader - 1; i >= lo; i--) {
        carry(i, i + 1, snapLerp, last.x, last.y);
      }
      for (let i = leader + 1; i <= hi; i++) {
        carry(i, i - 1, snapLerp, last.x, last.y);
      }

      lo = hi + 1;
    }

    // ── 4. SAT collision, between bodies only ────────────────────────────────
    //
    // Pieces in the same body are meant to be overlapping at their face offset,
    // so they never test against each other — that covers a locked pair, and
    // also head↔mouth once the face is whole, which used to be tested every
    // frame on the grounds that those two never snap *to each other*.
    //
    // Held now means the whole body the user is holding, not just the piece in
    // the hand: a piece merely following the one in the hand is no more movable
    // than the one in the hand is.
    const heldBody = dragged < 0 ? -1 : bodyOf[dragged];

    for (let i = 0; i < PIECE_COUNT; i++) {
      for (let j = i + 1; j < PIECE_COUNT; j++) {
        if (bodyOf[i] === bodyOf[j]) continue;
        resolvePair(i, j, bodyOf[i] === heldBody, bodyOf[j] === heldBody);
      }
    }

    // ── 5. Whole face, hands off and settled → send it home ──────────────────
    //
    // The hands-off half is new with the mid-drag snap: the face can now come
    // together while the user is still holding a piece of it, and flying it out
    // of their hand the instant the last bond clicked would be taking it off
    // them. It leaves when they let go.
    if (
      bonds.current[HEAD].locked &&
      bonds.current[EYES].locked &&
      dragged < 0
    ) {
      const damp = Math.pow(1 - ASSEMBLED_DAMP, frames);
      for (let i = 0; i < PIECE_COUNT; i++) dampVelocity(chain[i], damp);

      // Measured before this frame's carry, so it is one frame stale — which
      // only ever means the trip leaves a frame later than it could have.
      const settled =
        bondGap[HEAD] < SETTLE_DISTANCE && bondGap[EYES] < SETTLE_DISTANCE;

      if (settled) {
        // Hands off from here either way: the face is whole, and neither the
        // flight home nor the reveal should be something you can grab a piece
        // out of.
        head.setInteractable(false);
        eyes.setEnabled(false);
        mouth.setEnabled(false);

        // Whatever coast was left would keep adding to the position the trip is
        // writing, and the head would arrive somewhere just past HOME.
        head.setVelocity(ZERO);
        eyes.setVelocity(ZERO);
        mouth.setVelocity(ZERO);

        // Nothing rebuilds these once the loose phase is over, and the flight
        // home answers to no walls anyway.
        for (let i = 0; i < PIECE_COUNT; i++) chain[i].setExtraBounds(null);

        const trip = travel.current;
        head.getPosition(trip.from);
        const distance = trip.from.distanceTo(HOME);

        if (distance < TRAVEL_RANGE) {
          // Already home, as far as anyone can see. Open on the spot.
          phase.current = "done";
          thirdEye.current?.open();
        } else {
          phase.current = "homing";
          trip.elapsed = 0;
          trip.duration = distance / TRAVEL_SPEED;
        }
      }
    }

    // ── 6. Bank the positions the next frame's carry measures against ────────
    //
    // After the collision pass, so a piece knocked sideways passes that on to
    // the pieces following it rather than springing back out of the body.
    for (let i = 0; i < PIECE_COUNT; i++) {
      const pos = chain[i].getPosition(posA);
      last.x[i] = pos.x;
      last.y[i] = pos.y;
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
