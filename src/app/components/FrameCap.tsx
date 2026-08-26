"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Drives the R3F frameloop at a fixed rate instead of at the display's.
 *
 * The scene costs about the same to draw whatever the refresh rate is, so on a
 * fast panel the budget is what shrinks: 6.06ms at 165Hz against 16.7ms at 60.
 * Measured on the About section, a settled frame fits 165Hz with almost nothing
 * to spare, and the extra work a pointer move brings — the camera changes, so
 * the scene redraws against a new view matrix and the overlays tracking it
 * reproject — pushes roughly a third of frames past the deadline. A missed
 * deadline doesn't cost the overrun, it costs the whole next refresh: those
 * frames land at 12.1ms, and the result reads as stutter rather than as a lower
 * frame rate.
 *
 * Capping trades the peak for the floor. At 60 the budget is 16.7ms, which even
 * the slow frames fit inside, so every frame lands where the last one did.
 *
 * The cap quantises to whatever the display can actually hold: it renders on the
 * first refresh at or past the interval, so 60 becomes an exact 60 on a 60Hz
 * panel and a steady 55 (every third refresh) on this 165Hz one. Both are
 * even. Asking for a rate the panel can't divide into is what produces uneven
 * pacing, so the target is a ceiling rather than a promise.
 *
 * Pass `fps={0}` to drive every refresh — the same cadence as `frameloop
 * "always"`, since <Canvas /> is in `"never"` mode and something has to call
 * `advance` either way.
 *
 * ── Why a phone is never asked for more than 60 ────────────────────────────
 *
 * The quantising above assumes a display holding one rate. A ProMotion iPhone
 * does not: it varies its refresh between 10 and 120Hz on its own, and Safari
 * hands rAF out at whatever it has settled on. Run the test at 82 against that
 * and the answer flips on either side of the 9.76ms threshold — a panel at
 * 120Hz renders every second refresh for an even 60, and the same panel a
 * moment later at 100Hz passes *every* refresh and tries to draw this scene a
 * hundred times a second. It can't, so it drops frames, and the pacing that
 * came out even at one rate comes out ragged at the next. The rate never looks
 * bad; the spacing between frames does, which is the thing that reads as chop.
 *
 * 60 puts the threshold at 13.3ms, above every refresh interval a phone
 * actually varies through, so the cap resolves the same way whatever the panel
 * is doing — and 60 is the ceiling Safari will honour for most of them anyway.
 * The desktop cap is untouched: a 165Hz panel is a fixed rate, which is the
 * case the number was measured for.
 */
const TOUCH_FPS = 60;

export default function FrameCap({ fps = 60 }: { fps?: number }) {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    let raf = 0;
    let start = -1;
    let last = -Infinity;

    // Read here rather than in a prop: <FrameCap /> lives inside <Canvas />, so
    // it never renders on the server and there is no hydration to match.
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;

    const target = coarse && fps > TOUCH_FPS ? TOUCH_FPS : fps;

    const interval = target > 0 ? 1 / target : 0;
    // A refresh landing a shade early still counts. Without the slack a 60Hz
    // panel whose refreshes arrive a hair under 16.667ms would fail the test
    // every time, skip to the one after, and halve itself to 30.
    const slack = interval * 0.2;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      if (start < 0) start = now;
      // Seconds, not milliseconds. Under `frameloop="never"` R3F takes this
      // argument as the clock's elapsed time and derives the frame delta from
      // it — handing it the raw rAF timestamp would report deltas in the
      // thousands, which reads as an enormous frame to everything downstream.
      const t = (now - start) / 1000;

      if (interval && t - last < interval - slack) return;

      last = t;
      advance(t);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps]);

  return null;
}
