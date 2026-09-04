import * as THREE from "three";

/**
 * The shape, and the arithmetic that makes it one thing rather than two.
 *
 * A strip of width W bent around its centre line by an angle theta becomes an
 * arc of radius W / theta. At theta = 2*PI it closes into a tube — so setting
 * W = 2*PI*tube closes it at exactly the radius asked for, seam at the floor,
 * crown at the ceiling. That is the whole trick: the flat wall the section
 * opens on and the tunnel it flies down are the same surface at two values of
 * one number, and every frame in between is a real intermediate rather than a
 * cross-fade between two meshes.
 *
 * The spine of that strip is the tunnel axis AND the camera path. It is a list
 * of segments, each a straight run or a constant-radius turn, so arc length is
 * exact and scroll stays linear in distance — no polyline to resample, no
 * `getPointAt` that is only approximately arc-length parameterised.
 *
 * Nothing in here touches React, the DOM or a material. It is handed a list of
 * {@link TunnelSegment}s and answers questions about the resulting shape;
 * ../scene/Tunnel turns those answers into geometry and ../scene/TunnelFlight
 * into a camera.
 */

const DEG = Math.PI / 180;

/** the local frame's axes: +X right, +Y up, -Z forward (three's camera convention) */
const LX = new THREE.Vector3(1, 0, 0);
const LY = new THREE.Vector3(0, 1, 0);
const LZ = new THREE.Vector3(0, 0, -1);

export function smoothstep(t: number) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* ==========================================================================
   The authored shape — this is the API
   ========================================================================== */

/**
 * A card slot, and the patch of wall it comes out of.
 *
 * `at` is a fraction along the segment it is written on, `u` where around the
 * tube it sits — 0 the crown, +/-0.5 the seam at the floor — and `w`/`h` the
 * size of the highlighted patch in grid cells. The patch snaps to the real grid
 * lines, and the card sits on a plane pushed off it towards the axis, so it
 * reads as coming out of the cells rather than floating near them.
 *
 * Content is deliberately not written here: the slice fills each slot from
 * Prismic in order. What lives on the path is where a card *is*, which is a
 * fact about the tunnel; what is in it is a fact about the CMS, and the two
 * change for different reasons.
 */
export type TunnelCard = {
  /** fraction along this segment, 0 to 1 */
  at?: number;
  /** where around the tube: 0 crown, +/-0.5 floor */
  u?: number;
  /** width of the highlighted patch, in cells */
  w?: number;
  /** height of the highlighted patch, in cells */
  h?: number;
};

/**
 * One leg of the spine. Everything is optional and anything left out holds
 * whatever the previous segment ended on, so a list reads as a series of
 * changes rather than a series of full states.
 *
 * Distances (`run`, `bend`, `tube`) are in *path units* — see `TUNNEL.scale` in
 * ./presets, which is the one place they become world units. Angles are
 * degrees.
 *
 *     { run: 40 }                straight, 40 long
 *     { pitch: 90, bend: 22 }    nose up over a 22 radius. Leave `bend` out and
 *                                it defaults; leave `pitch`/`yaw` out and the
 *                                spine stays straight — only the aim turns
 *     { yaw: -35, bend: 40 }     turn left over a 40 radius
 *     { roll: 25 }               bank; a delta, spread along the segment
 *     { tube: 14 }               ease the radius to 14 by the end
 *     { wrap: 1 }                ease flat -> closed by the end
 *     { aim: 1 }                 ease facing-the-wall -> down-the-tunnel
 *     { pace: 2.5 }              take 2.5x the scroll for this distance
 *     { pool: 0.3 }              the fluid surface, at a fraction along this
 *                                segment; past it you are under it
 *     { card: {...} }            a card slot, see {@link TunnelCard}
 */
