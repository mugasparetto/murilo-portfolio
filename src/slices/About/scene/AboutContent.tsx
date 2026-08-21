"use client";

import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { Content, KeyTextField } from "@prismicio/client";

import SolidIcon, { solidForRow } from "./SolidIcon";

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
 * lands on is exactly one viewport, so from `lg` up the blocks are placed
 * absolutely at the percentages the design puts them at. They're deliberately
 * *independent* blocks rather than one flow: they would otherwise push each
 * other around as the copy rewraps, and the skills list has to stay level with
 * the face regardless of how many lines the paragraph takes. The one pairing
 * is the skills list and the meta list, which share a row so the meta list can
 * sit at the foot of a list whose height the skill count decides.
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
 * The globe, traced from the design's vector (node 1390-552).
 *
 * Figma draws it as sixteen separate wedges rather than a disc with strokes cut
 * out of it, so the graticule is the gaps between them and the icon carries no
 * assumption about what colour sits behind it. They're disjoint, so the sixteen
 * subpaths merge into one `d` and fill as a single shape.
 */
function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12.45 0.02L12.45 7.167C14.257 7.126 15.986 6.837 17.538 6.319C16.546 2.791 14.652 0.32 12.45 0.02ZM12.45 23.98C14.652 23.68 16.546 21.209 17.538 17.681C15.986 17.163 14.257 16.874 12.45 16.833L12.45 23.98ZM21.818 5.092C20.892 5.813 19.809 6.414 18.611 6.883C18.949 8.316 19.142 9.888 19.175 11.551L24 11.551C23.909 9.155 23.115 6.932 21.818 5.092ZM21.269 19.633C20.433 18.982 19.466 18.427 18.387 17.994C17.695 20.411 16.596 22.362 15.238 23.564C17.634 22.893 19.729 21.502 21.269 19.633ZM12.45 15.927C14.327 15.969 16.13 16.269 17.761 16.804C18.069 15.462 18.25 13.992 18.283 12.449L12.45 12.449L12.45 15.927ZM21.269 4.368C19.729 2.499 17.634 1.107 15.238 0.432C16.596 1.638 17.695 3.59 18.387 6.006C19.466 5.574 20.433 5.018 21.269 4.368ZM12.45 11.551L18.283 11.551C18.25 10.008 18.069 8.538 17.761 7.196C16.13 7.731 14.327 8.032 12.45 8.073L12.45 11.551ZM24 12.449L19.175 12.449C19.142 14.112 18.949 15.684 18.611 17.117C19.809 17.586 20.892 18.187 21.818 18.908C23.115 17.068 23.909 14.845 24 12.449ZM8.757 23.564C7.403 22.358 6.304 20.411 5.612 17.994C4.533 18.427 3.562 18.982 2.726 19.633C4.27 21.502 6.365 22.893 8.757 23.564ZM2.182 18.908C3.108 18.187 4.191 17.586 5.385 17.117C5.051 15.684 4.854 14.112 4.825 12.449L0 12.449C0.086 14.845 0.881 17.064 2.182 18.908ZM11.546 12.449L5.717 12.449C5.746 13.992 5.931 15.462 6.236 16.804C7.866 16.269 9.669 15.969 11.546 15.927L11.546 12.449ZM0 11.551L4.825 11.551C4.854 9.888 5.051 8.316 5.385 6.883C4.191 6.414 3.108 5.813 2.182 5.092C0.881 6.936 0.086 9.155 0 11.551ZM6.464 6.319C8.02 6.837 9.749 7.126 11.552 7.167L11.552 0.02C9.354 0.32 7.46 2.791 6.464 6.319ZM11.552 23.98L11.552 16.833C9.749 16.874 8.02 17.163 6.464 17.681C7.46 21.209 9.354 23.68 11.552 23.98ZM11.546 8.073C9.669 8.032 7.866 7.731 6.236 7.196C5.931 8.538 5.746 10.008 5.717 11.551L11.546 11.551L11.546 8.073ZM8.757 0.432C6.365 1.107 4.27 2.499 2.726 4.368C3.562 5.018 4.533 5.574 5.612 6.006C6.304 3.59 7.403 1.638 8.757 0.432Z"
      />
    </svg>
  );
}

