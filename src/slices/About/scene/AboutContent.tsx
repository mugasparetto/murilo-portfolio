"use client";

import {
  CSSProperties,
  ReactNode,
  Ref,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Content, KeyTextField } from "@prismicio/client";

import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

import SolidIcon, { solidForRow } from "./SolidIcon";

gsap.registerPlugin(useGSAP, SplitText);

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

/**
 * What every tween here hands back as it finishes: the transform it was
 * driving, removed outright.
 *
 * A tween that ends at `x: 0` does not end at *no* transform — it leaves
 * `translate(0px, 0px)` sitting inline, and that alone is enough to make the
 * element a containing block and take its whole subtree off the pixel grid the
 * rest of the page is snapped to. A 1px white hairline is exactly the thing
 * that can't survive that: the skills list is sized in percentages all the way
 * up, so its right border lands mid-pixel and gets drawn at partial coverage —
 * visibly fainter than the three edges that happen to fall on whole pixels, or
 * missing altogether. Type set over a leftover transform goes soft the same
 * way, for the same reason.
 *
 * Clearing it costs one write per element at the end of its tween and settles
 * the whole class of problem: at rest the section paints exactly as it would
 * with none of this on it, which is the only state worth guaranteeing.
 *
 * Transform only. The opacities stay — <Eyebrow /> is tweened to the 0.72 its
 * own class already carries, so clearing that would be a no-op with a flash of
 * 1 in the middle of it, and the elements the reveal fades to full are at the
 * value the stylesheet gives them anyway.
 */
const CLEAR = "transform";

/**
 * How the title's words arrive: up from a full line box below their place,
 * fading in, one after the next.
 *
 * Each word is masked — see the `mask` split below — so the rise is a word
 * climbing out from under a hard edge cut at its own box, not a word drifting
 * about in clear space. That's what makes the direction legible: the word is
 * visibly *entering* rather than merely settling.
 *
 * A share of the word's own height rather than a px figure, because that's
 * exactly what the mask is sized to: at 100 the word sits one full box below
 * the clip and is hidden completely, so it reveals from nothing at every
 * breakpoint the type steps through — where a fixed 16px would leave the tops
 * of the glyphs showing at the large end and overshoot at the small.
 *
 * The stagger is what makes it read word-by-word rather than as a block, and
 * it's short enough that a long title still finishes in about a second — the
 * whole reveal is `stagger × (words - 1) + duration`.
 */
const REVEAL_RISE = 100;
const REVEAL = {
  duration: 0.6,
  stagger: 0.06,
  ease: "power2.out",
  clearProps: CLEAR,
} as const;

/**
 * What the title hands off to, once its last word has landed: the eyebrow above
 * it drops into place and the paragraph below it rises, both fading in.
 *
 * The same distance with the sign flipped, so the two close on the title from
 * opposite sides and the block reads as gathering around it rather than as a
 * third and fourth thing arriving. They move together for the same reason.
 *
 * A px figure rather than the title's share of a line box: neither of these is
 * masked, so there's no clip edge for a percentage to be measured against — the
 * move is a short settle into place, not an entrance from out of sight, and it
 * wants to look the same size at every step the type takes.
 */
const COPY_SHIFT = 16;
const COPY = {
  duration: 0.5,
  ease: "power2.out",
  clearProps: CLEAR,
} as const;

/**
 * Where the eyebrow's fade stops — <Eyebrow /> is set at this in the markup,
 * and an inline `opacity: 1` left on it at the end of the tween would beat the
 * class and leave it brighter than the design has it. The one value that has to
 * be written twice: Tailwind reads its arbitrary values out of the class text,
 * so `opacity-[0.72]` can't be spelled from here.
 */
const EYEBROW_OPACITY = 0.72;

