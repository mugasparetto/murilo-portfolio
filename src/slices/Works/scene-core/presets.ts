import * as THREE from "three";

import { ABOUT_EXIT_LIFT, ABOUT_POSE, FOV } from "@/app/components/poses";
import { TERRAIN_GRID } from "@/slices/Hero/scene-core/gridShader";
import { defaultParams } from "@/slices/Hero/scene-core/params";
import {
  compile,
  distanceAtProgress,
  distanceOf,
  proximityWarnings,
  type CompiledPath,
  type TunnelSegment,
} from "./path";

/**
 * The tunnel's dials, and the one preset the section flies.
 *
 * Everything here is authored in *path units* — the units the prototype was
 * written in, where a tube is about 10 and a straight run about 80 — and
 * {@link TUNNEL.scale} is the single place they become the world units the rest
 * of the site is built in. Keeping the two apart is what lets a preset be
 * copied in or out unchanged: the numbers stay readable, and the camera's 50
 * unit near plane stays a long way inside the tube.
 */

/* ==========================================================================
   Where the wall stands — which is not this section's decision
   ========================================================================== */

/**
 * The depth of the flat wall the flight opens on.
 *
 * It is the plane the About section's grid is drawn on, and that is the whole
 * reason it is written down: the two are one surface. Same plane, same lattice
 * — see {@link wallColumns} and {@link wallRows}, which ../../About/scene/Scene
 * rules its grid by rather than by a table of its own — so the grid the About
 * column has been read against *is* the wall the page then falls down, rather
 * than a second one that replaces it at the handover.
 */
export const WALL_Z = 2200;

/**
 * How far in front of {@link ABOUT_POSE} that leaves it — which is also the
 * tube's radius in world units. At wrap 0 the surface sits exactly `tube` from
 * the spine, and on the lead-in the spine is where the camera is.
 */
export const WALL_DEPTH = ABOUT_POSE.position[2] - WALL_Z;

/**
 * The pitch of the hero's ground grid, in world units.
 *
 * <Terrain /> rules {@link TERRAIN_GRID} cells across a tile `w` wide, and it
 * clips the ground at {@link WALL_Z} — this wall's own plane, which is not a
 * coincidence. So the verticals the ground carries down into that clip are the
 * verticals the wall has to carry on below it, and this is the spacing they
 * arrive at.
 *
 * The *authored* `w`, not the live one. The GUI can drag it in development and
 * this will not follow, which is the right answer rather than a gap: the tunnel
 * is compiled once as a module singleton, so nothing downstream of here could
 * follow it either. Settle on a width in the GUI, put it in `defaultParams`,
 * and the wall picks it up on reload.
 */
const TERRAIN_CELL = defaultParams.w / TERRAIN_GRID;

/**
 * And how many cells of that fit around the strip: the count the wall is ruled
 * into.
 *
 * Derived rather than typed, and the derivation is the whole point — around
 * here the count *is* the pitch. The strip is `2 * PI * WALL_DEPTH` across
 * whatever the wrap is doing, so picking a number of columns is picking how
 * wide a cell is, and the only width that lets the hero's ground run into this
 * wall without a kink is the ground's own. See {@link wallColumnCount}, which
 * is where that stopped being true once.
 *
 * Rounded to an *odd* count, which the crown wants anyway: an even one puts a
 * column straight down the middle of the frame — and straight down the middle
 * of the About head — where an odd one straddles it with a pair. The ground
 * straddles x = 0 the same way, its nearest verticals falling at ±100, so the
 * two agree about phase as well as pitch.
 *
 * It lands on 37, a cell of 200.4 against the ground's 200. That is a fifth of
 * a unit out at the pair beside the crown — the only two columns a phone can
 * see at this depth — and 1.7 at the widest column either surface draws.
 */
const RADIAL = (() => {
  const exact = (2 * Math.PI * WALL_DEPTH) / TERRAIN_CELL;
  return 2 * Math.round((exact - 1) / 2) + 1;
})();

/**
 * Half the frame at the wall's depth — how much further down the wall the foot
 * of the screen sees than the camera does.
 *
 * The one figure that makes the opening wall's length a question at all. On the
 * frame the flight takes over, the About section's grid is still drawn to the
 * bottom of the screen, so the surface has to still be that grid's plane this
 * far past the camera or the rings down there are somewhere it never drew them.
 * Everything {@link TUNNEL.handoverVh} buys is measured from here.
 */
