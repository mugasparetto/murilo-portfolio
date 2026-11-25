"use client";

import { useCallback, useMemo } from "react";
import { useLenis } from "lenis/react";

import { blockInset } from "@/slices/Hero/scene/Name";

import {
  HUD_WORD,
  hudLayout,
  publishHudCursor,
  publishHudFill,
  publishHudStage,
  useHud,
} from "./hud";
import { worksScrollY } from "./worksScroll";

/**
 * The Works section's instrument row, in the bottom-right corner.
 *
 * The section's name in the cue's type, then a rail with a tick for every card
 * and a cursor for the flight, and a counter of how many cards have been
 * reached. It draws in, left to right, as the first card starts coming out of
 * the wall — scrubbed by the scroll, so it plays backwards as readily as
 * forwards.
 *
 * The corner is the one <ScrollCue /> holds in the hero — bottom-right, on the
 * nav's centre line, in the cue's type — which the cue has long since left. So
 * the page has one row of furniture along the bottom throughout.
 *
 * Each tick is also a button. Clicking it flies the page to that card: a
 * scroll, so the tunnel plays through on the way exactly as if it had been
 * scrolled by hand.
 *
 * See ./HudDriver for the numbers the frame loop writes, and ./hud for where
 * along the flight each part happens.
 */

/** the cue's type: small tracked caps with a halo to lift them off the grid */
const TYPE =
  "text-[0.625rem] tracking-[0.2em] uppercase leading-none [text-shadow:0_0_10px_#000,0_0_10px_#000] md:text-xs";

/** the cue's ease, from its drip in globals.css */
const EASE = "ease-[cubic-bezier(0.65,0,0.35,1)]";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const pad = (n: number) => String(n).padStart(2, "0");

/** `x` clamped to 0..1, written for CSS */
const unit = (x: string) => `clamp(0, ${x}, 1)`;

/** the most a tick's hit area reaches either side of it */
const HIT_HALF = "16px";

/**
 * A fly-to's length in seconds. It grows with the distance, but by less and
 * less, so the next card over is a short hop and the far end of the tunnel is
 * not a long wait.
 */
const flyDuration = (screens: number) =>
  Math.min(2.4, 0.8 + 0.5 * Math.sqrt(screens));

/** ease in and out: pull away from where the page was, settle on the card */
const flyEase = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * One digit as a strip of all ten, rolled to the one showing — so the counter
 * turns over like an odometer, and back again when the scroll goes the other
 * way.
 */
