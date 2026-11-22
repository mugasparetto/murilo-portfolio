"use client";

import { useEffect, useMemo, useRef } from "react";

import { blockInset } from "@/slices/Hero/scene/Name";

import {
  HUD_WORD,
  LETTER_ARRIVE_VH,
  LETTER_STAGGER_VH,
  hudLayout,
  publishHudCursor,
  publishHudFill,
  publishHudStage,
  useHud,
} from "./hud";

/**
 * The Works section's title and instrument row.
 *
 * It arrives in the throat — the stretch between the About column leaving and
 * the first card coming out of the wall — and fills it. First the word alone,
 * big in the centre of the screen, its letters rising in one after another
 * with the About stats' overlapping count-off. Then the word shrinks away into
 * the bottom-right corner, and as it lands there the rest of the row draws out
 * of it: a rail with a tick for every card and a cursor for the flight, and a
 * counter of how many cards have been reached. Every part of that is scrubbed
 * by the scroll, so it plays backwards as readily as forwards.
 *
 * The corner is the one <ScrollCue /> holds in the hero — bottom-right, on the
 * nav's centre line, in the cue's type — which the cue has long since left. So
 * the page has one row of furniture along the bottom throughout.
 *
 * See ./HudDriver for the numbers the frame loop writes, and ./hud for where
 * along the flight each part happens.
 */

/** the cue's type: small tracked caps with a halo to lift them off the grid */
const TYPE =
  "text-[0.625rem] tracking-[0.2em] uppercase leading-none [text-shadow:0_0_10px_#000,0_0_10px_#000] md:text-xs";

/**
 * The word: Monument Extended caps, as the About cards set their headings.
 *
 * No halo, unlike the small type. Each letter is its own box with its own
 * transform, and so its own stacking context — a halo would be painted with
 * its letter, over the right-hand edge of the one before. White extrabold
 * holds against the grid without one at either size anyway.
 */
const WORD =
  "font-display font-extrabold uppercase leading-none whitespace-nowrap text-white";

/** space between letters, in em — see <Letters /> for why it isn't tracking */
const TRACK = 0.1;

/** the cue's ease, from its drip in globals.css */
const EASE = "ease-[cubic-bezier(0.65,0,0.35,1)]";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const pad = (n: number) => String(n).padStart(2, "0");

/** `x` clamped to 0..1, written for CSS */
const unit = (x: string) => `clamp(0, ${x}, 1)`;

/**
 * The glide, from the three numbers on the stage: --hud-k from the driver, and
 * --hud-dx/dy/small measured once per layout. The word is laid out in the
 * centre at its full size, so at k = 0 this is the identity — the big word is
 * the one drawn at its own size, never an enlargement — and at k = 1 it has
 * been carried onto its slot in the corner row and scaled down to fit it.
 */
const GLIDE =
  "translate(calc(var(--hud-k, 0) * var(--hud-dx, 0px)), calc(var(--hud-k, 0) * var(--hud-dy, 0px))) scale(calc(1 + (var(--hud-small, 1) - 1) * var(--hud-k, 0)))";

/**
 * The word, a box per letter.
 *
 * Arriving, each letter works its own progress out of the stage's --hud-v —
 * the scroll since the HUD appeared — offset by its place in the word, and
 * rises and fades in over it: the About stats' movement, one letter for one
 * box, with the same overlap between them.
 *
 * The space between them is a margin on all but the last rather than
 * `letter-spacing`, which would leave a trailing space after the S and pull
 * the word's centre a tenth of an em off the screen's. The slot in the corner
 * row uses the same boxes, unanimated, so the two measure alike.
 */
function Letters({ arriving }: { arriving: boolean }) {
  const letters = [...HUD_WORD];

  return letters.map((ch, i) => {
    const p = unit(
      `(var(--hud-v, -1) - ${i * LETTER_STAGGER_VH}) / ${LETTER_ARRIVE_VH}`,
    );

    return (
      <span
        key={i}
        aria-hidden
        className="inline-block"
        style={{
          marginRight: i < letters.length - 1 ? `${TRACK}em` : undefined,
          ...(arriving && {
            opacity: p,
            translate: `0 calc((1 - ${p}) * var(--hud-rise))`,
          }),
        }}
      >
        {ch}
      </span>
    );
  });
}

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