const HALF_FRAME = Math.tan((FOV * Math.PI) / 360) * WALL_DEPTH;

/** the tube radius the preset opens at, in path units */
const WALL_TUBE = 10;

export const TUNNEL = {
  /**
   * World units per path unit.
   *
   * Derived rather than picked: the flat wall stands `tube` out from the spine,
   * so the scale that lands it on {@link WALL_Z} is that distance over the tube
   * the preset opens at.
   *
   * Nothing else in the flight notices. Every other length in here is in path
   * units too, so the scale moves the geometry and the camera *together* — the
   * picture through the lens is the same at any value of it, and the one thing
   * it can actually change is which plane the wall comes out on. It also leaves
   * the camera's 50 unit near plane a very long way inside the tube.
   */
  scale: WALL_DEPTH / WALL_TUBE,

  /**
   * Grid columns around the tube, and so the rule of the wall's lattice — see
   * {@link wallCell}.
   *
   * Not a number to pick. It is the hero's grid pitch, read off the ground in
   * {@link RADIAL} — which is also where the odd count is argued for.
   */
  radial: RADIAL,

  /** curve samples between drawn rings, so a turn's lines stay curved */
  subdiv: 3,

  /** extra surface above the start of the camera path, in path units */
  overhang: 22,
  /** path left ahead of the camera at full scroll, in path units */
  tail: 60,

  /**
   * How far the tunnel is drawn, in path units — the near and far of the fade
   * the grid and the shell are drawn through. The tunnel has no global fog
   * (adding one would reach every other section's materials), so both shaders
   * carry their own; see ./tunnelShader.
   */
  fogNear: 10,
  fogFar: 62,

  /**
   * The wall at rest, and what it goes towards where it is curling.
   *
   * White because the About section's grid is white and the two are one
   * surface — see {@link WALL_Z}. The hot colour is the one part of this that
   * isn't the wall: it only shows while `wrap` is between its two ends, which
   * is the throat and nowhere else.
   */
  colorBase: 0xffffff,
  colorHot: 0xffffff,
  /** the shell just behind the wireframe — near the background, never seen */
  colorShell: 0x000000,

  /**
   * How bright a line on the flat wall is, as alpha over black.
   *
   * The level the About section's grid leaves on, so the two meet without a
   * step — ../../About/scene/Scene reads its exit level off this rather than
   * the other way round, because past the handover the wall is the only one of
   * them still carrying the picture. Everything else is a multiple of it: see
   * ./geometry, where the wall brightens as it curls.
   */
  level: 0.18,

  /**
   * How much scroll the wall takes to stop being the About section's and start
   * being the tunnel's, in vh — and so the whole length of the seam between the
   * two sections. The knob for it, and the only one.
   *
   * Everything about the opening follows from it. The flat wall the flight
   * starts on is exactly long enough to hold the *whole frame* on the About
   * section's plane for this long and not a unit longer — solved rather than
   * typed, see {@link tunnelPath} — so the curl arrives at the foot of the
   * screen on the frame this runs out. Turn it down and the tunnel starts
   * sooner, with no stretch of flat wall left over behind it either way; the
   * section's own height follows too, since a shorter wall is less page.
   *
   * Zero is allowed and is not a cliff. The wall is still {@link HALF_FRAME}
   * long at zero, which is what keeps the lattice the About grid drew true
   * across the whole frame on the one frame it has to be — the swap simply
   * happens on that frame instead of over a window.
   *
   * What a short one spends is the fade, and it is worth knowing which fade.
   * The two grids are the same lattice on the same plane at this same
   * {@link TUNNEL.level}, so there is no longer anything to *move*; what is
   * left to cross is line weight, ../../About/scene/Scene ruling its grid 1.5
   * world units wide against this wireframe's one device pixel. That is the
   * one thing a short handover has nowhere to hide.
   */
  handoverVh: 0,

  /**
   * The card's plane, in path units across.
   *
   * The prototype used 11 at a 55 degree lens. This camera is 40, which
   * magnifies everything by about 1.4, so the same fraction of the screen wants
   * a smaller card.
   */
  cardWorld: 8,

  /** and the card's laid-out size in CSS px, whose ratio the plane keeps */
  cardW: 280,
  cardH: 200,

  /**
   * How much of the section's scroll a path unit is worth. Multiplied by the
   * path's own weight to size the section — change the preset and the page
   * grows or shrinks to keep the same pace, rather than the same flight
   * happening faster.
   */
  vhPerUnit: 1,
} as const;

