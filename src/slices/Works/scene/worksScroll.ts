"use client";

import { cssVh } from "@/app/helpers/viewport";

/**
 * Where the Works section sits on the page, and therefore how far through the
 * flight the tunnel is.
 *
 * Its own module for ../../About/scene/aboutExit's reasons, and it is the same
 * shape: a page position measured on reflow, turned into a per-frame answer by
 * a subtraction against a scroll the frame loop has already read. Nothing here
 * runs on scroll, and nothing in the frame asks the DOM anything.
 *
 * ── Why the section measures itself instead of taking a `vh` window ────────
 *
 * <ScrollRig />'s windows are absolute: `startVh: 115, endVh: 250` quoted
 * against the page as a whole. That works for the hero, whose height is a
 * number typed in its own class. This section starts wherever the About section
 * happens to end, and the About section's height is a function of how many
 * skills are in Prismic — so an absolute window would need editing every time
 * someone added one, and would be wrong until they did. Measuring the element
 * is the same figure without the standing appointment.
 *
 * The window is the section's own scroll: 0 the moment its top reaches the top
 * of the viewport, 1 when its foot reaches the foot. That is exactly the stretch
 * over which the section is the only thing on screen, which is what the
 * takeover of the camera needs it to be.
 *
 * `cssVh` and not `innerHeight`, for the reason the helper gives at length: the
 * section's height is written in CSS `vh`, so the travel it leaves has to be
 * measured in CSS `vh` too. On iOS the two are an address bar apart.
 *
 * Module-scoped like its neighbours: there is only ever one Works section.
 */

const state: { el: HTMLElement | null; top: number; height: number } = {
  el: null,
  top: 0,
  height: 0,
};

/**
 * Re-read the section's box.
 *
 * `window.scrollY` rather than the eased figure <ScrollYProvider /> keeps: this
 * turns a viewport rect into a page position, and the rect was measured against
 * the page as it is laid out right now.
 */
export function measureWorks() {
  const el = state.el;

  if (!el) {
    state.height = 0;
    return;
  }

  const rect = el.getBoundingClientRect();
  state.top = rect.top + window.scrollY;
  state.height = rect.height;
}

/**
 * How far through the flight the scroll is — below 0 before the section is
 * reached, above 1 once it is past, and -1 for "nothing measured yet", which
 * reads the same as "not here" everywhere it is used.
 *
 * Deliberately unclamped in between, because the two ends are not the same
 * question as the middle: the tunnel is only drawn, and only takes the camera,
 * while this is inside [0, 1], and the sign is how it knows.
 */
export function worksProgress(scrollY: number) {
  const travel = state.height - cssVh();
  if (travel <= 0) return -1;

  return (scrollY - state.top) / travel;
}

/** Hands the section over: <Works /> calls it with the element on mount. */
export function publishWorks(el: HTMLElement | null) {
  state.el = el;
  measureWorks();
}