/**
 * The last beat: the two labelled blocks on either side of the section — the
 * skills list on the right, the stat cards on the left — arriving once the
 * copy around the title has settled.
 *
 * They come in from opposite sides, each *away* from the middle of the section
 * it sits at the edge of: the skills list slides left off its own right edge,
 * the cards right off their left. So the pair reads as the section filling in
 * from the outside rather than as two lists sliding the same way, and neither
 * crosses the face between them.
 *
 * The same 16px and the same {@link COPY} tween as the eyebrow and the
 * paragraph, because it's the same kind of move — a short settle into place,
 * not an entrance from out of sight — and the section should only ever be
 * doing one size of movement at a time.
 *
 * The skills block travels whole, eyebrow and rows together, since it's a
 * single labelled object arriving. The stat cards don't: they're a set of
 * three, and a set is worth counting off. Their eyebrow leads, taking the same
 * drop the "who i am" one takes, and the cards follow row by row.
 */
const BLOCK_SHIFT = 16;

/**
 * How the beat is spaced against the one before it.
 *
 * `BLOCK_LEAD` is measured from the *start* of the copy beat, so at 0.35
 * against a 0.5s tween the blocks pick up while the paragraph is on its last
 * fifth — clearly after it, still one continuous reveal rather than two
 * sequences with a pause between them.
 *
 * `ROW_LEAD` does the same job inside the stats: the cards start while their
 * eyebrow is still moving, which is what keeps the label and the set it labels
 * reading as one thing. `ROW_STAGGER` is short enough that three cards are
 * done well inside the tween's own half-second — it's a count-off, not a
 * queue.
 */
const BLOCK_LEAD = 0.35;
const ROW_LEAD = 0.35;
const ROW_STAGGER = 0.2;

/**
 * When it fires. The layer this sits on is exactly one viewport tall and is
 * slid up into place by <AboutOverlayDriver />, so "the section is visible" is
 * just the title's own box entering the viewport — an IntersectionObserver
 * reads the driver's transform for free, where a scroll position would have to
 * be re-derived from the camera.
 *
 * The bottom margin is the whole of the timing: it lifts the root's bottom
 * edge to the middle of the screen, so the section has to be most of the way
 * in before the title crosses it — rather than starting the moment the block
 * clears the bottom of the window, with nowhere yet to be seen rising into.
 *
 * Threshold stays at 0 deliberately. With the root cropped this hard, asking
 * for a *share* of the title to be inside it couples the timing to how many
 * lines the copy happens to take, and a title taller than what's left of the
 * root would never reach the ratio at all. At 0 it's the top edge crossing
 * that fires it, which is the same moment whatever the copy does.
 */
const REVEAL_ROOT_MARGIN = "0px 0px -75% 0px";
const REVEAL_THRESHOLD = 0;

/**
 * The elements the reveal writes to. An object rather than six positional
 * parameters: they are all `RefObject<HTMLElement | null>` at the call site,
 * so a list of them is a list of things that would swap silently.
 */
type RevealRefs = {
  title: RefObject<HTMLElement | null>;
  eyebrow: RefObject<HTMLElement | null>;
  description: RefObject<HTMLElement | null>;
  skills: RefObject<HTMLElement | null>;
  statsEyebrow: RefObject<HTMLElement | null>;
  stats: RefObject<HTMLElement | null>;
};

/**
 * Plays {@link REVEAL} over the words of `refs.title` the first time the
 * section comes into view, {@link COPY} over the two blocks around it as that
 * finishes, and {@link BLOCK_SHIFT} over the skills list and the stat cards
 * behind that — once, and only then: the observer is dropped as it fires, so
 * scrolling back up doesn't replay it.
 *
 * The split is made once, up front, and the words are parked at their start
 * pose right away: waiting for the trigger to split would flash the finished
 * title for a frame if the section were ever already on screen. Splitting into
 * words rather than lines is also what makes it safe to do before the display
 * face has swapped in — the masked words are inline-blocks and re-wrap on
 * their own, where a line split would be measured against the fallback and
 * stay that way.
 *
 * The copy is a dependency, so an edit in Prismic re-splits rather than
 * animating spans that no longer hold it, and so is the card count — see the
 * cards being read off the list below.
 *
 * The title is what the whole sequence hangs off — it carries the split, the
 * observer and the timeline everything else is hung on — so with no title
 * rendered there's nothing for the rest to follow and it all stays as typeset.
 */
