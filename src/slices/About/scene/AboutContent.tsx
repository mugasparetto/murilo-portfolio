"use client";

import { CSSProperties, ReactNode, useEffect, useId, useState } from "react";
import { Content, KeyTextField } from "@prismicio/client";

/**
 * The four fields the slice actually holds, taken one at a time rather than as
 * the whole slice — the same way <NameOverlay /> and <HeadlineOverlay /> take
 * theirs. This renders one composition, not a variation switch, so the props
 * are worth spelling out: they say exactly which of the slice's fields reach
 * the DOM. What isn't here — the eyebrows, the meta list under the cards — is
 * design rather than copy, and stays hard-coded below.
 *
 * The two groups keep their generated item types, so a field added in Slice
 * Machine turns up here rather than behind a cast.
 */
type Props = {
  title: KeyTextField;
  description: KeyTextField;
  numbers: Content.AboutSliceDefaultPrimary["numbers"];
  skills: Content.AboutSliceDefaultPrimary["skills"];
};

/**
 * The About section's copy, as laid out in Figma (node 1366-481).
 *
 * Everything here is HTML on <AboutOverlay />'s layer. The section's other
 * halves are already scene geometry and stay there: the giant "ABOUT" with its
 * stroked echoes is <Title />, the grid is <Lines />, the sliced face is
 * <Head />, and the bar along the bottom is <SiteNav />. What's left — the two
 * labelled blocks on the right, the stat cards on the left and the meta list
 * under them — is type, and type belongs in the DOM.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *
 * The Figma frame is a single 1906 × 947 desktop composition, and the layer it
 * lands on is exactly one viewport, so from `lg` up the four blocks are placed
 * absolutely at the percentages the design puts them at. They're deliberately
 * four *independent* blocks rather than one flow: the two right-hand ones would
 * otherwise push each other around as the copy rewraps, and the skills list has
 * to stay level with the face regardless of how many lines the paragraph takes.
 *
 * Below `lg` the same four blocks stack into a single column — the design has
 * no mobile frame, so that arrangement is an invention, not something traced.
 * The stat cards are the one block that changes shape rather than just size:
 * stacked number-over-label and three across, they cost ~80px instead of ~180,
 * which is what makes the whole column fit a phone without dropping anything.
 *
 * Sizes step at the breakpoints rather than scaling with the viewport, matching
 * <HeadlineOverlay />: nothing here reads the window, so the server renders what
 * the client hydrates and a resize costs no React work. The design's own numbers
 * are the `2xl` step.
 *
 * The one value that isn't in the design is the clock — see {@link useLocalTime}.
 */

/** Design fills: #FFFFFF for the display type, #E8E8E8 for the supporting copy. */
const MUTED = "text-[#E8E8E8]";

/** ls 1.4/14, 1.6/16 and 2.4/24 in the design — all of them 0.1em. */
const CAPS = "uppercase tracking-[0.1em]";

/** lh 40.9/28, 26.3/18, 64.2/44 … the whole composition is set at one ratio. */
const LEADING = "leading-[1.46]";

/**
 * Backing for the two blocks that are nothing but type.
 *
 * On the desktop composition they sit over black and need none — the design
 * gives them no background and they get none here. Stacked on a phone they land
 * squarely on the face, and white caps over the holographic bands are simply
 * not readable, so below `lg` they take the same translucent black the design
 * already puts behind the stat cards. The blur keeps the skin texture from
 * showing through the counters of the letters.
 */

/**
 * Each card is nudged right of the one above it, so they read as a stair
 * stepping down towards the face: 64px a step on a 1906 frame, against a
 * container that spans the leftmost card's left edge to the rightmost's right
 * edge.
 *
 * A step per index rather than a fixed set of three classes, because the group
 * is repeatable and the design's count isn't a promise. It goes through a
 * custom property so the offset can be computed from `i` and still only apply
 * from `lg` up — a plain inline `margin-left` has no breakpoint to hide behind,
 * and would stagger the stacked column too.
 */
const STAGGER_STEP = 11.2;

/** London, since the line above it says that's where the clock is. */
const TIME_ZONE = "Europe/London";

/**
 * The design shows a fixed "14:32:53", which only means anything if it's
 * actually the time — so it ticks.
 *
 * Null until the first client tick: the server has no business guessing a
 * clock, and rendering one would be a hydration mismatch on every load.
 */
function useLocalTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const tick = () => setTime(format.format(new Date()));

    tick();
    const id = setInterval(tick, 1000);

    return () => clearInterval(id);
  }, []);

  return time;
}

/** A rule and a label — the design's section markers. */
function Eyebrow({
  as: As = "p",
  children,
}: {
  as?: "p" | "h3";
  children: ReactNode;
}) {
  return (
    <As className="flex items-center gap-2.5 opacity-[0.72]">
      <span
        aria-hidden
        className="h-px w-6 shrink-0 bg-white xl:w-8 2xl:w-10"
      />
      <span
        className={`${CAPS} text-[0.6875rem] lg:text-xs xl:text-[0.8125rem] 2xl:text-sm`}
      >
        {children}
      </span>
    </As>
  );
}