export type TunnelSegment = {
  /** shows up in warnings; otherwise decoration */
  label?: string;
  /** straight run, in path units. Ignored when `pitch` or `yaw` is set */
  run?: number;
  /** nose up (+) or down (-), in degrees */
  pitch?: number;
  /** turn right (+) or left (-), in degrees */
  yaw?: number;
  /** radius of the turn `pitch`/`yaw` describes, in path units */
  bend?: number;
  /** bank, in degrees — a delta on the previous roll, spread along the segment */
  roll?: number;
  /** tube radius to ease to by the end, in path units */
  tube?: number;
  /** 0 flat wall, 1 closed tube */
  wrap?: number;
  /** 0 facing the wall, 1 looking down the tunnel */
  aim?: number;
  /** scroll multiplier for this segment's distance */
  pace?: number;
  /** fraction along this segment where the fluid surface sits */
  pool?: number;
  /** a card slot on this segment's wall */
  card?: TunnelCard;
};

/* ==========================================================================
   The compiled shape
   ========================================================================== */

export type CompiledSegment = {
  p0: THREE.Vector3;
  q0: THREE.Quaternion;
  /** distance along the whole spine at which this segment starts */
  s0: number;
  /** scroll weight at which it starts — see {@link weightOf} */
  w0: number;
  len: number;
  pace: number;
  roll: number;
  label: string;
  tube0: number;
  tube1: number;
  wrap0: number;
  wrap1: number;
  aim0: number;
  aim1: number;
  turn: boolean;
  /** turns only: the world axis the tangent swings about, and by how much */
  axis?: THREE.Vector3;
  angle?: number;
  bend?: number;
  center?: THREE.Vector3;
  /** straight runs only */
  T0?: THREE.Vector3;
};

export type CompiledCard = {
  /** distance along the spine */
  s: number;
  u: number;
  w: number;
  h: number;
};

export type CompiledPath = {
  segs: CompiledSegment[];
  /** the spine's whole length, in world units */
  total: number;
  /** its length in scroll weight — the sum of len * pace */
  weight: number;
  cards: CompiledCard[];
  /** distance along the spine of the fluid surface, or null for no pool */
  pool: number | null;
  /** world units per path unit, so consumers can quote distances either way */
  scale: number;
  /** where the camera path starts: the far end of the lead-in */
  travelA: number;
  /** and where it ends, short of the spine's own end */
  travelB: number;
  /** the same two, in scroll weight */
  weightA: number;
  weightB: number;
  warn: string[];
};

export type CompileOptions = {
  /** world units per path unit */
  scale: number;
  /** world position of the spine's start — the camera reaches it after the lead-in */
  origin: THREE.Vector3;
  /** how much surface to hang above the start of the camera path, in path units */
  overhang: number;
  /** how much spine to leave ahead of the camera at full scroll, in path units */
  tail: number;
};

/* ==========================================================================
   Compiling
   ========================================================================== */

