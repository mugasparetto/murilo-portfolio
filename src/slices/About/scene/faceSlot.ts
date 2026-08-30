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
 * ── The box pins ───────────────────────────────────────────────────────────
 *
 * Below `lg` the hole is `position: sticky`: the cards stack for most of a
 * screen after the face would otherwise have left the top of it, and a head
 * that leaves while its own skills are still arriving takes the whole top of
 * the composition with it. So the box holds at {@link FaceSlot.pinTop} once
 * the page has carried it that far up.
 *
 * That costs this module the one sentence it was built on, and it is worth
 * being exact about which one. A pinned box's *rect* is no longer where it was
 * laid out, so `box.top + scrollY` stops being its document position — but the
 * document position itself is as fixed as it ever was, and sticky's whole
 * definition is one clamp against it:
 *
 *     screen y = min(max(page y - scroll, pinTop), pinUntil - scroll)
 *
 * Three figures, all of them reflow-time, and one `min` of a `max` in the
 * frame — which is why this is written out rather than answered with a rect
 * per frame. A rect in the frame loop is a forced layout in every frame the
 * section is drawn in, on the hardware least able to afford one, and it is the
 * exact cost the arrangement above exists to avoid.
 *
 * The flow position it clamps has to come from somewhere the pin cannot reach,
 * so it comes from the block above the box — see {@link publishFaceFlow}.
 */

export type FaceSlot = {
  /** viewport x of the box's left edge; the page never scrolls sideways */
  left: number;
  /** the box's top edge in *document* coordinates, as laid out — before any pin */
  pageTop: number;
  width: number;
  height: number;
  /** the viewport y the box pins at, or null where it does not pin at all */
  pinTop: number | null;
  /**
   * The document y the pin is given up at — the foot of the box's containing
   * block, less the box's own height. It never binds as the layout stands, the
   * section running to the end of the page, and is here because sticky has two
   * ends and half of a clamp is the kind of thing that comes true later.
   */
  pinUntil: number;
};

const state: {
  el: HTMLElement | null;
  flow: HTMLElement | null;
  slot: FaceSlot | null;
} = {
  el: null,
  flow: null,
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
  if (box.width <= 0) {
    state.slot = null;
    return;
  }

  const style = getComputedStyle(el);
  const pinTop = style.position === "sticky" ? parseFloat(style.top) : NaN;

  // Where the box was *laid out*, which is what the clamp is written against.
  //
  // Its own rect cannot say: a box measured while it is pinned reports where
  // the pin is holding it, and adding the scroll to that gives a document
  // position that walks down the page as the reader scrolls. The block above
  // it is in ordinary flow and cannot pin, so its foot plus this box's own top
  // margin is the one figure here that is always the truth. Without an anchor
  // — nothing published, or a layout where the box does not pin — the box's
  // own rect is exactly right and is what gets used.
  const anchor = state.flow?.getBoundingClientRect();
  const pageTop =
    anchor && Number.isFinite(pinTop)
      ? anchor.bottom + window.scrollY + parseFloat(style.marginTop)
      : box.top + window.scrollY;

  // the containing block, and so the pin's far end: a sticky box is held
  // inside the parent it was laid out in
  const held = el.parentElement?.getBoundingClientRect();

  state.slot = {
    left: box.left,
    pageTop,
    width: box.width,
    height: box.height,
    pinTop: Number.isFinite(pinTop) ? pinTop : null,
    pinUntil: held
      ? held.bottom + window.scrollY - box.height
      : Number.POSITIVE_INFINITY,
  };
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

/**
 * Hands over the block the face's flow position is read off — the still half,
 * whose foot is where the box is laid out.
 *
 * A second ref rather than something walked to from the box itself
 * (`previousElementSibling`, `offsetTop`) because both of those are readings of
 * the layout that happen to work: the first goes wrong the day a marker is
 * added between them, and the second is a corner of the spec that browsers do
 * not have to agree on for sticky boxes. This is the block <AboutContent />
 * already holds a ref to, said out loud.
 */
export function publishFaceFlow(el: HTMLElement | null) {
  state.flow = el;
  measureFaceSlot();
}