function Digit({ value }: { value: number }) {
  return (
    <span className="inline-block h-[1em] overflow-hidden">
      <span
        className={`block transition-transform duration-500 motion-reduce:transition-none ${EASE}`}
        style={{ transform: `translateY(${-value}em)` }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1em]">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function WorksHud({ titles }: { titles: string[] }) {
  const on = useHud((s) => s.on);
  const index = useHud((s) => s.index);
  const lenis = useLenis();

  const total = titles.length;

  // One tick per card on the path, which is one per work — or as many as a
  // preset that cannot grow has room for. The rail stays the width it is, so
  // more works put the ticks closer together. `ticks` is when each card is
  // reached, as section progress; `marks` is where its tick sits, evenly
  // spaced along the rail.
  const { ticks, marks } = useMemo(() => hudLayout(total), [total]);

  // Through Lenis, not `window.scrollTo`, because Lenis owns the scroll: a
  // native scroll would be overwritten on its next frame. A wheel or a finger
  // during the flight takes over from it, as it does from any Lenis scroll.
  const flyTo = useCallback(
    (i: number) => {
      if (!lenis) return;

      // Onto the tick itself, so the cursor stops on the mark that was clicked.
      // A couple of pixels past it, because the tick is the exact moment the
      // count turns over, and a scroll rounded to the device pixel can stop
      // just short of it with the count one behind. Two pixels of a flight
      // thousands long is nothing on the rail.
      const y = Math.ceil(worksScrollY(ticks[i])) + 2;
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

      lenis.scrollTo(y, {
        duration: flyDuration(Math.abs(y - window.scrollY) / innerHeight),
        easing: flyEase,
        immediate: still,
      });
    },
    [lenis, ticks],
  );

  const showing = ticks.length > 0;

  if (!showing) return null;

  const shown = pad(index);

  // the word first, then the rail draws out of it, then the ticks and count
  const wordIn = unit("var(--hud-c, 0) / 0.4");
  const railIn = unit("(var(--hud-c, 0) - 0.2) / 0.5");
  const ticksIn = unit("(var(--hud-c, 0) - 0.35) / 0.4");
  const countIn = unit("(var(--hud-c, 0) - 0.45) / 0.55");

  return (
    // The stage: the whole screen, carrying the driver's numbers for
    // everything inside it to read. Its own fade is the one timed thing left —
    // for leaving at the pool, where the scroll has stopped meaning anything
    // the HUD could scrub.
    //
    // --hud-rise is how far the word or the count climbs as it arrives, as a
    // share of its own height: dropped for reduced motion, which keeps the
    // fades.
    //
    // Inert while hidden, so the tick buttons are neither clickable nor
    // focusable while there is nothing to see.
    <div
      ref={publishHudStage}
      inert={!on}
      style={blockInset}
      className={`pointer-events-none fixed inset-0 z-20 transition-opacity duration-500 select-none [--hud-rise:40%] motion-reduce:[--hud-rise:0%] ${on ? "opacity-100" : "opacity-0"}`}
    >
      {/* The corner row. Right, bottom and height are <ScrollCue />'s, which
          are <SiteNav />'s: 40px at the inset below md, the 50px pill 24px up
          from md. */}
      <div className="absolute right-(--block-inset) bottom-(--block-inset) flex h-10 items-center gap-3 md:right-(--block-inset-md) md:bottom-6 md:h-12.5 md:gap-4">
        {/* the section's heading in the DOM — the wall title is canvas */}
        <h2
          className={`${TYPE} text-white/80`}
          style={{
            opacity: wordIn,
            translate: `0 calc((1 - ${wordIn}) * var(--hud-rise))`,
          }}
        >
          {HUD_WORD}
        </h2>

        {/* the rail: the row's time on screen, with the cards evenly spaced
            along it and a tick where each one is reached */}
        <div
          className="relative h-3 w-16 origin-left sm:w-24 md:w-40 lg:w-48"
          style={{ scale: `${railIn} 1` }}
        >
          <div aria-hidden className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-x-0 top-[5.5px] h-px bg-white/25" />

            <div
              ref={publishHudFill}
              className="absolute inset-x-0 top-[5.5px] h-px origin-left bg-white/70 will-change-transform"
              style={{ transform: "scaleX(0)" }}
            />

            {/* full width less its own, so at the end of the flight the
                cursor sits on the rail's last pixel rather than just past it */}
            <div
              ref={publishHudCursor}
              className="absolute inset-y-0 right-px left-0 will-change-transform"
            >
              <div className="absolute top-0 left-0 h-full w-px bg-white" />
            </div>
          </div>

          {marks.map((t, i) => {
            // The hit area is centred on its tick, as tall as the row, and
            // reaches HIT_HALF either side, or halfway to a neighbouring tick
            // if that is nearer. Ticks close together share the gap between
            // them, without overlapping.
            const gaps = [
              i > 0 ? `${(t - marks[i - 1]) * 50}%` : null,
              i < marks.length - 1 ? `${(marks[i + 1] - t) * 50}%` : null,
            ].filter(Boolean);
            const half = `min(${[HIT_HALF, ...gaps].join(", ")})`;

            return (
              <button
                key={i}
                type="button"
                aria-label={`Go to ${titles[i]}`}
                onClick={() => flyTo(i)}
                className="group pointer-events-auto absolute top-1/2 h-10 -translate-y-1/2 cursor-pointer focus-visible:outline-1 focus-visible:outline-white/60 md:h-12.5"
                style={{
                  left: `calc(${t * 100}% - ${half})`,
                  width: `calc(2 * ${half})`,
                }}
              >
                <span
                  className={`absolute top-1/2 left-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 transition-[background-color,scale] duration-300 group-hover:scale-y-150 group-hover:bg-white group-focus-visible:scale-y-150 group-focus-visible:bg-white ${index > i ? "bg-white" : "bg-white/35"}`}
                  style={{ opacity: ticksIn }}
                />
              </button>
            );
          })}
        </div>

        <div
          aria-hidden
          className={`${TYPE} flex items-center tabular-nums`}
          style={{
            opacity: countIn,
            translate: `0 calc((1 - ${countIn}) * var(--hud-rise))`,
          }}
        >
          <span className="flex text-white">
            {[...shown].map((d, i) => (
              <Digit key={i} value={Number(d)} />
            ))}
          </span>
          <span className="text-white/45">/{pad(ticks.length)}</span>
        </div>
      </div>
    </div>
  );
}
