"use client";

import { create } from "zustand";

import { emergence, frameAt, makeFrame } from "../scene-core/path";
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
 * scroll and changes every frame of it: the letters arriving, the glide from
 * the centre to the corner, the rail drawing in and its cursor moving. Those
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
 * One letter's arrival, and the count-off from one letter to the next — the
 * About stats' figures (`STATS_ARRIVE_VH`, `STATS_STAGGER_VH` in
 * ../../About/scene/AboutContent), so the two sections count things in the same
 * rhythm. The stagger is well short of the arrival, so the word reads as one
 * thing arriving unevenly rather than five separate arrivals.
 */
export const LETTER_ARRIVE_VH = 11;
export const LETTER_STAGGER_VH = 5;

/** how long the word is held in the centre, whole, before it sets off */
const HOLD_VH = 6;

/**
 * The rail and counter arrive in the corner as the word lands there: starting
 * this far before the glide ends, and taking this long.
 */
const CORNER_LEAD_VH = 10;
const CORNER_VH = 14;

/** the least the glide is given, should the stretch before the card be short */
const MIN_GLIDE_VH = 12;

type HudLayout = {
  /** section progress at which the HUD appears — the zero of everything below */
  revealT: number;
  /** vh of section scroll per unit of progress */
  flightVh: number;
  /** the glide from the centre to the corner, in vh since the reveal */
  glideFromV: number;
  glideToV: number;
  /** the rail and counter arriving in the corner, in vh since the reveal */
  cornerFromV: number;
  cornerToV: number;
  /** per card slot: the spine distance at which it counts as reached */
  reachS: number[];
  /** and the same moment as section progress, which is where its tick sits */
  ticks: number[];
};

let layout: HudLayout | null = null;

/**
 * Worked out once from the compiled path — a module singleton, so this is too.
 *
 * The HUD appears where the wall starts to curl. That is the foot of the
 * screen on the frame the flight takes over and the camera reaches it a screen
 * of scroll later, by which point the About column has gone: so the word
 * arrives into the empty stretch it exists to fill, not on top of the copy
 * that is leaving.
 *
 * It has to be in its corner by the time the first card starts coming out of
 * the wall. The card emerges near the vanishing point, which is exactly where
 * the word was, so the one has to be gone before the other arrives. Between the
 * two, the letters come in, the word holds, and the rest is the glide.
 *
 * A card counts as reached once it is halfway out of the wall on the way in,
 * so the counter turns over as the card becomes the thing on screen rather than
 * when the camera finally passes it. Both card moments are read off
 * `emergence` itself, at the aim the card is approached with, rather than
 * restated here.
 */
export function hudLayout(): HudLayout {
  if (layout) return layout;

  const path = tunnelPath();
  const curl = path.segs.find((seg) => seg.wrap1 > seg.wrap0);
  const fr = makeFrame();

  /** where along the spine a card has come `share` of the way out */
  const outBy = (s: number, share: number) => {
    const aim = frameAt(path, s, fr).aim;

    // walk in from well beyond any approach until it is that far out
    const step = 0.25 * path.scale;
    let d = 120 * path.scale;
    while (d > 0 && emergence(d, aim, path.scale) < share) d -= step;

    return s - d;
  };

  /** section progress at a spine distance — flightDistance's inverse */
  const progressAt = (s: number) => {
    let lo = 0;
    let hi = 1;

    // it is only ever asked forwards, so bisect it
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (flightDistance(mid) < s) lo = mid;
      else hi = mid;
    }

    return lo;
  };

  const flightVh = Math.max(1, worksSectionVh() - 100);

  const revealS = curl ? curl.s0 : path.travelA;
  const revealT = progressAt(revealS);

  const reachS = path.cards.map((card) => outBy(card.s, 0.5));
  const ticks = reachS.map(progressAt);

  // the glide ends as the first card starts to come out of the wall
  const landS = path.cards.length > 0 ? outBy(path.cards[0].s, 0.01) : revealS;
  const lettersVh =
    (HUD_WORD.length - 1) * LETTER_STAGGER_VH + LETTER_ARRIVE_VH;

  const glideToV = Math.max(
    lettersVh + MIN_GLIDE_VH,
    (progressAt(landS) - revealT) * flightVh,
  );
  const glideFromV = Math.min(lettersVh + HOLD_VH, glideToV - MIN_GLIDE_VH);

  const cornerFromV = glideToV - CORNER_LEAD_VH;

  layout = {
    revealT,
    flightVh,
    glideFromV,
    glideToV,
    cornerFromV,
    cornerToV: cornerFromV + CORNER_VH,
    reachS,
    ticks,
  };

  return layout;
}