export function compile(
  defs: readonly TunnelSegment[],
  opts: CompileOptions,
): CompiledPath {
  const { scale, origin, overhang, tail } = opts;

  const segs: CompiledSegment[] = [];
  const warn: string[] = [];
  const cards: CompiledCard[] = [];
  let poolS: number | null = null;

  // The start frame: falling straight down, wall dead ahead, crown at -Z.
  //
  // Which is also what lets the section take the camera over without a cut. A
  // quaternion of -90 degrees about X maps the local forward (0, 0, -1) onto
  // (0, -1, 0) — the spine falls — while the *camera* at aim 0 is that frame
  // pitched back, so it looks along world -Z. That is exactly where ABOUT_POSE
  // leaves it; ../scene/TunnelFlight places `origin` so the two coincide on the
  // frame the section starts.
  const q = new THREE.Quaternion().setFromAxisAngle(LX, -Math.PI / 2);
  const p = origin.clone();

  const st = {
    tube: (defs[0]?.tube ?? 8) * scale,
    wrap: 0,
    aim: 0,
  };

  let s0 = 0;
  let w0 = 0;

  const list: TunnelSegment[] = [{ label: "lead-in", run: overhang }, ...defs];
  const scratch = makeFrame();

  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const T = new THREE.Vector3();

  for (let i = 0; i < list.length; i++) {
    const d = list[i];

    side.copy(LX).applyQuaternion(q);
    up.copy(LY).applyQuaternion(q);
    T.copy(LZ).applyQuaternion(q);

    const seg: CompiledSegment = {
      p0: p.clone(),
      q0: q.clone(),
      s0,
      w0,
      len: 0,
      pace: Math.max(0.05, d.pace === undefined ? 1 : d.pace),
      roll: (d.roll ?? 0) * DEG,
      label: d.label ?? `segment ${i}`,
      tube0: st.tube,
      tube1: d.tube !== undefined ? Math.max(0.5, d.tube * scale) : st.tube,
      wrap0: st.wrap,
      wrap1: d.wrap !== undefined ? d.wrap : st.wrap,
      aim0: st.aim,
      aim1: d.aim !== undefined ? d.aim : st.aim,
      turn: false,
    };

    let ang = 0;
    let axis: THREE.Vector3 | null = null;

    if (d.pitch) {
      ang = d.pitch * DEG;
      axis = side.clone();
    } else if (d.yaw) {
      ang = d.yaw * DEG;
      axis = up.clone().negate();
    }

    if (axis && ang) {
      const bend = Math.max(0.01, (d.bend === undefined ? 20 : d.bend) * scale);

      seg.turn = true;
      seg.axis = axis;
      seg.angle = ang;
      seg.bend = bend;

      // the tangent swings toward axis x T, so that is where the centre lies
      const dir = axis
        .clone()
        .cross(T)
        .normalize()
        .multiplyScalar(Math.sign(ang));

      seg.center = p.clone().addScaledVector(dir, bend);
      seg.len = bend * Math.abs(ang);

      // The inner wall sits at bend - tube from the centre of the turn, so a
      // bend inside the radius folds the surface through its own axis. Reported
      // in path units, which is what the preset is written in.
      const tmax = Math.max(seg.tube0, seg.tube1) / scale;
      const bendUnits = bend / scale;

      if (bendUnits <= tmax) {
        warn.push(
          `${seg.label}: bend ${bendUnits.toFixed(1)} is inside the tube radius ${tmax.toFixed(1)}, inner wall folds through the axis`,
        );
      } else if (bendUnits < tmax * 2) {
        warn.push(
          `${seg.label}: bend ${bendUnits.toFixed(1)} is very tight for a tube of ${tmax.toFixed(1)}`,
        );
      }
    } else {
      seg.T0 = T.clone();
      seg.len = Math.max(0.01, (d.run === undefined ? 20 : d.run) * scale);
    }

    if (d.pool !== undefined) {
      poolS = s0 + seg.len * Math.max(0, Math.min(1, d.pool));
    }

    if (d.card) {
      const cd = d.card;
      cards.push({
        s: s0 + seg.len * (cd.at === undefined ? 0.5 : cd.at),
        u: cd.u === undefined ? 0.22 : cd.u,
        w: Math.max(1, Math.round(cd.w === undefined ? 3 : cd.w)),
        h: Math.max(1, Math.round(cd.h === undefined ? 2 : cd.h)),
      });
    }

    segs.push(seg);

    evalSeg(seg, 1, scratch);
    p.copy(scratch.pos);
    q.copy(scratch.quat);

    st.tube = seg.tube1;
    st.wrap = seg.wrap1;
    st.aim = seg.aim1;

    s0 += seg.len;
    w0 += seg.len * seg.pace;
  }

  const path: CompiledPath = {
    segs,
    total: s0,
    weight: w0,
    cards,
    pool: poolS,
    scale,
    travelA: overhang * scale,
    travelB: 0,
    weightA: 0,
    weightB: 0,
    warn,
  };

  // With a pool the fullscreen wash covers the end of the world, so the usual
  // tail of spare geometry ahead of the camera is not needed.
  path.travelB = Math.max(
    path.travelA + 10 * scale,
    path.total - (poolS != null ? 14 : tail) * scale,
  );
  path.weightA = weightOf(path, path.travelA);
  path.weightB = weightOf(path, path.travelB);

  return path;
}