function useCopyReveal(
  refs: RevealRefs,
  title: string,
  description: string,
  statCount: number,
) {
  useGSAP(
    () => {
      const el = refs.title.current;
      if (!el) return;

      // whoever asked not to see things move gets the title as typeset, with
      // nothing split, parked or observed — same bargain as <SolidIcon />
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // `mask` wraps each word in its own `overflow: clip` box — the hard edge
      // the words climb out from
      const split = SplitText.create(el, { type: "words", mask: "words" });
      gsap.set(split.words, { opacity: 0, yPercent: REVEAL_RISE });

      // parked the same way and for the same reason, each on its own side of
      // the title; the eyebrow is always there, the paragraph is a field
      const eyebrow = refs.eyebrow.current;
      const paragraph = refs.description.current;
      if (eyebrow) gsap.set(eyebrow, { opacity: 0, y: -COPY_SHIFT });
      if (paragraph) gsap.set(paragraph, { opacity: 0, y: COPY_SHIFT });

      // The last beat's targets, parked the same way. The skills block is
      // parked at the wrapper, so its eyebrow rides along inside it — the rule
      // keeps the 0.72 its class gives it instead of being tweened to it, and
      // the block arrives as one object.
      //
      // The cards are read off the list rather than collected through refs of
      // their own: they are a `map` over a repeatable group, so the DOM
      // already holds them in order and a ref array would only restate it.
      // `statCount` is a dependency for exactly this reason — a card added in
      // Prismic has to be picked up here, not left as the one row that never
      // moves.
      const skills = refs.skills.current;
      const statsEyebrow = refs.statsEyebrow.current;
      const cards = refs.stats.current
        ? Array.from(refs.stats.current.children)
        : [];

      if (skills) gsap.set(skills, { opacity: 0, x: BLOCK_SHIFT });
      if (statsEyebrow) gsap.set(statsEyebrow, { opacity: 0, y: -COPY_SHIFT });
      if (cards.length) gsap.set(cards, { opacity: 0, x: -BLOCK_SHIFT });

      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          io.disconnect();

          // a timeline rather than a delay, so the second beat starts where
          // the first actually ends — a moment that moves with the word count.
          // Two tweens off one label rather than one over both, because they
          // fade to different places; the label is what keeps them together.
          const tl = gsap.timeline();
          tl.to(split.words, { opacity: 1, yPercent: 0, ...REVEAL });
          tl.addLabel("settle");
          if (eyebrow) {
            tl.to(
              eyebrow,
              { opacity: EYEBROW_OPACITY, y: 0, ...COPY },
              "settle",
            );
          }
          if (paragraph) {
            tl.to(paragraph, { opacity: 1, y: 0, ...COPY }, "settle");
          }

          // one label for the whole last beat, offset from the copy's rather
          // than appended, so the three tweens hung off it stay related to
          // each other however many words the title happens to hold
          tl.addLabel("blocks", `settle+=${BLOCK_LEAD}`);
          if (skills) {
            tl.to(skills, { opacity: 1, x: 0, ...COPY }, "blocks");
          }
          if (statsEyebrow) {
            tl.to(
              statsEyebrow,
              { opacity: EYEBROW_OPACITY, y: 0, ...COPY },
              `blocks+=${ROW_LEAD}`,
            );
          }
          if (cards.length) {
            tl.to(
              cards,
              { opacity: 1, x: 0, ...COPY, stagger: ROW_STAGGER },
              `blocks+=${ROW_LEAD + 0.2}`,
            );
          }
        },
        { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN },
      );
      io.observe(el);

      return () => {
        io.disconnect();
        // puts the original text node back, taking the spans and everything
        // set on them with it
        split.revert();
      };
    },
    { dependencies: [title, description, statCount], scope: refs.title },
  );
}