/**
 * Wireframe icosahedron — the tile icon on every skill row.
 *
 * Drawn rather than exported: the design places a 72 × 64 crop of a reference
 * bitmap there, which at that size is already soft. These are the real solid's
 * 30 edges, projected down a face axis and with the 12 back ones culled, so it
 * stays crisp at any size and takes its colour from the row.
 */
function IcosahedronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6.33 8.72L17.67 8.72M6.33 8.72L12 18.55M6.33 8.72L12 1.4M6.33 8.72L2.82 17.3M6.33 8.72L2.82 6.7M17.67 8.72L12 18.55M17.67 8.72L12 1.4M17.67 8.72L21.18 17.3M17.67 8.72L21.18 6.7M12 18.55L2.82 17.3M12 18.55L21.18 17.3M12 18.55L12 22.6M12 1.4L2.82 6.7M12 1.4L21.18 6.7M2.82 17.3L2.82 6.7M2.82 17.3L12 22.6M21.18 17.3L21.18 6.7M21.18 17.3L12 22.6" />
    </svg>
  );
}

/**
 * Filled globe with the graticule cut out of it, as in the design.
 *
 * The lines are a mask rather than strokes painted in the page's black, so the
 * icon carries no assumption about what's behind it.
 */
function GlobeIcon({ className }: { className?: string }) {
  // React's generated ids carry delimiters that aren't valid in `url(#…)`
  const mask = `globe-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <mask id={mask}>
        <circle cx="12" cy="12" r="11" fill="#fff" />
        <g stroke="#000" strokeWidth="1.4" fill="none">
          <path d="M1 12h22M12 1v22M3.4 6.4h17.2M3.4 17.6h17.2" />
          <ellipse cx="12" cy="12" rx="5.2" ry="11" />
        </g>
      </mask>
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="currentColor"
        mask={`url(#${mask})`}
      />
    </svg>
  );
}

/** Three bonded nodes — the design's marker for the clock line. */
function NodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 4.2L3.6 18.2H20.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <circle cx="12" cy="4.2" r="3.4" />
        <circle cx="3.6" cy="18.2" r="3.4" />
        <circle cx="20.4" cy="18.2" r="3.4" />
      </g>
    </svg>
  );
}

/** The four-point sparkle, exactly as the design's vector draws it. */
function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M23.569 11.447L17.163 9.763C16.458 9.574 15.815 9.203 15.299 8.687C14.784 8.17 14.414 7.526 14.227 6.821L12.543 0.421C12.511 0.3 12.44 0.193 12.341 0.117C12.241 0.041 12.12 0 11.995 0C11.87 0 11.748 0.041 11.649 0.117C11.55 0.193 11.479 0.3 11.447 0.421L9.763 6.821C9.576 7.527 9.205 8.172 8.689 8.689C8.172 9.205 7.527 9.576 6.821 9.763L0.421 11.447C0.3 11.479 0.193 11.55 0.117 11.649C0.041 11.748 0 11.87 0 11.995C0 12.12 0.041 12.241 0.117 12.341C0.193 12.44 0.3 12.511 0.421 12.543L6.821 14.227C7.526 14.414 8.17 14.784 8.687 15.299C9.203 15.815 9.574 16.458 9.763 17.163L11.447 23.569C11.479 23.69 11.55 23.797 11.649 23.873C11.748 23.949 11.87 23.99 11.995 23.99C12.12 23.99 12.241 23.949 12.341 23.873C12.44 23.797 12.511 23.69 12.543 23.569L14.227 17.163C14.415 16.458 14.785 15.816 15.301 15.301C15.816 14.785 16.458 14.415 17.163 14.227L23.569 12.543C23.69 12.511 23.797 12.44 23.873 12.341C23.949 12.241 23.99 12.12 23.99 11.995C23.99 11.87 23.949 11.748 23.873 11.649C23.797 11.55 23.69 11.479 23.569 11.447Z"
      />
    </svg>
  );
}

