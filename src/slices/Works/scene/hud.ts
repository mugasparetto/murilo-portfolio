"use client";

import { create } from "zustand";

import {
  emergence,
  frameAt,
  makeFrame,
  submersion,
} from "../scene-core/path";
import {
  flightDistance,
  tunnelPath,
  worksSectionVh,
} from "../scene-core/presets";

/**
 * The handle between the Works HUD's markup and the frame loop that drives it.
 *
 * Two kinds of thing change, at two very different rates, and they go two
 * different ways. Whether the HUD is showing and which card the counter is on
 * change a handful of times in the whole flight, so they are React state — the
 * counter's roll is a transition on them. Everything else is scrubbed by the
 * scroll and changes every frame of it: the row drawing in and the rail's
 * cursor moving. Those
 * are written straight onto the elements published here, the way ./cardSlots
 * does for the cards — routing them through React would re-render the HUD
 * sixty times a second to move a handful of boxes.
 *
 * Module-scoped like its neighbours: there is only ever one Works section.
 */

type HudState = {
  /** whether the HUD is showing */
  on: boolean;
  /** how many cards have been reached — 0 until the first one is out */
  index: number;
};

export const useHud = create<HudState>(() => ({ on: false, index: 0 }));

/**
 * The elements the frame loop writes to: the stage, which carries the scroll
 * position every scrubbed part of the HUD reads its own progress from, and the
 * rail's fill and cursor.
 */
const els: {
  stage: HTMLElement | null;
  fill: HTMLElement | null;
  cursor: HTMLElement | null;
} = {
  stage: null,
  fill: null,
  cursor: null,
};

export function publishHudStage(el: HTMLElement | null) {
  els.stage = el;
}

export function publishHudFill(el: HTMLElement | null) {
  els.fill = el;
}

export function publishHudCursor(el: HTMLElement | null) {
  els.cursor = el;
}

export function hudElements() {
  return els;
}

/* ==========================================================================
   The choreography, in vh of scroll since the HUD appears
   ========================================================================== */

/** what the HUD says — the same word the nav links to this section with */
export const HUD_WORD = "WORKS";

/**
 * The corner row arrives as the first card starts coming out of the wall:
 * starting this far before that moment, and taking this long.
 */
const CORNER_LEAD_VH = 10;
const CORNER_VH = 14;

/**
 * A card is all the way out of the wall at this `emergence`: as far out as it
 * goes, less a hair, because a smoothstep only creeps up to 1.
 */
const OUT = 0.999;

/**
 * Where the camera is said to have reached a card: this share of the way
 * through the stretch the card stays all the way out, from first being fully
 * out on the way in to starting back into the wall.
 *
 * Down the tunnel that is about 20 path units short of the card, two tube
 * radii. Taking the moment the card is first fully out instead stops the
 * camera about 34 short, which is too far. On SLALOM that point is still in
 * the carve before the card's straight, so the view is still turning. At this
 * share the camera is past the carve and on the straight, and on desktop the
 * card is about 1.7 times as wide as it was. Much later and it overruns the
 * edge of the frame: at 1024px wide this leaves it about 50px from the edge,
 * and 18 units would leave 14px. A touch earlier than the round number,
 * because the drawn card snaps to the nearest ring and can sit a unit or so
 * nearer than the card's own `s`, which is what is read here.
 */
const REACHED = 0.6;

/** how far under the water the camera is when the HUD leaves */
export const HUD_SUBMERGED = 0.5;

type HudLayout = {
  /** section progress at which the HUD appears — the zero of everything below */
  revealT: number;
  /** vh of section scroll per unit of progress */
  flightVh: number;
  /** the corner row arriving, in vh since the reveal */
  cornerFromV: number;
  cornerToV: number;
  /** per card: the spine distance at which it counts as reached */
  reachS: number[];
  /**
   * and the same moment as section progress: when its tick lights, and where
   * clicking the tick sends the page
   */
  ticks: number[];
  /** per card: where its tick sits along the rail, 0..1 — evenly spaced */
  marks: number[];
  /**
   * where the pool's tick, at the rail's right end, sends the page: the camera
   * all the way under the water, just past where the HUD leaves
   */
  poolT: number;
  /**
   * The rail's cursor, as knots of section progress against rail position:
   * the row starting to draw in at 0, each card reached on its mark, and the
   * HUD leaving at 1. Both increasing.
   */
  knotT: number[];
  knotX: number[];
};

/** keyed by work count, like the path it is read off */
const layouts = new Map<number, HudLayout>();

