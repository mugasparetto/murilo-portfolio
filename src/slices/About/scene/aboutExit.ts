"use client";

import { cssVh } from "@/app/helpers/viewport";

/**
 * Where the About section ends, in *page* coordinates — so <Scene /> can take
 * the scene out with the column.
 *
 * Its own module for ./faceSlot's reasons, and it is the same shape: a page
 * position measured on reflow, turned into a per-frame answer by a subtraction
 * against a scroll the frame loop has already read. Nothing here runs on
 * scroll, and nothing in the frame asks the DOM anything.
 *
 * The section's foot is the one figure the scene needs because it is the one
 * the *column* leaves on. Every pinned block in <AboutContent /> is given a
 * run-out that makes it come unpinned on the same pixel — the moment that foot
 * reaches the fold — and from there the whole composition rides the wheel off
 * the top of the screen. The scene has no sticky and no column to be released
 * from, so it is handed the same instant to leave on instead: read the progress
 * here, move the group by it, and the two halves of the section go together
 * without either having to know how the other is built.
 *
 * Module-scoped, like the other two. There is only ever one About section.
 */

const state: { el: HTMLElement | null; pageBottom: number | null } = {
  el: null,
  pageBottom: null,
};

/**
 * Re-read the section's foot.
 *
 * `window.scrollY` rather than the eased figure <ScrollYProvider /> keeps —
 * ./faceSlot's argument exactly: this turns a viewport rect into a page
 * position, and the rect was measured against the page as it is laid out right
 * now.
 *
 * It moves for two different reasons, which is why its caller watches two
 * things: the section's own height changes when a skill is added in Prismic,
 * and its position changes when anything above it rewraps.
 */
export function measureAboutExit() {
  const el = state.el;
  if (!el) {
    state.pageBottom = null;
    return;
  }

  state.pageBottom = el.getBoundingClientRect().bottom + window.scrollY;
}

/**
 * How far through its exit the section is: 0 while its foot is still below the
 * fold, 1 once it has passed the top of the screen, and the wheel in between.
 *
 * A screen's worth of scroll, because that is exactly what there is — the foot
 * crossing the viewport from bottom to top is the last of the section, and the
 * same stretch the column spends leaving. That is not a coincidence to be kept
 * in step by hand either: a run-out of `100vh - top - height` puts every
 * release at `pageBottom - 100vh` however tall the blocks are, so this window
 * is the column's by construction.
 *
 * `cssVh` and not `innerHeight`, for the reason the helper gives at length: the
 * run-outs are CSS `vh`, so the moment they fire is in CSS `vh` too, and on iOS
 * the two units are an address bar apart. It hands back the whole 100 of them
 * in px — the figure `pxToVh` divides by — so it *is* the screen, with no
 * arithmetic on top. Multiply it and the window grows by that factor while its
 * start walks back up the page, which puts the section's exit somewhere in the
 * middle of the hero and leaves the scene lifted for the whole document.
 *
 * Zero before anything has been measured, which is the answer that leaves the
 * scene where it is authored.
 */
export function aboutExitProgress(scrollY: number) {
  const bottom = state.pageBottom;
  if (bottom === null) return 0;

  const screen = cssVh();
  const t = (scrollY - (bottom - screen)) / screen;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Hands the section over: `publishAboutExit` is called with it on mount. */
export function publishAboutExit(el: HTMLElement | null) {
  state.el = el;
  measureAboutExit();
}