/**
 * How many columns the wall is ruled into.
 *
 * One count, for every device, and it is worth saying why there isn't a cheaper
 * one for phones — there was, and it was wrong. A coarse pointer used to get 25
 * columns against the full 37, which is about half the tunnel's vertices: the
 * rings march by a cell too (see {@link wallCell}), so dropping the count thins
 * the surface in both directions at once. Cheap, and paid for at the other end
 * of the section. 25 columns rule the wall at 296 world units where the hero's
 * ground runs into this same plane at 200, so the verticals stopped meeting it
 * — and on a phone that seam is the *whole* of the grid anyone ever sees, the
 * frame being barely two columns wide at this depth.
 *
 * So the count is fixed, and a saving has to come from somewhere that doesn't
 * rule the surface. {@link TUNNEL.subdiv} is the one going spare: it only adds
 * samples *between* the rings, and spending it costs a turn some smoothness
 * rather than costing the lattice its pitch.
 */
export function wallColumnCount() {
  return TUNNEL.radial;
}

/* ==========================================================================
   The preset
   ========================================================================== */

/**
 * Switchback: fall down a flat wall, curl it into a tube, then a run of
 * alternating turns with a card on every straight, and out into the pool.
 *
 * Cards carry no content — only where they are. The slice fills the slots from
 * Prismic in the order they appear here; see ../scene/cardSlots.
 */
export const SWITCHBACK: TunnelSegment[] = [
  // No `run` on this one, and it is the only segment without one: how long the
  // opening wall is is not a fact about the shape, it is what the handover
  // costs, and {@link tunnelPath} solves it from {@link TUNNEL.handoverVh}.
  // First in the list for the same reason — the flat wall the About section
  // shares is where the flight opens, so that is the segment being solved.
  { label: "wall", tube: WALL_TUBE, wrap: 0, aim: 0, pace: 5.5 },
  { label: "throat", pitch: 90, bend: 26, wrap: 1, aim: 1, pace: 4.3 },

  { label: "run in", run: 76, card: { at: 0.55, u: 0.22, w: 3, h: 2 } },
  { label: "bear right", yaw: 62, bend: 34, roll: 20 },
  { label: "straight", run: 80, card: { at: 0.5, u: -0.24, w: 3, h: 2 } },
  { label: "hard left", yaw: -88, bend: 30, roll: -40 },
  { label: "straight", run: 55, card: { at: 0.5, u: 0.26, w: 3, h: 2 } },
  { label: "hard right", yaw: 88, bend: 30, roll: 40 },
  { label: "straight", run: 90, card: { at: 0.5, u: -0.22, w: 3, h: 2 } },
  { label: "bear left", yaw: -62, bend: 34, roll: -20 },
  { label: "out run", run: 72, card: { at: 0.5, u: 0.2, w: 3, h: 2 } },

  // straight on into the pool: past `pool` you are under it
  { label: "plunge", run: 150, pool: 0.3, pace: 1.3 },
];

/** The one the section flies. Swap it for another list and nothing else moves. */
export const TUNNEL_SEGMENTS: TunnelSegment[] = SWITCHBACK;

/* ==========================================================================
   Where it sits in the world
   ========================================================================== */

/**
 * The spine's start, in world coordinates.
 *
 * Placed so that the far end of the lead-in — the first frame the camera
 * actually occupies — lands exactly on {@link ABOUT_POSE}. The lead-in falls
 * straight down, so the origin is `overhang` above that pose and on the same
 * x/z. The camera is therefore already where the rig had left it on the frame
 * the section takes over, and the handover has nothing to cross.
 */
export const TUNNEL_ORIGIN = new THREE.Vector3(
  ABOUT_POSE.position[0],
  ABOUT_POSE.position[1] + TUNNEL.overhang * TUNNEL.scale,
  ABOUT_POSE.position[2],
);

/* ==========================================================================
   The wall, as a lattice
   ========================================================================== */

/**
 * One cell of the wall, in world units.
 *
 * The strip is `2*PI*tube` across whatever the wrap is doing, and ./geometry
 * marches the rings by this same figure — which is what keeps the cells square.
 * So one number rules the wall in both directions.
 */