/* ==========================================================================
   Evaluating a point on the spine
   ========================================================================== */

export type Frame = {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  side: THREE.Vector3;
  up: THREE.Vector3;
  T: THREE.Vector3;
  tube: number;
  wrap: number;
  aim: number;
  label: string;
};

export function makeFrame(): Frame {
  return {
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    side: new THREE.Vector3(),
    up: new THREE.Vector3(),
    T: new THREE.Vector3(),
    tube: 8,
    wrap: 0,
    aim: 0,
    label: "",
  };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export function evalSeg(seg: CompiledSegment, t: number, o: Frame): Frame {
  if (seg.turn) {
    _qa.setFromAxisAngle(seg.axis!, seg.angle! * t);
    o.pos.subVectors(seg.p0, seg.center!).applyQuaternion(_qa).add(seg.center!);
    // a turn is described in world space, so it pre-multiplies
    o.quat.copy(_qa).multiply(seg.q0);
  } else {
    o.pos.copy(seg.p0).addScaledVector(seg.T0!, seg.len * t);
    o.quat.copy(seg.q0);
  }

  if (seg.roll) {
    // roll is about the local forward axis, so it post-multiplies
    _qb.setFromAxisAngle(LZ, seg.roll * t);
    o.quat.multiply(_qb);
  }

  o.side.copy(LX).applyQuaternion(o.quat);
  o.up.copy(LY).applyQuaternion(o.quat);
  o.T.copy(LZ).applyQuaternion(o.quat);

  const e = smoothstep(t);
  o.tube = lerp(seg.tube0, seg.tube1, e);
  o.wrap = lerp(seg.wrap0, seg.wrap1, e);
  o.aim = lerp(seg.aim0, seg.aim1, e);
  o.label = seg.label;

  return o;
}

function segIndexAt(path: CompiledPath, key: "s0" | "w0", s: number) {
  const segs = path.segs;
  let lo = 0;
  let hi = segs.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid][key] <= s) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

export function frameAt(path: CompiledPath, s: number, o: Frame): Frame {
  const d = Math.min(Math.max(s, 0), path.total - 1e-6);
  const seg = path.segs[segIndexAt(path, "s0", d)];
  return evalSeg(seg, Math.min(1, (d - seg.s0) / seg.len), o);
}

/**
 * Scroll is measured in "weight", not in distance: a segment with a high `pace`
 * eats more of the section's scroll for the same amount of tunnel. These two
 * are the conversion, and they are exact rather than sampled because every
 * segment's length is known in closed form.
 */
export function weightOf(path: CompiledPath, s: number) {
  const d = Math.min(Math.max(s, 0), path.total);
  const seg = path.segs[segIndexAt(path, "s0", Math.min(d, path.total - 1e-6))];
  return seg.w0 + (d - seg.s0) * seg.pace;
}

export function distanceOf(path: CompiledPath, w: number) {
  const x = Math.min(Math.max(w, 0), path.weight);
  const seg =
    path.segs[segIndexAt(path, "w0", Math.min(x, path.weight - 1e-6))];
  return seg.s0 + (x - seg.w0) / seg.pace;
}

/** where along the spine a scroll progress of 0..1 puts the camera */
export function distanceAtProgress(path: CompiledPath, progress: number) {
  return distanceOf(path, lerp(path.weightA, path.weightB, progress));
}

/* ==========================================================================
   The surface
   ========================================================================== */

/**
 * One point on the wall. `u` in [-0.5, 0.5] runs across the strip: u = 0 is the
 * crown and u = +/-0.5 the seam that closes at the floor.
 */
export function surfacePoint(u: number, fr: Frame, out: THREE.Vector3) {
  const th = fr.wrap * Math.PI * 2;
  const tube = fr.tube;
  let cx: number;
  let cy: number;

  if (th < 1e-4) {
    // flat: the limit of the case below, written out because the radius there
    // is 2*PI*tube / 0
    cx = u * 2 * Math.PI * tube;
    cy = tube;
  } else {
    const r = (2 * Math.PI * tube) / th;
    const phi = u * th;
    cx = r * Math.sin(phi);
    cy = tube - r * (1 - Math.cos(phi));
  }

  return out
    .copy(fr.pos)
    .addScaledVector(fr.side, cx)
    .addScaledVector(fr.up, cy);
}