/** The three-faced pyramid, as the design's vector draws it (node 1390-574). */
function PrismIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M6.574 16.513L10.777 9.235L10.777 1.479L0 20.144L6.574 16.513ZM13.22 9.236L17.423 16.514L24 20.144L13.22 1.476L13.22 9.236ZM16.392 18.734L7.605 18.734L0.744 22.524L23.253 22.524L16.392 18.734Z"
      />
    </svg>
  );
}

/** The four-point sparkle, as the design's vector draws it (node 1390-573). */
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
      {/* the eyebrow labels the cards, so with no numbers to label it goes too
          rather than leaving a rule over nothing.

          It's placed on its own rather than wrapped around the list: sitting at
          the same 10.7% as "who i am", it reads as one line across the section
          with the block on the right, and the cards stay at the height the
          design puts them at instead of being pushed down by it. Stacked below
          `lg` both are static, so they fall into the column in source order. */}
      {numbers.length > 0 && (
        <div className="lg:absolute lg:top-[10.7%] lg:left-[3.9%] lg:w-[30%]">
          <Eyebrow as="h3">my stats</Eyebrow>
        </div>
      )}

      <ul
        // three across is what the design's count wants; a fourth card wraps
        // rather than squeezing the labels onto two lines
        className="grid grid-cols-3 gap-2 empty:hidden lg:absolute lg:top-[14.2%] lg:left-[3.9%] lg:block lg:w-[30%] lg:space-y-2"
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

      {/* — my skills, and where and when --------------------------------- */}
      {/* One row rather than two blocks placed independently: the meta list is
          set against the foot of the skills list, and that list is as tall as
          the skill count makes it, so the alignment has to come from a shared
          container rather than a percentage traced off the design's three
          rows. The row spans the stat cards' left edge to the skills list's
          right, which is what puts the meta list under the cards.

          Below `lg` the wrapper is just another item in the column and the two
          fall into it in source order, so the skills list still comes first. */}
      <div className="flex flex-col gap-5 sm:gap-6 lg:absolute lg:top-[56.1%] lg:right-[3.4%] lg:left-[3.9%] lg:flex-row lg:items-end lg:gap-0">
        {skills.length > 0 && (
          // the design's right-hand column, 64.8%–96.6% of the frame, as a
          // share of this row; `order` because it reads first in the DOM and
          // sits second across
          <div className="lg:order-2 lg:ml-auto lg:w-[34.3%]">
            <Eyebrow as="h3">my skills</Eyebrow>

            {/* the rows sit edge to edge in the design, so the dividers are
                one shared border rather than a gap. The list is narrower than
                the column the headline sets — 549 of its 607 — so it stops
                short of the paragraph's right edge exactly as the design has
                it. */}
            <ul className="mt-2.5 border border-white rounded-sm lg:mt-3.5 lg:w-[90.4%]">
              {skills.map(({ skill }, i) => (
                <li
                  key={i}
                  className="flex h-10 items-stretch border-t border-white first:rounded-t-sm last:rounded-b-sm bg-black/40 backdrop-blur-lg first:border-t-0 lg:h-12 xl:h-14 2xl:h-16"
                >
                  <span className="grid w-10 shrink-0 place-items-center border-r border-white text-white lg:w-12 xl:w-14 2xl:w-18">
                    {/* the hero's solids, a different one on each row and each
                        turning at its own rate — see <SolidIcon /> */}
                    <SolidIcon
                      kind={solidForRow(i)}
                      seed={i}
                      className="size-5 xl:size-7 2xl:size-9"
                    />
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

        {/* — where and when ---------------------------------------------- */}
        {/* flush left with the stat cards' column and flush with the foot of
            the skills list — the row's `items-end` does the second part */}
        <ul className="space-y-2 lg:order-1 lg:space-y-3">
          <li className="flex items-center gap-3.5">
            <GlobeIcon className={`${iconSize} text-white`} />
            <span className={metaText}>born in brazil / based in london</span>
          </li>
          <li className="flex items-center gap-3.5">
            <PrismIcon className={`${iconSize} text-white`} />
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
    </div>
  );
}