export function wallCell(columns: number) {
  return (2 * Math.PI * WALL_DEPTH) / columns;
}

/**
 * The world x of every column ruled on the flat wall, out to `reach` either
 * side of the crown, ascending.
 *
 * The wall is a great deal wider than the screen — half of it is
 * `PI * WALL_DEPTH` — so a caller that only wants the columns crossing its own
 * plane says how far that reaches.
 */
export function wallColumns(columns: number, reach: number) {
  const cell = wallCell(columns);
  const out: number[] = [];

  for (let j = 0; j <= columns; j++) {
    const x = (j - columns / 2) * cell;
    if (Math.abs(x) <= reach) out.push(x);
  }

  return out;
}

/**
 * The world y of every ring on the flat wall between two heights, descending.
 *
 * Read off the rings ./geometry actually builds rather than from a spacing of
 * its own: they start at the spine's origin and step down by a cell from there,
 * and above that origin there is no surface at all. Only meaningful while the
 * spine is still falling — which is the whole of the wall and a good deal more.
 */
export function wallRows(columns: number, from: number, to: number) {
  const cell = wallCell(columns);
  const top = TUNNEL_ORIGIN.y;
  const out: number[] = [];

  const first = Math.max(0, Math.ceil((top - to) / cell));
  const last = Math.floor((top - from) / cell);

  for (let i = first; i <= last; i++) out.push(top - i * cell);

  return out;
}

/* ==========================================================================
   The compiled path, once
   ========================================================================== */

let compiled: CompiledPath | null = null;

/**
 * The preset compiled with the opening wall at `run` path units.
 *
 * The wall is the first segment by construction — it is the one the About
 * section shares, so it is where the flight opens — and its length is the only
 * thing about the shape this file decides rather than reads.
 */
function compileWall(run: number) {
  const [wall, ...rest] = TUNNEL_SEGMENTS;

  return compile([{ ...wall, run }, ...rest], {
    scale: TUNNEL.scale,
    origin: TUNNEL_ORIGIN,
    overhang: TUNNEL.overhang,
    tail: TUNNEL.tail,
  });
}

/**
 * The path every part of the section reads: the geometry builder, the flight,
 * the cards, and the slice that sizes the page off its weight.
 *
 * A module singleton rather than a hook, for ../scene/cardSlots' reason — there
 * is only ever one Works section, its input is a module constant, and the
 * compile has to happen before React renders anything so the section's own
 * height can be a function of it.
 */
export function tunnelPath(): CompiledPath {
  if (compiled) return compiled;

  // ── How long the opening wall is ──────────────────────────────────────
  //
  // Solved, not authored — {@link TUNNEL.handoverVh} is the number it is in
  // service of. The wall has to hold the whole frame flat for as long as the
  // handover lasts, which is {@link HALF_FRAME} for what the foot of the
  // screen can see past the camera, plus however far the camera itself falls
  // in that time. And that fall is a question about the launch ease, which is
  // a question about the path — which is this. So it is asked of a trial path,
  // and then asked again of the answer.
  //
  // It converges at once, and three rounds is already generous. The wall is a
  // couple of percent of the flight's weight, so its own length barely moves
  // the section's height or the speed the ease has reached by the end of the
  // handover; what is being iterated is a fall of a few dozen units taken at
  // the slowest the flight ever goes.
  //
  // Nothing longer than it needs, either, and that is the half worth having:
  // the curl reaches the foot of the screen on the exact frame the handover
  // runs out, rather than after a stretch of flat wall nobody asked for.
  const want = Math.max(0, TUNNEL.handoverVh);
  let run = HALF_FRAME / TUNNEL.scale;

  for (let i = 0; i < 3; i++) {
    compiled = compileWall(run);
    launched = null;

    const fall =
      flightDistance(want / Math.max(1, worksSectionVh() - 100)) -
      compiled.travelA;

    run = (HALF_FRAME + fall) / TUNNEL.scale;
  }

  compiled = compileWall(run);
  launched = null;

  if (process.env.NODE_ENV !== "production") {
    for (const w of compiled.warn.concat(proximityWarnings(compiled))) {
      console.warn(`[works tunnel] ${w}`);
    }

    // The solve should land the handover on the knob exactly, so a miss means
    // the preset has done something it does not know about — a first segment
    // that is not the flat wall, most likely. Worth saying out loud: what is
    // downstream of it is the About section handing its grid to a surface that
    // has already moved, and nothing over there can see that from where it
    // sits.
    const got = wallHandoverVh();

    if (Math.abs(got - want) > 0.5) {
      console.warn(
        `[works tunnel] asked for a ${want}vh handover, the opening wall carries ${got.toFixed(1)}vh of one — is the first segment still the flat wall?`,
      );
    }

    // And the other end of it, which the wall cannot see: the About section's
    // grid runs out before the wall does. See {@link HANDOVER_LIMIT_VH}.
    if (want > HANDOVER_LIMIT_VH) {
      console.warn(
        `[works tunnel] a ${want}vh handover outlives the About section's own grid — past about ${HANDOVER_LIMIT_VH}vh the bottom ends of its verticals rise into frame while it is still being drawn`,
      );
    }
  }

  return compiled;
}