export default function WorksHud({ total }: { total: number }) {
  const on = useHud((s) => s.on);
  const index = useHud((s) => s.index);

  // one tick per card the path can show *and* Prismic has filled
  const ticks = useMemo(() => hudLayout().ticks.slice(0, total), [total]);
  const showing = ticks.length > 0;

  const stageRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLHeadingElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);

  /**
   * Where the glide goes: from the word's centre to its slot's, and from the
   * word's width to the slot's.
   *
   * Measured from layout boxes — `offset*` ignores transforms, so nothing the
   * glide does can feed back into what it reads — and only when the layout
   * changes: the window resizing, the font arriving, a breakpoint stepping the
   * row. The four boxes are all watched because any of them can be the one
   * that moved.
   */
  useEffect(() => {
    const stage = stageRef.current;
    const word = wordRef.current;
    const row = rowRef.current;
    const slot = slotRef.current;
    if (!showing || !stage || !word || !row || !slot) return;

    publishHudStage(stage);

    const fit = () => {
      // the word is the stage's child, the slot the row's, the row the stage's
      const wx = word.offsetLeft + word.offsetWidth / 2;
      const wy = word.offsetTop + word.offsetHeight / 2;
      const sx = row.offsetLeft + slot.offsetLeft + slot.offsetWidth / 2;
      const sy = row.offsetTop + slot.offsetTop + slot.offsetHeight / 2;
      const small = slot.offsetWidth / Math.max(1, word.offsetWidth);

      stage.style.setProperty("--hud-dx", `${(sx - wx).toFixed(1)}px`);
      stage.style.setProperty("--hud-dy", `${(sy - wy).toFixed(1)}px`);
      stage.style.setProperty("--hud-small", small.toFixed(4));
    };

    const observer = new ResizeObserver(fit);
    for (const el of [stage, word, row, slot]) observer.observe(el);
    fit();

    return () => {
      observer.disconnect();
      publishHudStage(null);
    };
  }, [showing]);

  if (!showing) return null;

  const shown = pad(index);

  // the rail draws out of the word as it lands, then the ticks and the count
  const railIn = unit("var(--hud-c, 0) / 0.6");
  const ticksIn = unit("(var(--hud-c, 0) - 0.35) / 0.4");
  const countIn = unit("(var(--hud-c, 0) - 0.45) / 0.55");

  return (
    // The stage: the whole screen, carrying the driver's numbers for
    // everything inside it to read. Its own fade is the one timed thing left —
    // for leaving at the pool, where the scroll has stopped meaning anything
    // the HUD could scrub.
    //
    // --hud-rise is how far a letter or the count climbs as it arrives, as a
    // share of its own height: dropped for reduced motion, which keeps the
    // fades. Same with the glide below — the word sits in its corner and the
    // centre is skipped.
    <div
      ref={stageRef}
      style={blockInset}
      className={`pointer-events-none fixed inset-0 z-20 transition-opacity duration-500 select-none [--hud-rise:40%] motion-reduce:[--hud-rise:0%] ${on ? "opacity-100" : "opacity-0"}`}
    >
      {/* The word, laid out at its full size in the centre of the screen and
          carried to the corner by the glide. The section's heading, too — it
          has no other. */}
      <h2
        ref={wordRef}
        className={`${WORD} absolute inset-0 m-auto h-fit w-fit origin-center text-[min(12vw,24vh)] motion-reduce:[--hud-k:1]`}
        style={{ transform: GLIDE }}
      >
        <span className="sr-only">Works</span>
        <Letters arriving />
      </h2>

      {/* The corner row. Right, bottom and height are <ScrollCue />'s, which
          are <SiteNav />'s: 40px at the inset below md, the 50px pill 24px up
          from md. */}
      <div
        ref={rowRef}
        className="absolute right-(--block-inset) bottom-(--block-inset) flex h-10 items-center gap-3 md:right-(--block-inset-md) md:bottom-6 md:h-12.5 md:gap-4"
      >
        {/* where the word lands: the same letters at the corner's size, held
            open and never shown */}
        <span
          ref={slotRef}
          aria-hidden
          className={`${WORD} invisible text-sm md:text-base`}
        >
          <Letters arriving={false} />
        </span>

        {/* the rail: the whole flight, a tick where each card is reached */}
        <div
          aria-hidden
          className="relative h-3 w-16 origin-left overflow-hidden sm:w-24 md:w-40 lg:w-48"
          style={{ scale: `${railIn} 1` }}
        >
          <div className="absolute inset-x-0 top-[5.5px] h-px bg-white/25" />

          <div
            ref={publishHudFill}
            className="absolute inset-x-0 top-[5.5px] h-px origin-left bg-white/70 will-change-transform"
            style={{ transform: "scaleX(0)" }}
          />

          {ticks.map((t, i) => (
            <div
              key={i}
              className={`absolute top-0.5 h-2 w-px transition-colors duration-300 ${index > i ? "bg-white" : "bg-white/35"}`}
              style={{ left: `${t * 100}%`, opacity: ticksIn }}
            />
          ))}

          {/* full width less its own, so at the end of the flight the cursor
              sits on the rail's last pixel rather than just past it */}
          <div
            ref={publishHudCursor}
            className="absolute inset-y-0 right-px left-0 will-change-transform"
          >
            <div className="absolute top-0 left-0 h-full w-px bg-white" />
          </div>
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
