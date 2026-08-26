"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { publishPacing } from "./diagFlags";

/**
 * Drives the R3F frameloop at a fixed fraction of the display's refresh rate
 * rather than at a wall-clock target.
 *
 * ── Why not a wall-clock target ────────────────────────────────────────────
 *
 * This used to hold a target interval and render on the first refresh at or
 * past it, less a 20% slack. That works, but only while nothing is competing
 * for the frame, and the way it fails is why this scene's frame rate has looked
 * like an intermittent, un-bisectable regression for so long.
 *
 * Measured on the 165Hz panel, with every <Diagnostics /> layer switched off
 * and a rAF burner adding a known, fixed cost to each frame:
 *
 *     extra work    reported fps    frame p95
 *       0 – 5ms         82.5          12.9ms
 *          6ms          80.5          14.0ms
 *          7ms          72.2          16.0ms
 *          8ms          69.1          17.9ms
 *         10ms          72.3          21.3ms
 *
 * Three things to read off that. The first five milliseconds are *free* — the
 * number does not move at all. The sixth costs ten frames a second. And ten
 * milliseconds of work reports a better frame rate than eight does, so the
 * figure is not even monotonic in the load: it is a threshold test against a
 * clock, and what it reports is which side of that threshold the rAF timestamps
 * happened to land on.
 *
 * That is a cliff with a flat approach to it, which is the shape that makes a
 * performance problem feel like it keeps coming back. Every fix buys back a
 * fraction of a millisecond, the number snaps to 82.5, and the next small
 * addition tips it over again — while the `js` bucket reads 0.4ms the whole way
 * down, because none of the work that tipped it is inside a `useFrame`. There
 * is nothing to bisect, because the scene was never what got slower.
 *
 * The 7ms row is the worst of it: 72fps is not a slower cadence, it is a *mix*
 * of two-refresh and three-refresh gaps — 12.1ms, 18.2ms, 12.1ms — and uneven
 * spacing is what reads as stutter. An even 55 looks better than a ragged 72.
 *
 * ── What this does instead ─────────────────────────────────────────────────
 *
 * Count refreshes, never milliseconds. `stride` is how many refreshes go by
 * between rendered frames, so the cadence is exactly even by construction and
 * there is no threshold for a timestamp to land either side of. 165Hz at a
 * stride of 2 is 82.5fps and stays 82.5fps; the only way to change the rate is
 * to change an integer.
 *
 * The stride follows the measured refresh and nothing else. It is deliberately
 * *not* a control loop over the frame's own cost, which is the second thing
 * this file tried and the second thing that had to come out. Raising the stride
 * helps exactly one kind of overrun — a frame that is waiting on the GPU or on
 * present — and it is useless against the other kind, a saturated main thread,
 * because a thread with no idle time left does not get any by being asked to
 * render less often. Measured against a synthetic 7ms-per-frame main-thread
 * load, the loop drove itself to its stride ceiling and reported 33fps where
 * the old wall-clock cap, for all its faults, still managed 72.
 *
 * So the cadence stays honest and predictable, and the judgement about what to
 * do when a frame is too expensive stays with the person reading the panel —
 * who has `slip` to tell them it is happening, and the bisect toggles to find
 * out where. A loop that quietly halves the frame rate on their behalf is how
 * a scene ends up slow for reasons nobody can see.
 *
 * ── Measuring the refresh, and the overrun ─────────────────────────────────
 *
 * The refresh interval is the *median* of the gaps between recent rAF
 * callbacks. It has to be a median and not a minimum, which is what this
 * reached for first and what made the first cut of this file unusable: a
 * browser will occasionally deliver two callbacks a fraction of a millisecond
 * apart, and a minimum latches onto that and never lets go. One 0.4ms gap and
 * the stride reads `round(12.195 / 0.4)` — thirty refreshes between frames.
 * Worse, every subsequent gap then looks long next to the bad estimate, so the
 * overrun counter saturates and drives the stride up on top of that. Measured,
 * it settled at a stride of 5 to 7 and 17–33fps.
 *
 * The median has neither failure. rAF fires once per refresh whether or not
 * this renders on it, so half the gaps being at or under the true interval is
 * exactly the property wanted, and it is unmoved by outliers at either end —
 * the short double-fire above, and the multi-second gap a backgrounded tab
 * comes back from. Gaps outside a plausible range are dropped before they ever
 * reach the window, and the stride itself is clamped, so no estimate however
 * wrong can strand the loop at a frame rate the display cannot explain.
 *
 * `slip` — reported, never acted on — is read from the render-to-render
 * interval: the frame slipped if that interval came out longer than the
 * `stride` refreshes it was given, plus half a refresh of tolerance. Measuring
 * the achieved cadence rather than the work is what makes it catch the whole
 * cost of a frame — style, layout, paint, compositing, the driver blocking on a
 * queued GPU frame — and not just the part inside an R3F callback, which is the
 * part that was never the problem.
 *
 * It is the number to watch, because it moves smoothly where `fps` steps. A
 * scene sitting at 82.5 with slip climbing through 20% is a scene one small
 * addition away from 55, and that is knowable *before* it happens rather than
 * after.
 *
 * ── Why a phone is still never asked for more than 60 ──────────────────────
 *
 * A ProMotion iPhone varies its refresh between 10 and 120Hz on its own and
 * hands rAF out at whatever it has settled on. Deriving the stride from the
 * live refresh estimate is the right answer there too — the panel slowing down
 * lowers the stride and the wall-clock rate holds — but the target itself still
 * wants to be 60, because that is the ceiling Safari will honour for most of
 * them, and asking for more only spends battery on frames nobody is shown.
 */