/* ==========================================================================
   The launch
   ========================================================================== */

/**
 * The flight cannot start at flying speed.
 *
 * The wall is the About section's grid — see {@link WALL_Z} — and that grid is
 * already moving when the flight takes it over: the section rises
 * {@link ABOUT_EXIT_LIFT} over its last screen of scroll. Handing the same
 * surface to a camera that falls thirteen times faster the moment it arrives is
 * a change of pace in a thing that has not changed, and it reads as two
 * backgrounds rather than one.
 *
 * So the section's scroll is not linear in the path's weight. It opens at the
 * speed the exit ends on and eases up to the flight's own across the flat wall,
 * reaching it exactly as the wall starts to curl. The three numbers here are
 * that ease, and every one of them is worked out rather than typed, because
 * every input to them lives somewhere else: the exit's lift, the pace the
 * preset opens at, and how much of the path is flat.
 */
type Launch = {
  /** the opening speed, as a fraction of the flight's nominal */
  slow: number;
  /** how much of the section's scroll the ease takes, as a fraction */
  span: number;
  /**
   * What the ease costs, as a divisor on the section's height.
   *
   * The scroll a slow opening eats has to come from somewhere. Taking it out of
   * the rest of the flight would speed that up to pay for it, so the page grows
   * instead and everything past the wall runs at exactly the pace it was
   * authored at.
   */
  cost: number;
};

let launched: Launch | null = null;

function launch(): Launch {
  if (launched) return launched;

  const path = tunnelPath();
  const total = path.weightB - path.weightA;

  // How much of the flight is spent on the flat wall: everything up to the
  // first segment that starts to curl. That is where the ease has to be done,
  // because it is where the surface stops being the one the About section was
  // composed against.
  const curl = path.segs.find((seg) => seg.wrap1 > seg.wrap0);
  const flat = Math.min(
    0.9,
    Math.max(0, ((curl ? curl.w0 : path.weight) - path.weightA) / total),
  );

  // The opening speed the flight would have without any of this, in world units
  // per vh: one vh is `scale / vhPerUnit` of weight, and how much distance that
  // buys depends on the pace the path opens at. Differenced off the path rather
  // than read off the preset, so it stays true of whatever segment is first.
  const dw = total * 1e-6;
  const nominal =
    ((distanceOf(path, path.weightA + dw) - path.travelA) / dw) *
    (TUNNEL.scale / TUNNEL.vhPerUnit);

  const slow = Math.min(1, ABOUT_EXIT_LIFT / 100 / nominal);

  // and the span that lands the end of the ease on the end of the wall: the
  // solution of `launchEase(span) === flat`
  const span = flat > 0 ? (2 * flat) / (1 + slow + flat * (1 - slow)) : 0;

  launched = { slow, span, cost: 1 - ((1 - slow) * span) / 2 };
  return launched;
}

/**
 * The share of the flight's weight covered at a scroll progress of 0..1.
 *
 * A smoothstep on *speed* rather than on position — the multiplier runs from
 * `slow` up to 1 over the first `span` of the section and stays there — and
 * this is its integral, normalised so that full scroll is still the whole
 * flight. Closed form, and it can be: the section asks for a distance from a
 * progress and never the other way round, so there is nothing to invert.
 */
function launchEase(p: number) {
  const { slow, span, cost } = launch();
  if (span <= 0) return p;

  if (p >= span) return ((span * (1 + slow)) / 2 + p - span) / cost;

  const u = p / span;
  return (
    (slow * p + (1 - slow) * span * (u * u * u - (u * u * u * u) / 2)) / cost
  );
}