export default function AboutContent({
  title,
  description,
  numbers,
  skills,
}: Props) {
  const time = useLocalTime();

  const iconSize = "size-4 shrink-0 xl:size-5 2xl:size-6";
  const metaText = `${CAPS} ${MUTED} text-[0.6875rem] lg:text-xs xl:text-[0.8125rem] 2xl:text-sm`;

  return (
    <div className="relative flex h-full w-full flex-col justify-center gap-5 px-(--block-inset) py-[6vh] sm:gap-6 lg:block lg:gap-0 lg:px-0 lg:py-0">
      {/* "ABOUT" itself is <Title /> in the scene, where no reader can get at
          it, so the section's heading lives here */}
      <h2 className="sr-only">About</h2>

      {/* — who i am ------------------------------------------------------ */}
      {/* the eyebrow is a marker for the copy under it, so with neither field
          filled the block goes rather than leaving a rule floating on its own */}
      {(title || description) && (
        <div
          className={`lg:absolute lg:top-[10.7%] lg:right-[3.4%] lg:left-[64.8%]`}
        >
          <Eyebrow>who i am</Eyebrow>

          {/* the design breaks this over three lines, but a Text field is one
              line in the editor, so the breaks are the column's to make — it's
              sized to wrap the copy the same way. `pre-line` is there for the
              author who does get a newline in. */}
          {title && (
            <p
              className={`font-display mt-1 font-extrabold text-white ${CAPS} ${LEADING} text-base tracking-normal whitespace-pre-line sm:text-lg lg:text-xl xl:text-2xl 2xl:text-[1.75rem]`}
            >
              {title}
            </p>
          )}

          {description && (
            <p
              className={`mt-3 ${CAPS} ${MUTED} ${LEADING} text-xs tracking-normal lg:text-sm lg:max-w-[93%] xl:mt-5 xl:text-base 2xl:mt-6 2xl:text-lg`}
            >
              {description}
            </p>
          )}
        </div>
      )}

      {/* — the numbers --------------------------------------------------- */}
      <ul
        // three across is what the design's count wants; a fourth card wraps
        // rather than squeezing the labels onto two lines
        className="grid grid-cols-3 gap-2 empty:hidden lg:absolute lg:top-[18.9%] lg:left-[3.9%] lg:block lg:w-[30%] lg:space-y-2"
      >
        {numbers.map(({ number, label }, i) => (
          <li
            // a group item carries no id of its own, and position is the only
            // thing that identifies a card here
            key={i}
            style={{ "--stagger": `${i * STAGGER_STEP}%` } as CSSProperties}
            // The height is fixed from `lg` up so the cards stay a set whatever
            // the longest label does; the gap and the type are sized to keep
            // that label on one line at the low end of each step, since the
            // design's own 64px gap only fits once the viewport is as wide as
            // the frame it was drawn on.
            className={`flex flex-col items-center rounded-sm border-2 border-white bg-black/40 backdrop-blur-lg px-2 py-2.5 text-center lg:ml-(--stagger) lg:h-16 lg:w-[77.6%] lg:flex-row lg:items-center lg:gap-8 lg:px-3 lg:py-0 lg:text-left xl:h-20 xl:gap-12 xl:px-4 2xl:h-24 2xl:gap-16 2xl:px-5 min-[112rem]:h-25 min-[112rem]:px-6`}
          >
            <span
              className={`font-display font-extrabold text-white ${LEADING} text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl min-[112rem]:text-[2.75rem]`}
            >
              {number}
            </span>
            <span
              className={`${CAPS} ${MUTED} ${LEADING} text-[0.5625rem] lg:text-[0.625rem] xl:text-[0.6875rem] 2xl:text-[0.8125rem] min-[112rem]:text-base`}
            >
              {label}
            </span>
          </li>
        ))}
      </ul>

      {/* — my skills ----------------------------------------------------- */}
      {/* the eyebrow labels the list, so with nothing to label the whole block
          goes rather than leaving a heading over an empty bordered box */}
      {skills.length > 0 && (
        <div
          className={`lg:absolute lg:top-[56.1%] lg:right-[3.4%] lg:left-[64.8%]`}
        >
          <Eyebrow as="h3">my skills</Eyebrow>

          {/* the rows sit edge to edge in the design, so the dividers are one
              shared border rather than a gap. The list is narrower than the
              column the headline sets — 549 of its 607 — so it stops short of
              the paragraph's right edge exactly as the design has it. */}
          <ul className="mt-2.5 border border-white rounded-sm lg:mt-3.5 lg:w-[90.4%]">
            {skills.map(({ skill }, i) => (
              <li
                key={i}
                className="flex h-10 items-stretch border-t border-white first:rounded-t-sm last:rounded-b-sm bg-black/40 backdrop-blur-lg first:border-t-0 lg:h-12 xl:h-14 2xl:h-16"
              >
                <span className="grid w-10 shrink-0 place-items-center border-r border-white text-white lg:w-12 xl:w-14 2xl:w-18">
                  <IcosahedronIcon className="size-5 xl:size-7 2xl:size-8" />
                </span>
                <span
                  className={`flex flex-1 items-center px-3 text-white ${CAPS} text-sm lg:px-4 lg:text-base xl:px-6 xl:text-xl 2xl:text-2xl`}
                >
                  {skill}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* — where and when ------------------------------------------------ */}
      <ul
        className={`space-y-2 lg:absolute lg:top-[75.5%] lg:left-[5.7%] lg:space-y-3`}
      >
        <li className="flex items-center gap-3.5">
          <GlobeIcon className={`${iconSize} text-white`} />
          <span className={metaText}>born in brazil / based in london</span>
        </li>
        <li className="flex items-center gap-3.5">
          <NodeIcon className={`${iconSize} text-white`} />
          <span className={metaText}>
            local time{" "}
            {/* the width is reserved so the row can't jog as the digits change */}
            <span className="inline-block min-w-[7ch] tabular-nums">
              {time ?? "--:--:--"}
            </span>
          </span>
        </li>
        <li className="flex items-center gap-3.5">
          <StarIcon className={`${iconSize} text-white`} />
          <span className={metaText}>since 1993</span>
        </li>
      </ul>
    </div>
  );
}