const TOUCH_FPS = 60;

/** Hard bounds on the stride, whatever the estimate says. */
const MIN_STRIDE = 1;
const MAX_STRIDE = 4;

/**
 * Gaps outside this are not refreshes and are kept out of the estimate: below
 * it, the browser double-firing a callback; above it, a backgrounded tab, a
 * blocked main thread, or a display that has stopped.
 */
const GAP_FLOOR = 2;
const GAP_CEIL = 200;

/** rAF gaps kept for the median — about a third of a second at 165Hz. */
const GAP_WINDOW = 60;

export default function FrameCap({ fps = 60 }: { fps?: number }) {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    let raf = 0;
    let start = -1;
    let prev = 0;

    // Read here rather than from a prop: <FrameCap /> lives inside <Canvas />,
    // so it never renders on the server and there is no hydration to match.
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;

    const target = coarse && fps > TOUCH_FPS ? TOUCH_FPS : fps;
    // `fps={0}` means every refresh, the cadence `frameloop="always"` would
    // give — <Canvas /> is in `"never"` mode and something has to call
    // `advance` either way.
    const targetInterval = target > 0 ? 1000 / target : 0;

    // Seeded at 60Hz and corrected once the window has filled. Seeding slow
    // rather than fast means the opening stride is 1 — every refresh — so the
    // frames before the estimate lands are paced too fast rather than too slow,
    // and a scene that has not warmed up is the one moment that costs nothing.
    let refresh = 1000 / 60;

    const gaps = new Float64Array(GAP_WINDOW);
    const sorted = new Float64Array(GAP_WINDOW);
    let gapAt = 0;
    let gapCount = 0;
    // recomputing the median every frame would sort 60 floats per refresh for a
    // number that moves only when the display does
    let sinceMedian = 0;

    let ticks = 0;
    let slip = 0;
    let lastRenderAt = -1;
    let renderStride = 1;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      if (start < 0) {
        start = now;
        prev = now;
        return;
      }

      const gap = now - prev;
      prev = now;

      if (gap >= GAP_FLOOR && gap <= GAP_CEIL) {
        gaps[gapAt] = gap;
        gapAt = (gapAt + 1) % GAP_WINDOW;
        if (gapCount < GAP_WINDOW) gapCount++;
      }

      if (gapCount >= 8 && ++sinceMedian >= 15) {
        sinceMedian = 0;
        const slice = sorted.subarray(0, gapCount);
        slice.set(gaps.subarray(0, gapCount));
        slice.sort();
        refresh = slice[gapCount >> 1];
      }

      // Refreshes between rendered frames. `round`, not `ceil`: at 165Hz a
      // target of 82 comes out at 2.01, and rounding up would answer 3 — an
      // even 55fps on a panel that holds an even 82.5 without complaint.
      const stride = targetInterval
        ? Math.min(
            MAX_STRIDE,
            Math.max(MIN_STRIDE, Math.round(targetInterval / refresh)),
          )
        : 1;

      if (++ticks < stride) return;
      ticks = 0;

      // Did the interval just completed come out at the cadence it was asked
      // for? Against `renderStride` refreshes, never one — a frame at a stride
      // of 3 has three refreshes to finish in, and a single late callback
      // inside that budget is not a miss.
      //
      // Rolling, so the panel shows the margin going *before* the rate steps
      // down. `js` stays flat while this climbs, which is the signature of cost
      // outside the callbacks — the thing the harness could not see.
      if (lastRenderAt >= 0) {
        const slipped =
          now - lastRenderAt > renderStride * refresh + refresh * 0.5;
        slip += ((slipped ? 1 : 0) - slip) * 0.05;
      }

      lastRenderAt = now;
      renderStride = stride;

      publishPacing(refresh, stride, slip);

      // Seconds, not milliseconds. Under `frameloop="never"` R3F takes this
      // argument as the clock's elapsed time and derives the frame delta from
      // it — handing it the raw rAF timestamp would report deltas in the
      // thousands, which reads as an enormous frame to everything downstream.
      advance((now - start) / 1000);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps]);

  return null;
}
