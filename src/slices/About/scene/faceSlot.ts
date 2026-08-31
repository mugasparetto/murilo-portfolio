"use client";

/**
 * The box <AboutContent /> reserves for the face in the middle of the mobile
 * column, in *page* coordinates — so <Scene /> can put the head in it.
 *
 * Its own module because it is the one thing both trees need: <AboutContent />
 * writes it and <Scene /> reads it, and neither should have to import the
 * other to do so — a scene file has no business pulling in a DOM component
 * that registers GSAP plugins at module scope, and a DOM component has none
 * pulling in three. Same reason ./aboutVisibility is its own, and module-scoped
 * for the same one too: there is only ever one About section.
 *
 * The column is ordinary page content, so a box in it has a *fixed* document
 * position — it moves only on a reflow, which is a resize, a rewrap or an edit
 * in Prismic, all of which <AboutContent />'s observer already watches for.
 * That leaves the per-frame question as a subtraction against a scroll the
 * frame loop has already read:
 *
 *     screen y = page y - scroll
 *
 * No projection, and no `getBoundingClientRect()` inside the frame — this
 * measures on resize, never on scroll. It replaces a pair of offsets that had
 * to be computed twice, once by the old fixed layer's driver and once by
 * <Scene />, so that a head could not end up a frame behind its own hole.
 *
 * The box is in ordinary flow and has to stay that way for any of the above to
 * hold: a `sticky` hole is one whose rect is no longer where it was laid out,
 * so `box.top + scrollY` stops being a document position and starts walking
 * down the page with the reader. It was pinned once, while the cards below it
 * stacked, and that cost this module its own premise — the pin had to be
 * modelled here as a clamp, off an anchor measured from a block that could not
 * pin, so that the frame loop could keep its subtraction. With the cards back
 * in flow the pin has nothing to hold and the premise is simply true again.
 */

export type FaceSlot = {
  /** viewport x of the box's left edge; the page never scrolls sideways */
  left: number;
  /** the box's top edge in *document* coordinates */
  pageTop: number;
  width: number;
  height: number;
};

const state: { el: HTMLElement | null; slot: FaceSlot | null } = {
  el: null,
  slot: null,
};

/**
 * Re-read the box.
 *
 * `window.scrollY` rather than the eased figure <ScrollYProvider /> keeps: this
 * turns a viewport rect into a page position, and the rect was measured against
 * the page as it is laid out right now. The two agree except mid-fling, and
 * this never runs mid-fling.
 *
 * A zero width means there is no slot — `lg:hidden` takes the box away entirely
 * from `lg` up, which is exactly what the scene wants to hear: no column for
 * the head to sit in, so it goes back to the world position it is authored at.
 */
export function measureFaceSlot() {
  const el = state.el;
  if (!el) {
    state.slot = null;
    return;
  }

  const box = el.getBoundingClientRect();

  state.slot =
    box.width > 0
      ? {
          left: box.left,
          pageTop: box.top + window.scrollY,
          width: box.width,
          height: box.height,
        }
      : null;
}

/** Where the box is, for <Scene /> — the only caller. */
export function readFaceSlot() {
  return state.slot;
}

/**
 * Hands the element over as a ref callback: `<div ref={publishFaceSlot} />`.
 *
 * Measured on the spot, for the case where it arrives long after the observer
 * was set up — crossing `lg` re-renders <AboutContent /> and hands over a
 * different element, or none.
 */
export function publishFaceSlot(el: HTMLElement | null) {
  state.el = el;
  measureFaceSlot();
}
