"use client";

/**
 * What the flight is doing this frame.
 *
 * <Scene /> works it out at priority 0.5 and <TunnelCards /> reads it at 0.6 —
 * the two are ordered so the cards are placed against the same camera the
 * composer is about to render with, and this is the only thing they have to
 * agree on. A module store rather than a prop for ./cardSlots' reason: there is
 * one Works section, the value changes sixty times a second, and routing it
 * through React would re-render both subtrees to move four numbers.
 */
export const flight = {
  /** distance along the spine */
  s: 0,
  /** section progress, clamped to 0..1 */
  progress: 0,
  /** 0 above the pool's surface, 1 under it */
  submersion: 0,
  /** whether the section is on screen and holding the camera */
  active: false,
};