/**
 * Worked out once per work count from the compiled path, which is kept per
 * count, so this is too.
 *
 * The HUD's zero is where the wall starts to curl — the foot of the screen
 * on the frame the flight takes over — so the counting starts with the throat,
 * where the wall title is. The row itself waits for the first card: it draws
 * in as that card starts coming out of the wall, so the corner fills in as
 * there is something to count.
 *
 * A card counts as reached partway through the stretch it is all the way out
 * of the wall for (see {@link REACHED}), so the counter turns over while the
 * card is presented rather than when the camera finally passes it. That one
 * moment is everything the HUD says about the card: where its tick sits, when
 * the tick lights and the count turns over, and where clicking the tick takes
 * the page. So a click leaves the cursor on the mark that was clicked, with the
 * count agreeing. The card moments here are read off `emergence` itself, at
 * the aim the card is approached with, rather than restated.
 *
 * The ticks are evenly spaced along the rail. The cards are not evenly spaced
 * along the flight: the run in from the wall, the stretch between two cards and
 * the dive to the pool after the last one all differ, and the dive is the
 * longest. Placed at their true progress, the ticks bunched on the left with an
 * empty stretch to the right. So the rail is a timeline of the cards rather than
 * of the scroll. It covers the stretch the row is on screen for, from starting
 * to draw in until the HUD leaves. Each gap, first and last included, is the
 * same share of it, and the cursor runs at whatever pace gets it from one mark
 * to the next as the next card is reached.
 *
 * The rail's right end has a tick too, for the pool. Clicking it dives the
 * page in, going on past the end of the rail until the water has closed over.
 * By then the HUD has gone, so nothing is left on screen for the cursor to
 * disagree with. It is not a work, so the counter does not count it.
 */
export function hudLayout(count: number): HudLayout {
  const hit = layouts.get(count);
  if (hit) return hit;

  const path = tunnelPath(count);
  const curl = path.segs.find((seg) => seg.wrap1 > seg.wrap0);
  const fr = makeFrame();

  const step = 0.25 * path.scale;

  /** where along the spine a card has come `share` of the way out */
  const outBy = (s: number, share: number) => {
    const aim = frameAt(path, s, fr).aim;

    // walk in from well beyond any approach until it is that far out
    let d = 120 * path.scale;
    while (d > 0 && emergence(d, aim, path.scale) < share) d -= step;

    return s - d;
  };

  /** where along the spine a card counts as reached — see {@link REACHED} */
  const reachedAt = (s: number) => {
    const aim = frameAt(path, s, fr).aim;
    const out = (d: number) => emergence(d, aim, path.scale) >= OUT;

    // walk in to where it is first all the way out, then on to where it
    // starts back
    let d = 120 * path.scale;
    while (d > 0 && !out(d)) d -= step;
    const from = d;
    while (d > 0 && out(d)) d -= step;
    const to = Math.min(from, d + step);

    return s - (from + (to - from) * REACHED);
  };

  /** section progress at a spine distance — flightDistance's inverse */
  const progressAt = (s: number) => {
    let lo = 0;
    let hi = 1;

    // it is only ever asked forwards, so bisect it
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (flightDistance(count, mid) < s) lo = mid;
      else hi = mid;
    }

    return lo;
  };

  const flightVh = Math.max(1, worksSectionVh(count) - 100);

  const revealS = curl ? curl.s0 : path.travelA;
  const revealT = progressAt(revealS);

  const reachS = path.cards.map((card) => reachedAt(card.s));
  const ticks = reachS.map(progressAt);

  // the row lands as the first card starts to come out of the wall
  const landS = path.cards.length > 0 ? outBy(path.cards[0].s, 0.01) : revealS;
  const landV = Math.max(
    CORNER_LEAD_VH,
    (progressAt(landS) - revealT) * flightVh,
  );
  const cornerFromV = landV - CORNER_LEAD_VH;

  /**
   * section progress at which the camera is first `level` under the water, or
   * the end of the flight on a path without a pool
   */
  const underAt = (level: number) => {
    const pool = path.pool;
    if (pool == null) return 1;

    // submersion only rises, and only over the last stretch before the surface
    // and just past it, so it can be bisected for there
    let lo = pool - 20 * path.scale;
    let hi = pool + 10 * path.scale;

    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (submersion(pool - mid, path.scale) < level) lo = mid;
      else hi = mid;
    }

    return progressAt(hi);
  };

  // The rail's two ends: the row starting to draw in, and the HUD leaving as
  // the camera goes under.
  const railFromT = revealT + cornerFromV / flightVh;
  const railToT = underAt(HUD_SUBMERGED);

  // the pool's tick goes on until the water has closed over
  const poolT = underAt(1);

  const marks = ticks.map((_, i) => (i + 1) / (ticks.length + 1));

  // Only the knots that keep both columns increasing. Each one is, on any path
  // the presets make, but a knot out of order would send the cursor backwards.
  const knotT = [railFromT];
  const knotX = [0];
  const keep = (t: number, x: number) => {
    if (t > knotT[knotT.length - 1] && x > knotX[knotX.length - 1]) {
      knotT.push(t);
      knotX.push(x);
    }
  };
  ticks.forEach((t, i) => keep(t, marks[i]));
  keep(railToT, 1);

  const layout = {
    revealT,
    flightVh,
    cornerFromV,
    cornerToV: cornerFromV + CORNER_VH,
    reachS,
    ticks,
    marks,
    poolT,
    knotT,
    knotX,
  };

  layouts.set(count, layout);
  return layout;
}

/**
 * Where the rail's cursor sits, 0..1, at section progress `t`: straight lines
 * between the layout's knots, held at either end.
 */
export function railAt(L: HudLayout, t: number) {
  const { knotT, knotX } = L;
  const last = knotT.length - 1;

  if (t <= knotT[0]) return 0;
  if (t >= knotT[last]) return knotX[last];

  let i = 1;
  while (knotT[i] < t) i++;

  const k = (t - knotT[i - 1]) / (knotT[i] - knotT[i - 1]);
  return knotX[i - 1] + (knotX[i] - knotX[i - 1]) * k;
}