/** outward normal at `u`: away from the axis, whatever the wrap */
export function surfaceNormal(u: number, fr: Frame, out: THREE.Vector3) {
  const phi = u * fr.wrap * Math.PI * 2;

  return out
    .set(0, 0, 0)
    .addScaledVector(fr.side, Math.sin(phi))
    .addScaledVector(fr.up, Math.cos(phi))
    .normalize();
}

/* ==========================================================================
   Card visibility
   ========================================================================== */

/**
 * How far out of the wall a card is, from how far ahead of the camera it still
 * is — in world units, and negative once it is behind.
 *
 * The window depends on `aim` because the two ends of the flight look at a card
 * completely differently. On the flat wall the camera is pointed straight at it
 * and passes through the frame, so it has to be gone by the time it is level;
 * down the tunnel it approaches from far off and slides past the shoulder.
 */
export function emergence(d: number, aim: number, scale: number) {
  const inD = lerp(20, 58, aim) * scale;
  const p0 = lerp(11, 34, aim) * scale;
  const p1 = lerp(-3, 12, aim) * scale;
  const outD = lerp(-13, 3, aim) * scale;

  return Math.min(
    smoothstep((inD - d) / (inD - p0)),
    smoothstep((d - outD) / (p1 - outD)),
  );
}

const _los = new THREE.Vector3();

/**
 * Is the card actually in sight, or is it round a corner?
 *
 * Walk the straight line from camera to card and check it stays inside the
 * tube. Only the DOM card needs this — the 3D parts depth-test against the
 * shell, and DOM cannot. Whether it matters at all is sagitta against radius: a
 * turn only hides anything once `bend * (1 - cos(half the angle crossed))`
 * exceeds `tube`.
 */
export function sightline(
  path: CompiledPath,
  camPos: THREE.Vector3,
  camS: number,
  anchorPos: THREE.Vector3,
  cardS: number,
  scratch: Frame,
) {
  let worst = 0;

  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    _los.lerpVectors(camPos, anchorPos, t);
    frameAt(path, camS + (cardS - camS) * t, scratch);

    const d = _los.distanceTo(scratch.pos) / scratch.tube;
    if (d > worst) worst = d;
  }

  return 1 - smoothstep((worst - 0.88) / 0.3);
}

/* ==========================================================================
   Diagnostics
   ========================================================================== */

/**
 * Curvy tracks can bring the tunnel back alongside itself, and the shell being
 * opaque means you only find out by flying through the seam. O(n^2) over a
 * fixed number of samples, and only ever called behind a development guard — it
 * is a note to whoever is editing the preset, not something the page pays for.
 */
export function proximityWarnings(path: CompiledPath) {
  const out: string[] = [];
  const SAMPLES = 400;
  const step = path.total / SAMPLES;
  const f = makeFrame();
  const pts: THREE.Vector3[] = [];
  const tb: number[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    frameAt(path, i * step, f);
    pts.push(f.pos.clone());
    tb.push(f.tube);
  }

  // far enough apart along the spine that a turn's own two walls don't count
  const skip = Math.max(1, Math.ceil((45 * path.scale) / step));
  let worst = Infinity;
  let at = 0;

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + skip; j < pts.length; j++) {
      const d = pts[i].distanceTo(pts[j]) - (tb[i] + tb[j]);
      if (d < worst) {
        worst = d;
        at = i * step;
      }
    }
  }

  const where = (at / path.scale).toFixed(0);
  if (worst < 0) {
    out.push(`the tunnel passes through itself near ${where} along the path`);
  } else if (worst < 6 * path.scale) {
    out.push(`the tunnel nearly touches itself near ${where} along the path`);
  }

  return out;
}
