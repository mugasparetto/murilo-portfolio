"use client";

import { useEffect, useState } from "react";

import { blockInset } from "./scene/Name";

/** how far the page has to move before the cue counts as heard, in px */
const DISMISS_AT = 40;

/** held back on first paint so it arrives after the name and headline */
const ENTER_DELAY = 1200;

/**
 * The "there's more below" hint in the hero's bottom-right corner.
 *
 * It's the counterweight to the rest of the fold: the headline and CTA hang
 * off the left edge of the name block, the nav sits bottom-centre at md and
 * bottom-left below it, and this takes the one corner left — right-aligned to
 * the same block inset the headline uses on the left, and the same height as
 * the nav, so the two read as one row.
 *
 * Plain DOM with no driver: unlike the name and headline it doesn't travel
 * with the camera. It leaves as soon as the reader starts scrolling and comes
 * back at the top, which a threshold toggle does with one write per crossing
 * — no per-frame work, and nothing for the About backdrop to clip.
 *
 * The motion is in globals.css, under `scroll-cue-drop`.
 */
export default function ScrollCue() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let ready = false;
    const update = () => setShown(ready && window.scrollY < DISMISS_AT);

    // a reload partway down the page keeps it hidden from the start, rather
    // than fading it in over the About section
    const timer = window.setTimeout(() => {
      ready = true;
      update();
    }, ENTER_DELAY);

    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div
      aria-hidden
      // bottom and height match <SiteNav />'s box at each tier — 40px at the
      // inset below md, the 50px pill 24px up from md — so the cue sits on the
      // nav's centre line
      className={`pointer-events-none fixed right-(--block-inset) bottom-(--block-inset) z-1 flex h-10 items-center gap-3 transition-[opacity,translate] duration-700 ease-out select-none md:right-(--block-inset-md) md:bottom-6 md:h-12.5 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
      style={blockInset}
    >
      {/* the terrain's grid runs right through this corner, so a soft black
          halo lifts the type off the wireframe without drawing a box */}
      <span className="text-[0.625rem] tracking-[0.2em] text-white/80 uppercase [text-shadow:0_0_10px_#000,0_0_10px_#000] md:text-xs">
        Scroll to explore
      </span>

      {/* a hairline track with a short bright segment falling through it */}
      <span className="relative block h-7 w-px overflow-hidden bg-white/25 shadow-[0_0_6px_2px_#000] md:h-7">
        <span className="scroll-cue-drop absolute inset-0 bg-linear-to-b from-transparent to-white" />
      </span>
    </div>
  );
}