/** Where along the spine a scroll progress of 0..1 puts the camera. */
export function flightDistance(progress: number) {
  const path = tunnelPath();
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;

  return distanceAtProgress(path, launchEase(t));
}

/**
 * How tall the section is, in `vh`.
 *
 * A screen for the tunnel to be seen through, plus the flight's own weight at
 * {@link TUNNEL.vhPerUnit}, plus what {@link launch} spends getting up to
 * speed. Derived rather than typed so that editing the preset cannot silently
 * change the pace of the whole thing: a longer tunnel takes more page, exactly
 * as much more as it added.
 */
export function worksSectionVh() {
  const path = tunnelPath();
  const travel = (path.weightB - path.weightA) / path.scale;

  return Math.round(100 + (travel * TUNNEL.vhPerUnit) / launch().cost);
}

/**
 * The most of a handover the *other* section can actually back up, in vh.
 *
 * A warning threshold and deliberately not a cap: {@link TUNNEL.handoverVh} is
 * a knob and a knob that quietly disobeys is worse than one that lets you see
 * what you asked for. Past this you can, and the picture tells you why.
 *
 * What runs out is not the wall — the wall is solved to fit — but the plane the
 * About section rules its copy of the grid on. That grid is 2000 units tall and
 * the wall is not: on the frame the flight starts, the bottom ends of its
 * verticals are only about 175 units below the fold at the corners of a wide
 * window, and the camera is falling into them at somewhere between five and
 * thirteen units a vh. Twenty of those is about 165 units, which still clears.
 * Cross it and the handover ends as a row of stubs sweeping up the screen,
 * which is a worse seam than the one it exists to hide.
 *
 * Quoted against the *fall* and not against a speed, which is the correction
 * this figure needed once: the launch is an ease, so the wall is moving half as
 * fast again at the end of the window as at its start.
 */
const HANDOVER_LIMIT_VH = 20;

/**
 * Where the flat wall stops filling the frame, as a distance along the spine.
 *
 * Not where the *camera* reaches the curl: the foot of the screen sees
 * {@link HALF_FRAME} further down the wall than the camera does, so it gets
 * there first. That half frame is the whole of the difference between this and
 * the curl's own start, and it is why the wall's length is solved from a
 * handover rather than typed — see {@link tunnelPath}.
 *
 * Infinity for a preset that never curls, which is flat for all of it.
 */
function flatWallEnd(path: CompiledPath) {
  const curl = path.segs.find((seg) => seg.wrap1 > seg.wrap0);
  if (!curl) return Infinity;

  return curl.s0 - HALF_FRAME;
}

/**
 * How long the About section's copy of the wall stays true, in vh of the
 * flight — and so how long the two sections have to cross one grid into the
 * other.
 *
 * {@link TUNNEL.handoverVh} is what that wants to be and the wall is solved to
 * carry exactly it, so this is in practice the knob read back off the geometry
 * rather than a second opinion about it. Read back rather than simply returned,
 * because reading it back is the one place the two can disagree:
 * ../../About/scene/Scene draws its grid — and the black plane behind it — on
 * the flat plane at {@link WALL_Z}, and both stop being the wall the moment any
 * part of the frame is showing surface that has begun to turn.
 *
 * One figure and not two, because both halves of the fade are run off it:
 * ../scene/Scene brings the tunnel's own grid up over exactly this window as
 * the About section takes its copy out. Split them and the middle of the
 * handover is a brightness step, which is the thing being hidden.
 *
 * Zero is a real answer and a reachable one, {@link TUNNEL.handoverVh} being
 * allowed to be zero. There is no window to spend then, only the one frame on
 * which the two lattices coincide exactly — so the swap happens on that.
 */
export function wallHandoverVh() {
  const path = tunnelPath();
  const want = Math.max(0, TUNNEL.handoverVh);
  const s = flatWallEnd(path);

  if (s === Infinity) return want;
  if (s <= path.travelA) return 0;

  // The ease is only ever asked forwards — see {@link launchEase}, which is
  // closed form for exactly that reason — so this reads it the same way and
  // bisects instead. Forty halvings of a monotone function, asked once.
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (flightDistance(mid) < s) lo = mid;
    else hi = mid;
  }

  return Math.min(want, lo * (worksSectionVh() - 100));
}