/** A rule and a label — the design's section markers. */
function Eyebrow({
  as: As = "p",
  ref,
  children,
}: {
  as?: "p" | "h3";
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <As
      // `As` is a union, so TS wants a ref both elements accept; neither adds
      // anything to HTMLElement that this — a GSAP target — could want
      ref={ref as Ref<HTMLParagraphElement & HTMLHeadingElement>}
      // the 0.72 is {@link EYEBROW_OPACITY} — keep the two in step
      className="flex items-center gap-2.5 opacity-[0.72]"
    >
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

  const titleRef = useRef<HTMLParagraphElement>(null);
  const eyebrowRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const statsEyebrowRef = useRef<HTMLElement>(null);
  const statsRef = useRef<HTMLUListElement>(null);

  useCopyReveal(
    {
      title: titleRef,
      eyebrow: eyebrowRef,
      description: descriptionRef,
      skills: skillsRef,
      statsEyebrow: statsEyebrowRef,
      stats: statsRef,
    },
    title ?? "",
    description ?? "",
    numbers.length,
  );

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
          <Eyebrow ref={eyebrowRef}>who i am</Eyebrow>

          {/* the design breaks this over three lines, but a Text field is one
              line in the editor, so the breaks are the column's to make — it's
              sized to wrap the copy the same way. `pre-line` is there for the
              author who does get a newline in. */}
          {title && (
            <p
              ref={titleRef}
              className={`font-display mt-1 font-extrabold text-white ${CAPS} ${LEADING} text-base tracking-normal whitespace-pre-line sm:text-lg lg:text-xl xl:text-2xl 2xl:text-[1.75rem]`}
            >
              {title}
            </p>
          )}

          {description && (
            <p
              ref={descriptionRef}
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
          <Eyebrow as="h3" ref={statsEyebrowRef}>
            my stats
          </Eyebrow>
        </div>
      )}

      <ul
        ref={statsRef}
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
          <div ref={skillsRef} className="lg:order-2 lg:ml-auto lg:w-[34.3%]">
            <Eyebrow as="h3">my skills</Eyebrow>

            {/* the rows sit edge to edge in the design, so the dividers are
                one shared border rather than a gap. The list is narrower than
                the column the headline sets — 549 of its 607 — so it stops
                short of the paragraph's right edge exactly as the design has
                it.

                The frame is drawn by the rows rather than around them — each
                one carries its own left and right edge, the first the top and
                the last the bottom, which adds up to the same 1px box with the
                same shared dividers. The list itself is a bare `<ul>`: no
                border, no radius, nothing to clip against.

                That split is load-bearing, not style. Every row carries a
                backdrop-filter, and a backdrop-filter clipped by its *own*
                rounded box is the compositor's fast path — one blur, one
                rounded rect, done. Give it a rounded, clipping *ancestor*
                instead and the same blur needs a mask pass on a separate
                render surface, which the layer this sits on pays for on every
                frame it moves, since a backdrop-filter re-samples whenever it
                shifts against its backdrop. A wrapper border plus
                `overflow-clip` cost most of the section's frame budget for a
                hairline.

                It also settles the hairline at the source. A composited layer
                is snapped out to whole pixels before it's drawn, and this list
                is sized in percentages all the way up, so its box lands
                mid-pixel; a wrapper frame is something the rows can round
                themselves a fraction wider than and paint their blurred black
                over — which is how the right border went missing while the
                left, the top and the dividers stayed. Rows that carry their
                own edges snap with them, and have nothing left to escape. */}
            <ul className="mt-2.5 lg:mt-3.5 lg:w-[90.4%]">
              {skills.map(({ skill }, i) => (
                <li
                  key={i}
                  className="flex h-10 items-stretch border-x border-b border-white first:border-t first:rounded-t-sm last:rounded-b-sm bg-black/40 backdrop-blur-lg lg:h-12 xl:h-14 2xl:h-16"
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
