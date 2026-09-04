import * as THREE from "three";

import { ABOUT_EXIT_LIFT, ABOUT_POSE } from "@/app/components/poses";
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
   * Odd on purpose. An even count puts a column on the crown, which on the flat
   * wall is a line straight down the middle of the frame — and straight down
   * the middle of the About head. An odd one straddles it with a pair.
   */
  radial: 37,
  /** a coarse pointer gets fewer, and pays for a third less geometry */
  radialCoarse: 25,

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

/** how many columns the wall is ruled into, for a pointer of either kind */
export function wallColumnCount(coarse: boolean) {
  return coarse ? TUNNEL.radialCoarse : TUNNEL.radial;
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
  { label: "wall", run: 30, tube: WALL_TUBE, wrap: 0, aim: 0, pace: 5.5 },
  { label: "throat", pitch: 90, bend: 26, wrap: 1, aim: 1, pace: 1.3 },

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

  compiled = compile(TUNNEL_SEGMENTS, {
    scale: TUNNEL.scale,
    origin: TUNNEL_ORIGIN,
    overhang: TUNNEL.overhang,
    tail: TUNNEL.tail,
  });

  if (process.env.NODE_ENV !== "production") {
    for (const w of compiled.warn.concat(proximityWarnings(compiled))) {
      console.warn(`[works tunnel] ${w}`);
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
