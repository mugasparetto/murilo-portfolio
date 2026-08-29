"use client";

import {
  CSSProperties,
  ReactNode,
  Ref,
  RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Content, KeyTextField } from "@prismicio/client";

import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

import SolidIcon, { solidForRow } from "./SolidIcon";
import { measureFaceSlot, publishFaceSlot } from "./faceSlot";
import {
  aboutOnScreen,
  aboutOnScreenOnServer,
  onAboutVisibility,
} from "./aboutVisibility";

gsap.registerPlugin(useGSAP, SplitText);

/**
 * The four fields the slice actually holds, taken one at a time rather than as
 * the whole slice — the same way <NameOverlay /> and <HeadlineOverlay /> take
 * theirs. This renders one composition, not a variation switch, so the props
 * are worth spelling out: they say exactly which of the slice's fields reach
 * the DOM. What isn't here — the eyebrow, the meta list top left — is design
 * rather than copy, and stays hard-coded below.
 *
 * The two groups keep their generated item types, so a field added in Slice
 * Machine turns up here rather than behind a cast.
 */
type Props = {
  /**
   * The section, watched for reflows so the face's box can be re-measured —
   * see ./faceSlot. Handed in rather than found by walking up from a ref here,
   * so the relationship is something the call site states rather than something
   * this file assumes about markup it doesn't own.
   *
   * Only ever read from a passive effect. It is a ref to this component's own
   * *parent*, so it is still null during layout — see
   * {@link REVEAL_ROOT_MARGIN} for the bug that costs.
   */
  sectionRef: RefObject<HTMLElement | null>;
  title: KeyTextField;
  description: KeyTextField;
  numbers: Content.AboutSliceDefaultPrimary["numbers"];
  skills: Content.AboutSliceDefaultPrimary["skills"];
};

/**
 * The About section's copy, as laid out in Figma (nodes 1423-1098 and
 * 1421-917 — the section's first and last state).
 *
 * Everything here is ordinary HTML in the section, painting over the canvas.
 * The section's other halves are scene geometry and stay there: the giant
 * "ABOUT" with its
 * stroked echoes is <Title />, the grid is <Lines />, the sliced face is
 * <Head />, and the bar along the bottom is <SiteNav />.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *
 * The Figma frames are single 1906 × 947 desktop compositions, and from `lg` up
 * the still half of this one is a `sticky top-0 h-screen` box — exactly one
 * viewport — so the blocks inside it are placed absolutely at the percentages
 * the design puts them at. They're deliberately *independent* blocks rather
 * than one flow: they would otherwise push each other around as the copy
 * rewraps.
 *
 * Two columns either side of the face:
 *
 * - left, pinned to the top: the meta list — where he is, what time it is
 *   there, how long he has been at it;
 * - left, pinned to the bottom: "who i am", the headline and the paragraph
 *   under it. Set against the foot of the screen rather than flowing down from
 *   the meta list, so the two ends of the column stay put however many lines
 *   the headline takes;
 * - right: the skill cards, which stack as the section is scrolled, and the
 *   stats that arrive once the last of them has landed.
 *
 * The pile is the one part of this that moves with the scroll, and it moves
 * entirely in CSS — no intro tween touches it. Each card is `position: sticky`
 * at its own slot, with a
 * beat's worth of flow under it. There is no frame loop and nothing to keep in
 * step — see {@link SkillCard}, and {@link cardFlowVh} for the arithmetic.
 *
 * The one thing sticky can't say is *when* — the stats have to wait for the
 * pile to finish rather than for a distance, so the last card locking into
 * place is what brings them in. See {@link statsRootMargin}.
 *
 * Below `lg` the blocks stack into a single column: the meta list, the copy,
 * the face, then the cards and the stats. The cards are ordinary items in that
 * column there — open, in flow, one after the next — because the stack is a
 * pinned-section effect and below `lg` the section isn't pinned. The mobile
 * composition hasn't been drawn yet; this is the desktop one folded into a
 * column so the section reads on a phone, not a design.
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

/** ls 1.4/14, 1.6/16 and 2/20 in the design — all of them 0.1em. */
const CAPS = "uppercase tracking-[0.1em]";

/** lh 40.9/28, 26.3/18, 64.2/44 … the whole composition is set at one ratio. */
const LEADING = "leading-[1.46]";

/**
 * The translucent black behind the skill cards and the stat boxes.
 *
 * ── No backdrop-filter here, and it must not come back ────────────────────
 *
 * The design draws these as frosted glass, and they were `backdrop-blur-lg`
 * until it turned out to be most of the section's frame budget. The reason is
 * structural rather than a matter of degree: this layer is DOM over a canvas
 * that fills the viewport, so a backdrop-filter's backdrop *is* the scene. A
 * backdrop-filter is a draw-time compositor operation with no cross-frame
 * cache — if a frame is produced and the element is in it, the filter runs.
 * Whether the element moved is irrelevant, and so is the fact that the pile is
 * now pinned by the compositor rather than driven from JavaScript — a sticky
 * card that has not moved in a hundred frames still has its backdrop resampled
 * in every one of them. And a frame is always produced:
 * <Postprocessing /> ends on `<Noise />`, which reseeds every pixel on the
 * canvas every frame, for ever, even with the camera at rest.
 *
 * Each element re-samples its own box grown by three sigma on every side —
 * `blur(16px)` is sigma, not a radius, so that's ±48px — and at the browser's
 * device scale factor, which `dpr={[1, 1.5]}` doesn't clamp: that only sizes
 * the WebGL drawing buffer. Which is also why the harness's `5` can't shift
 * this cost, and why it lands in `other` rather than `js` or `gpu` — see
 * <Diagnostics />.
 *
 * NB the cards this now backs are a great deal larger than the skill *rows*
 * they replace — four boxes of roughly 623 × 235 design px rather than seven
 * strips — and they sit on top of one another, so most of that area is sampled
 * several times over. If the section's frame budget goes, this is the first
 * thing to try.
 *
 * Opacity does the legible half of the job on its own, which is the half that
 * matters. From `lg` up the cards sit at the right edge over the black backdrop
 * plane, a grid that fades to 0.1 out there and the vignette's darkest band —
 * blurring near-black returns near-black, so the design's own 40% stands and
 * nothing visible changed.
 */
const PLATE = "bg-black/40 backdrop-blur-lg";

/** The stat boxes are drawn lighter and heavier than the cards: 20% and 2px. */
const STAT_PLATE = "bg-black/20 backdrop-blur-lg";

/* --------------------------------------------------------------------------
   The pile's arithmetic

   Traced off the Figma frames and kept in `vh`, which from `lg` up is exact
   rather than convenient: the still box is `h-screen` and the card column spans
   the section, so a share of the design's 947 is a share of the viewport.

   All of it feeds `position: sticky`. Nothing here runs per frame — the cards
   are pinned by the compositor, and these numbers only say where and when.
   -------------------------------------------------------------------------- */

/** The first card's top and a card's height: 191 and 235 of 947. */
const CARD_TOP_VH = 20.2;
const CARD_HEIGHT_VH = 24.8;

/**
 * The step between two cards, 58 of 947 — and also the height of a card's
 * header row, which is the whole illusion: a card covers everything of the one
 * behind it *except* its header, because it starts exactly where that card's
 * body does. Change one and change the other.
 */
const CARD_STEP_VH = 6.1;

/** Where the stats pin: 698 of 947, with the design's 135 of height under it. */
const STATS_TOP_VH = 73.7;

/**
 * How much scroll the copy gets to itself after the section lands, before the
 * first card's top edge crosses the fold.
 *
 * The knob to turn if the pile starts too early or too late — everything after
 * it shifts along, including the section's own height. At 0 the first card
 * would be rising as the headline was still settling.
 */
const INTRO_HOLD_VH = 25;

/** One card's arrival: the scroll from one card locking to the next. */
const BEAT_VH = 45;

/**
 * Scroll between the last card locking and the bottom of the page.
 *
 * Two jobs, and the second is the one that sets the figure. It is the pause on
 * the finished picture — but it is also, read backwards, exactly how far the
 * reader has to scroll *up* from the end before the stats begin to leave. Card
 * four is pinned for the whole of it, so nothing moves, so the observer
 * watching it has nothing to report: the stats simply hang there. At twenty
 * that was a fifth of a screen of pulling away with no response.
 *
 * Small, then, and not zero — the last card would otherwise be locking at the
 * very instant the page ran out of scroll, which is the same zero-slack bargain
 * that cost the pile its pinning once already.
 *
 * Only this much is needed anyway, because a section's last viewport is
 * unreachable: scrolled to the very bottom, the fold sits on the section's own
 * end. {@link sectionVh} adds that screen on top. The reader still rests on the
 * finished composition for as long as they like — they just cannot scroll
 * through it.
 */
const REST_VH = 1;

/** Binary floating point turns `20.2 + 6.1` into `26.299999999999997`. */
const vh = (n: number) => Math.round(n * 100) / 100;

/** Where card `i` pins. */
const cardSlotVh = (i: number) => vh(CARD_TOP_VH + i * CARD_STEP_VH);

/**
 * Where card `i` sits in the column's flow — the number that decides when it
 * arrives, and the whole of the stacking logic.
 *
 * The first card starts a screen and a hold below the section's top edge, so it
 * rises into place rather than being there already. Each one after it is a beat
 * *plus a step* further down: every card pins one {@link CARD_STEP_VH} lower
 * than the last, and a card with further to fall needs that much more runway to
 * still land on its own beat.
 *
 * One rule for every card, the first included. It used to sit at flow 0, which
 * put it already past its own `top` when the section landed — so it was simply
 * there, and being there is not an entrance, so it had to be given a fade to
 * arrive on. The cards do not animate in; they scroll in.
 */
const cardFlowVh = (i: number) =>
  vh(100 + INTRO_HOLD_VH + i * (BEAT_VH + CARD_STEP_VH));

/** The scroll, measured from the section's top edge, at which card `i` pins. */
const cardLockVh = (i: number) => vh(cardFlowVh(i) - cardSlotVh(i));

/**
 * The section's own height, for <About /> to set on it.
 *
 * The section is pinned from `lg` up, so its height measures nothing about its
 * content — it is purely how much wheel the pile gets, which is why it has to
 * come off the card count. Typed as a class, a fifth skill would get the same
 * height four of them share and every beat would shorten to make room.
 *
 * The extra screen is not slack: the bottom of the page puts the fold on the
 * section's own end, so the last 100vh of any section can never be scrolled
 * *through*. Without it the final card would never reach its slot.
 */
export const sectionVh = (count: number) =>
  vh(cardLockVh(Math.max(1, count) - 1) + 100 + REST_VH);

/**
 * What the card list's height has to satisfy, as an assertion rather than a
 * formula — see the `lg:h-full` in the markup.
 *
 * A sticky box is clamped to its containing block. Give the list no more room
 * than its cards happen to occupy and the pinned ones have nowhere to be held,
 * so they are dragged up together as the list's bottom edge rises past them:
 * the pile appears to stop stacking and start shoving, one card every
 * {@link CARD_STEP_VH} of scroll, bottom card first.
 *
 * The list is given the column's whole height instead of a computed run-out.
 * That was worth doing for the slack alone — the computed figure was an exact
 * fit, so the bottom card reached its clamp at the same scroll as the page
 * reached its end, and anything that made the page a shade taller than
 * expected walked the pile off one card at a time. But it is also the better
 * rule: at full height a card's room runs out only if
 *
 *     cardSlotVh(count - 1) + CARD_HEIGHT_VH > 100
 *
 * which says the finished pile is taller than the screen — a thing the design
 * has to answer for long before the arithmetic does. Four cards sit at 63.3vh
 * with 36.7vh to spare; it breaks at seven, which is also where the last card
 * would be growing through the stats.
 */
const stackFitsVh = (count: number) =>
  vh(cardSlotVh(Math.max(1, count) - 1) + CARD_HEIGHT_VH);

/**
 * The gap under card `i`, which is what sticky reads to space the arrivals.
 *
 * Uniform, and none under the last — holding the finished pile is the list's
 * own height, not trailing space inside it. See {@link stackFitsVh}.
 */
const cardGapVh = (i: number, count: number) =>
  i === count - 1 ? 0 : vh(cardFlowVh(i + 1) - cardFlowVh(i) - CARD_HEIGHT_VH);

/**
 * The crop that fires the stats: the top of the screen down to just past where
 * the last card comes to rest.
 *
 * The stats wait on the pile finishing rather than on a distance, and the last
 * card locking *is* the pile finishing — so the last card is the thing to
 * watch, and the moment its top edge reaches its own slot is the moment to
 * fire. A degree of slack above the slot so the crossing is unambiguous.
 *
 * This used to be an empty cue box placed a viewport below the lock, which
 * worked but bought a hidden constraint: an element only crosses the fold if
 * the page can be scrolled far enough to push it there, and the last screen of
 * a section cannot. Watching a card that is already on screen needs no runway
 * at all.
 */
const STATS_CUE_SLACK_VH = 1;
const statsRootMargin = (count: number) =>
  `0px 0px -${vh(100 - cardSlotVh(count - 1) - STATS_CUE_SLACK_VH)}% 0px`;

/** London, since the line above it says that's where the clock is. */
const TIME_ZONE = "Europe/London";

/**
 * Built once. The section crosses on and off screen many times a page, and the
 * effect below now runs on every crossing — rebuilding a formatter each time
 * would be work for nothing.
 */
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * The design shows a fixed "14:32:53", which only means anything if it's
 * actually the time — so it ticks.
 *
 * Null until the first client tick: the server has no business guessing a
 * clock, and rendering one would be a hydration mismatch on every load. The
 * store's server snapshot is `false` for the same reason, so SSR and the first
 * client render agree on the placeholder.
 *
 * Only while the section is on screen. A second's drift on a clock nobody is
 * looking at is not drift, and `tick` runs again on the way back in, so the
 * first frame of the section is already right.
 */
function useLocalTime() {
  const [time, setTime] = useState<string | null>(null);

  const onScreen = useSyncExternalStore(
    onAboutVisibility,
    aboutOnScreen,
    aboutOnScreenOnServer,
  );

  useEffect(() => {
    if (!onScreen) return;

    const tick = () => setTime(TIME_FORMAT.format(new Date()));

    tick();
    const id = setInterval(tick, 1000);

    return () => clearInterval(id);
  }, [onScreen]);

  return time;
}

/**
 * The clock, on its own so that its tick re-renders a text node rather than the
 * section.
 *
 * <AboutContent /> holds four cards, three stat boxes, four turning solids and
 * three inline icons, none of which have anything to say about the time — and
 * every one of them was being reconciled once a second, for ever, to change
 * eight characters. Held down here, the rest of the tree re-renders only when
 * the copy changes, which at runtime is never.
 */
function LocalTime() {
  const time = useLocalTime();

  return (
    // the width is reserved so the row can't jog as the digits change
    <span className="inline-block min-w-[7ch] tabular-nums">
      {time ?? "--:--:--"}
    </span>
  );
}

/**
 * What every tween here hands back as it finishes: the transform it was
 * driving, removed outright.
 *
 * A tween that ends at `x: 0` does not end at *no* transform — it leaves
 * `translate(0px, 0px)` sitting inline, and that alone is enough to make the
 * element a containing block and take its whole subtree off the pixel grid the
 * rest of the page is snapped to. A 1px white hairline is exactly the thing
 * that can't survive that: the cards are sized in percentages all the way up,
 * so their borders land mid-pixel and get drawn at partial coverage — visibly
 * fainter than the edges that happen to fall on whole pixels, or missing
 * altogether. Type set over a leftover transform goes soft the same way, for
 * the same reason.
 *
 * Clearing it costs one write per element at the end of its tween and settles
 * the whole class of problem: at rest the section paints exactly as it would
 * with none of this on it, which is the only state worth guaranteeing.
 *
 * It is also why nothing in this hook is allowed to tween a *card*: those carry
 * the stack driver's transform, and two writers on one property is a fight
 * neither wins. The intro moves the wrapper around them instead — see the
 * parking in {@link useCopyReveal}.
 *
 * Transform only. The opacities stay — <Eyebrow /> is tweened to the 0.72 its
 * own class already carries, so clearing that would be a no-op with a flash of
 * 1 in the middle of it, and the elements the reveal fades to full are at the
 * value the stylesheet gives them anyway.
 */
const CLEAR = "transform";

/**
 * How the headline's words arrive: up from a full line box below their place,
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
 * it's short enough that a long headline still finishes in about a second — the
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
 * What the headline hands off to, once its last word has landed: the eyebrow
 * above it drops into place and the paragraph below it rises, both fading in.
 *
 * The same distance with the sign flipped, so the two close on the headline
 * from opposite sides and the block reads as gathering around it rather than as
 * a third and fourth thing arriving. They move together for the same reason.
 *
 * A px figure rather than the headline's share of a line box: neither of these
 * is masked, so there's no clip edge for a percentage to be measured against —
 * the move is a short settle into place, not an entrance from out of sight, and
 * it wants to look the same size at every step the type takes.
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
 * From `lg` up the intro doesn't touch the card column at all — the cards do not
 * animate in, they scroll in.
 *
 * Every card now starts below the fold and rises into its slot on the scroll
 * (see {@link cardFlowVh}), which is an entrance already. Fading the box they
 * sit in on top of that would be the section doing two things at once, and the
 * fade would be the one nobody asked for. It also spares a transform on an
 * ancestor of a sticky element, which is a coordinate system its offsets then
 * resolve against.
 *
 * Below `lg` the column still fades in with everything else: there is no sticky
 * there, no pile, and nothing else to make the cards feel like they arrived.
 *
 * The stats keep a settle on both sides. Theirs is one pinned box that holds
 * its place for the whole section rather than a pile moving through it, so
 * there is nothing for a transform to disturb — and they are the one block that
 * has to announce itself rather than simply having been there.
 *
 * From `lg` up it is also the distance they leave on: the beat is reversed
 * rather than rewritten, so out is in backwards and the two cannot drift.
 */
const STATS_SHIFT = 16;

/**
 * How the beats are spaced against one another.
 *
 * `META_LEAD` sets the top-left block off against the copy at the foot of the
 * same column, so the two ends of it don't arrive together.
 *
 * `ROW_STAGGER` is the count-off inside the meta list, short enough that three
 * rows are done well inside the tween's own half-second.
 */
const META_LEAD = 0.15;
const ROW_STAGGER = 0.12;

/**
 * When it fires.
 *
 * Two different questions on the two sides of `lg`, because the section is two
 * different shapes there.
 *
 * -- From `lg` up: the pinned box's top edge -------------------------------
 *
 * The still half of the composition is a `sticky top-0 h-screen` box, so once
 * the section lands nothing in it moves again for the whole 350vh. That makes
 * "has the headline scrolled far enough" the wrong question -- the honest one
 * is "has the composition arrived", and the box it all sits in is what to ask.
 *
 * A bottom margin of -95% crops the root to the top 5vh of the screen. The box
 * starts at the section's own top edge and is a full viewport tall, so it
 * enters that band the moment the section does and stays in it from then on —
 * the observer fires within 5vh of the section reaching the top of the screen,
 * which is also, and not by coincidence, where the camera flight from the hero
 * ends. The copy arrives over a scene that has just come to rest.
 *
 * It has to be the box and not the <section> itself, even though the two cross
 * at the same moment, and the reason is a timing trap rather than a geometric
 * one: this hook runs on `useGSAP`, which is a *layout* effect, and React
 * attaches host refs bottom-up — every child finishes before a parent element's
 * ref is set. <AboutContent /> is a child of the section, so a ref to the
 * section is still null here on the mount that matters, and a `if (section)`
 * guard around it fails silently and permanently. The pinned box is inside this
 * component, so its ref is attached before this runs. The old overlay took a
 * section ref too and got away with it only because it read the ref from a
 * passive `useEffect`, which runs after the whole commit.
 *
 * -- Why not the headline, ever again --------------------------------------
 *
 * This used to watch the headline through a -65% crop, and that combination
 * failed silently and completely the moment the design moved the headline to
 * the foot of the column: a pinned box never travels, so an element resting at
 * 58vh inside it is at 58vh for ever, a root cropped to the top 35vh never
 * contains it, the observer never fires, and every block hanging off it stays
 * at `opacity: 0` with nothing at all to say it should have moved.
 *
 * The section cannot fail that way. It is taller than the viewport in every
 * layout, so it crosses every band there is, wherever the blocks inside it are
 * placed and however the copy rewraps.
 *
 * -- Below `lg`: ordinary page content -------------------------------------
 *
 * The section is a plain column there, taller than the screen, scrolling at
 * page pace, and each block takes its own trigger as it clears the fold. A
 * fifth of the viewport is the ordinary "clear the fold by about a line"
 * figure: the words rise where the reader is already looking, with the whole
 * screen below them left for the beats hung behind.
 *
 * Threshold stays at 0 on both. With the root cropped at all, asking for a
 * *share* of a block to be inside it couples the timing to how tall that block
 * happens to be, and a block taller than what is left of the root would never
 * reach the ratio at all. At 0 it is the leading edge crossing that fires it,
 * which is the same moment whatever the copy does.
 */
const REVEAL_ROOT_MARGIN = {
  base: "0px 0px -20% 0px",
  lg: "0px 0px -95% 0px",
} as const;
const REVEAL_THRESHOLD = 0;

/** `lg`, as BREAKPOINTS has it — the width the layer changes shape at. */
const LG_QUERY = "(min-width: 64rem)";

/**
 * The elements the reveal writes to. An object rather than five positional
 * parameters: they are all `RefObject<HTMLElement | null>` at the call site,
 * so a list of them is a list of things that would swap silently.
 */
type RevealRefs = {
  /**
   * The pinned box, and from `lg` up the thing whose arrival starts
   * everything — see {@link REVEAL_ROOT_MARGIN}.
   */
  still: RefObject<HTMLElement | null>;
  title: RefObject<HTMLElement | null>;
  eyebrow: RefObject<HTMLElement | null>;
  description: RefObject<HTMLElement | null>;
  /** the meta list at the top of the left column */
  meta: RefObject<HTMLElement | null>;
  /** the column the cards stack in — faded, never moved; see {@link STATS_SHIFT} */
  stack: RefObject<HTMLElement | null>;
  stats: RefObject<HTMLElement | null>;
  /**
   * The last card, whose locking into place is what brings the stats in from
   * `lg` up — see {@link statsRootMargin}. Below `lg` there is no pile to wait
   * for and the stats take their own trigger.
   */
  lastCard: RefObject<HTMLLIElement | null>;
};

/**
 * Plays {@link REVEAL} over the words of `refs.title` the first time the
 * section comes into view and {@link COPY} over the two blocks around it as
 * that finishes — once, and only then: each observer is dropped as it fires, so
 * scrolling back up doesn't replay it.
 *
 * That is the whole of the intro from `lg` up. The cards arrive on the scroll
 * and the stats wait on the cards, so neither is on this timeline — and the
 * stats are the one thing here that plays *backwards* as well, since the card
 * they wait on can leave again. See the trigger below.
 *
 * That sequence is one timeline from `lg` up and several below it, for the same
 * reason {@link REVEAL_ROOT_MARGIN} is two figures. From `lg` up the section
 * arrives whole, every block already on screen behind the one trigger, so the
 * beats are spaced against *each other* — {@link BLOCK_LEAD} and friends are
 * what make three blocks read as one reveal rather than three.
 *
 * Below `lg` those same leads would be spacing beats against a clock while the
 * reader spaces them against the scroll: the section is a column taller than
 * the screen, and by the time the last beat played the cards would still be two
 * thumb-flicks below the fold, finished before they were ever seen. So each of
 * the column's blocks takes its own trigger at the same
 * {@link REVEAL_ROOT_MARGIN} `base` edge and plays as it clears the fold, and
 * the scroll does the spacing the leads do above.
 *
 * The stats are the one block whose trigger differs rather than only its
 * timing. From `lg` up they wait on the cue at the foot of the pile, because
 * "once the last card lands" is the whole point of the composition and is a
 * scroll away rather than a second away. Below `lg` there is no pile to wait
 * for and they clear the fold like everything else.
 *
 * The split is made once, up front, and the words are parked at their start
 * pose right away: waiting for the trigger to split would flash the finished
 * headline for a frame if the section were ever already on screen. Splitting
 * into words rather than lines is also what makes it safe to do before the
 * display face has swapped in — the masked words are inline-blocks and re-wrap
 * on their own, where a line split would be measured against the fallback and
 * stay that way.
 *
 * The copy is a dependency, so an edit in Prismic re-splits rather than
 * animating spans that no longer hold it, and so is the stat count — see the
 * boxes being read off the list below.
 *
 * The headline is what the whole sequence hangs off — it carries the split, the
 * observer and the timeline everything else is hung on — so with no headline
 * rendered there's nothing for the rest to follow and it all stays as typeset.
 */
function useCopyReveal(
  refs: RevealRefs,
  title: string,
  description: string,
  statCount: number,
  skillCount: number,
) {
  useGSAP(
    () => {
      const el = refs.title.current;
      if (!el) return;

      // whoever asked not to see things move gets the headline as typeset, with
      // nothing split, parked or observed — same bargain as <SolidIcon />
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Read here rather than through `useBreakpoints`, the same way the motion
      // query above is: everything below is built once and dropped as it fires,
      // so a subscription would only re-render the section for a figure nothing
      // reads again. A resize across `lg` before the section has arrived keeps
      // the layout it mounted with — re-running the effect there would re-split
      // the headline and re-park its words to move the triggers, on a viewport
      // that has just changed shape under the reader.
      const wide = window.matchMedia(LG_QUERY).matches;

      // `mask` wraps each word in its own `overflow: clip` box — the hard edge
      // the words climb out from
      const split = SplitText.create(el, { type: "words", mask: "words" });
      gsap.set(split.words, { opacity: 0, yPercent: REVEAL_RISE });

      // parked the same way and for the same reason, each on its own side of
      // the headline; the eyebrow is always there, the paragraph is a field
      const eyebrow = refs.eyebrow.current;
      const paragraph = refs.description.current;
      if (eyebrow) gsap.set(eyebrow, { opacity: 0, y: -COPY_SHIFT });
      if (paragraph) gsap.set(paragraph, { opacity: 0, y: COPY_SHIFT });

      // The meta rows are read off their list rather than collected through
      // refs of their own: they're fixed markup, so the DOM already holds them
      // in order and a ref array would only restate it.
      const metaRows = refs.meta.current
        ? Array.from(refs.meta.current.children)
        : [];
      if (metaRows.length) {
        gsap.set(metaRows, { opacity: 0, y: -COPY_SHIFT });
      }

      // Below `lg` only. Above it the cards arrive by scrolling and the intro
      // has nothing to say about them — see {@link STATS_SHIFT}. Parking the
      // column here regardless would leave it at `opacity: 0` for ever, since
      // nothing up there would then be tweening it back.
      const stack = refs.stack.current;
      if (!wide && stack) gsap.set(stack, { opacity: 0 });

      // The stat boxes count off on both sides of `lg`. What differs is only
      // what says "now": the cue at the foot of the pile above, the block's own
      // top below.
      const stats = refs.stats.current;
      const statBoxes = stats ? Array.from(stats.children) : [];
      if (statBoxes.length) {
        gsap.set(statBoxes, { opacity: 0, y: STATS_SHIFT });
      }

      // The beats, each written once against a timeline the caller hands it.
      // That's what lets the same tweens be one sequence from `lg` up and
      // several separate plays below it, rather than the two layouts keeping
      // two copies of the motion in step by hand.

      /** The headline's words, and the eyebrow and paragraph closing on them. */
      const copyBeat = (tl: gsap.core.Timeline) => {
        tl.to(split.words, { opacity: 1, yPercent: 0, ...REVEAL });

        // the handoff sits where the words actually end — a moment that moves
        // with the word count — rather than at a delay guessed against it. Two
        // tweens off the one label rather than one over both, because they
        // fade to different places; the label is what keeps them together.
        tl.addLabel("settle");
        if (eyebrow) {
          tl.to(eyebrow, { opacity: EYEBROW_OPACITY, y: 0, ...COPY }, "settle");
        }
        if (paragraph) {
          tl.to(paragraph, { opacity: 1, y: 0, ...COPY }, "settle");
        }
      };

      /** The meta list at the top of the column, counting off. */
      const metaBeat = (tl: gsap.core.Timeline, at: gsap.Position) => {
        if (!metaRows.length) return;
        tl.to(
          metaRows,
          { opacity: 1, y: 0, ...COPY, stagger: ROW_STAGGER },
          at,
        );
      };

      /** The card column, arriving whole. */
      const stackBeat = (tl: gsap.core.Timeline, at: gsap.Position) => {
        if (stack) tl.to(stack, { opacity: 1, ...COPY }, at);
      };

      /** The stats, counting off behind whatever cued them. */
      const statsBeat = (tl: gsap.core.Timeline, at: gsap.Position) => {
        if (!statBoxes.length) return;
        tl.to(
          statBoxes,
          { opacity: 1, y: 0, ...COPY, stagger: ROW_STAGGER },
          at,
        );
      };

      // Every observer here is a one-shot: it drops itself as it fires, so a
      // beat plays on the way down and stays played on the way back up. They
      // are collected so the cleanup can drop the ones that never fired.
      const observers: IntersectionObserver[] = [];

      const rootMargin = wide ? REVEAL_ROOT_MARGIN.lg : REVEAL_ROOT_MARGIN.base;

      const whenVisible = (target: Element, play: () => void) => {
        const io = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) return;
            io.disconnect();
            play();
          },
          { threshold: REVEAL_THRESHOLD, rootMargin },
        );
        io.observe(target);
        observers.push(io);
      };

      if (wide) {
        // One trigger, one timeline for the copy: the composition arrives
        // whole, so its beats are spaced against each other. The labels are
        // offset from the copy's own settle rather than appended, so the blocks
        // stay related to each other however long the headline's beat runs.
        //
        // Watched at the pinned box rather than at any block inside it — see
        // {@link REVEAL_ROOT_MARGIN}, which is mostly the story of getting this
        // wrong twice.
        const play = () => {
          const tl = gsap.timeline();
          copyBeat(tl);
          metaBeat(tl, "settle+=" + META_LEAD);
        };

        // No box to watch means play it now, rather than never.
        //
        // Everything above has already been parked at `opacity: 0`, so a
        // trigger that silently fails to attach doesn't degrade the reveal —
        // it erases the section, permanently, with nothing on screen to say
        // why. That has happened twice here on two unrelated causes, which is
        // twice more than a failure this quiet gets to happen: the guard costs
        // one branch and turns the worst case into a reveal that plays early.
        const still = refs.still.current;
        if (still) whenVisible(still, play);
        else play();

        // The stats are the exception, and the only block here whose timing the
        // reader sets rather than a clock: they belong to the end of the pile,
        // which is a scroll away rather than a second away. Watched at the last
        // card, cropped to just past where it comes to rest, so the two happen
        // together — see {@link statsRootMargin}.
        //
        // The one reveal here that is not a one-shot, and the only one that
        // should not be. Every other block plays as the section arrives and has
        // no reason to be undone — but the stats are tied to a card that can
        // leave again, and a reader who scrolls back up past the pile finishing
        // ought to find them gone, exactly as they found them the first time.
        //
        // So the beat is built once, paused, and driven both ways. `reverse()`
        // runs that same tween backwards — the fade, the rise and the stagger,
        // in the other order — which is the animation out for nothing, and one
        // that cannot drift from the animation in because it *is* the animation
        // in. Nothing below has to be kept in step by hand.
        const lastCard = refs.lastCard.current;
        if (lastCard && statBoxes.length) {
          const stats = gsap.timeline({ paused: true });
          statsBeat(stats, 0);

          const io = new IntersectionObserver(
            ([entry]) => {
              // `reverse()` on a timeline still at its start is a no-op, which
              // is what the observer's first call is on a page loaded above the
              // section
              if (entry.isIntersecting) stats.play();
              else stats.reverse();
            },
            {
              threshold: REVEAL_THRESHOLD,
              rootMargin: statsRootMargin(skillCount),
            },
          );
          io.observe(lastCard);
          observers.push(io);
        }
      } else {
        // A trigger each, and no leads: the column is taller than the screen,
        // so the reader's scroll is what spaces these — see above.
        //
        // The headline block is the exception to "watch the block's own top" —
        // it stays on the headline, which is the element this hook is scoped to.
        whenVisible(el, () => copyBeat(gsap.timeline()));

        if (refs.meta.current) {
          whenVisible(refs.meta.current, () => metaBeat(gsap.timeline(), 0));
        }
        if (stack) whenVisible(stack, () => stackBeat(gsap.timeline(), 0));
        if (stats) whenVisible(stats, () => statsBeat(gsap.timeline(), 0));
      }

      return () => {
        for (const io of observers) io.disconnect();
        // puts the original text node back, taking the spans and everything
        // set on them with it
        split.revert();
      };
    },
    {
      dependencies: [title, description, statCount, skillCount],
      scope: refs.title,
    },
  );
}

/** A rule and a label — the design's section markers. */
function Eyebrow({
  ref,
  children,
}: {
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <h3
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
    </h3>
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

/**
 * One skill: a numbered header, a paragraph, and one of the sky's solids
 * turning beside it.
 *
 * — Where the stacking lives ───────────────────────────────────────────────
 *
 * In three CSS declarations, and nowhere else. The card is `position: sticky`
 * at `cardSlotVh(i)`, a header's height below the card before it, and it is
 * given `cardGapVh(i)` of clear space underneath so the next one arrives a beat
 * later. The browser does the rest: each card scrolls up the column until it
 * reaches its own `top`, then holds while the one behind it climbs over
 * everything but its header.
 *
 * That last part is the whole illusion, and it is an equality rather than a
 * trick — `CARD_STEP_VH` is both the offset between two cards and the height
 * of the header row below. A covered card shows its header and nothing else
 * because the card on top of it starts exactly where its own body does.
 *
 * There is no first-card special case any more. Card 0 sits at flow 0, which is
 * already past its own `top` when the section lands, so it is pinned from the
 * section's first frame — the design's opening state, one card, open, waiting.
 * It falls out of the same rule as the rest instead of being exempted from it.
 *
 * `z-index` is the stacking order itself: later cards paint over earlier ones,
 * which is what turns four overlapping boxes into a pile rather than a mess.
 *
 * Below `lg` none of this applies — every `lg:` prefix above says so — and the
 * card is an ordinary block in the column, open, at its natural height.
 */
function SkillCard({
  ref,
  index,
  count,
  skill,
  description,
}: {
  /** set on the last card only — see {@link statsRootMargin} */
  ref?: Ref<HTMLLIElement>;
  index: number;
  count: number;
  skill: KeyTextField;
  description: KeyTextField;
}) {
  return (
    <li
      ref={ref}
      style={
        {
          "--slot": cardSlotVh(index) + "vh",
          "--card-h": CARD_HEIGHT_VH + "vh",
          "--header-h": CARD_STEP_VH + "vh",
          // a beat's worth of runway for every card but the last, whose gap is
          // the run-out that keeps the finished pile pinned — see
          // {@link cardGapVh}
          "--gap": cardGapVh(index, count) + "vh",
          zIndex: index,
        } as CSSProperties
      }
      className={
        "pointer-events-auto relative mb-3 border-y border-white " +
        PLATE +
        " lg:sticky lg:top-(--slot) lg:mb-(--gap) lg:h-(--card-h)"
      }
    >
      {/* The header row. Its height *is* {@link CARD_STEP_VH} from `lg` up --
          that equality is what a collapsed card in the pile shows. */}
      <div className="flex h-14 items-center gap-3 px-[5%] lg:h-(--header-h) lg:gap-4">
        <span
          className={
            CAPS +
            " " +
            MUTED +
            " shrink-0 tabular-nums text-[0.6875rem] lg:text-xs xl:text-[0.8125rem] 2xl:text-sm"
          }
        >
          {/* "01/", "02/" ... the design numbers them, and the number is the one
              part of a collapsed card that says where in the pile it is */}
          {String(index + 1).padStart(2, "0")}/
        </span>
        <span
          className={
            "font-display " +
            CAPS +
            " " +
            LEADING +
            " truncate font-extrabold text-white text-sm lg:text-base xl:text-lg 2xl:text-xl"
          }
        >
          {skill}
        </span>
      </div>

      {description && (
        <p
          className={
            CAPS +
            " " +
            MUTED +
            " " +
            LEADING +
            " px-[5%] pr-[32%] pb-6 text-[0.625rem] tracking-normal lg:absolute lg:bottom-[14%] lg:left-[5%] lg:w-1/2 lg:p-0 lg:text-[0.6875rem] xl:text-xs 2xl:text-sm"
          }
        >
          {description}
        </p>
      )}

      {/* The sky's solids, a different one on each card and each turning at its
          own rate — see <SolidIcon />. It replaces the design's placed bitmap,
          which is a reference crop and already soft at this size. */}
      <SolidIcon
        kind={solidForRow(index)}
        seed={index}
        className="pointer-events-none absolute right-[4%] bottom-4 size-16 text-white lg:top-1/2 lg:bottom-auto lg:aspect-square lg:h-[86%] lg:w-auto lg:-translate-y-1/2"
      />
    </li>
  );
}

export default function AboutContent({
  sectionRef,
  title,
  description,
  numbers,
  skills,
}: Props) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const eyebrowRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const stillRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLUListElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLUListElement>(null);
  const lastCardRef = useRef<HTMLLIElement>(null);

  useCopyReveal(
    {
      still: stillRef,
      title: titleRef,
      eyebrow: eyebrowRef,
      description: descriptionRef,
      meta: metaRef,
      stack: stackRef,
      stats: statsRef,
      lastCard: lastCardRef,
    },
    title ?? "",
    description ?? "",
    numbers.length,
    skills.length,
  );

  /**
   * Re-measure the face's box whenever the page could have reflowed.
   *
   * The box is ordinary page content now, so its document position only moves
   * when something actually re-lays-out: a resize, a rewrap, the display face
   * swapping in after first paint, an edit in Prismic. Watching the section
   * catches all of them. Nothing here runs on scroll -- see ./faceSlot for why
   * that is the whole point of the arrangement.
   *
   * Coalesced to one measurement a frame. On iOS the address bar collapses and
   * expands as the page is scrolled, and every step of that animation fires a
   * `resize`; unbatched, a scroll back up the page would pay for a forced
   * layout in each of the frames the section is also being drawn in.
   */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    let pending = 0;
    const schedule = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        measureFaceSlot();
      });
    };

    measureFaceSlot();

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [sectionRef]);

  /**
   * The one thing the pile's geometry cannot check for itself.
   *
   * Everything else scales with the card count on its own — the section grows a
   * beat, the gaps hold, the cards keep landing on time. This is the exception:
   * past a certain count the finished pile is taller than the screen, and then
   * two things go at once, the cards running out of room to be pinned in and the
   * last of them growing down through the stats. Neither shows up as an error;
   * the pile just starts behaving oddly at the foot of the section.
   *
   * So it says so, in development. It is a design question rather than a bug —
   * the answer is a shorter card or a tighter step, not a patch here — and it is
   * a great deal easier to answer when something names it.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const fits = stackFitsVh(skills.length);
    if (fits <= 100) return;

    console.warn(
      `<AboutContent />: ${skills.length} skill cards make a pile ${fits}vh ` +
        `tall, which is more than the screen. The lower cards will lose their ` +
        `pinning and the last will grow through the stats — see stackFitsVh.`,
    );
  }, [skills.length]);

  const iconSize = "size-4 shrink-0 xl:size-5 2xl:size-6";
  const metaText =
    CAPS +
    " " +
    MUTED +
    " text-[0.6875rem] lg:text-xs xl:text-[0.8125rem] 2xl:text-sm";

  /**
   * The right-hand column, 1223-1846 of 1906 in the design, shared by the pile
   * and the stats.
   *
   * They are two separate full-height boxes rather than one, because they want
   * different things from the scroll: the cards are sticky siblings that travel
   * through the section, the stats are a single box pinned near its foot. One
   * container could not hold both without the stats taking flow space the pile
   * needs.
   *
   * Both are `pointer-events-none`, with the cards and the stat boxes opting
   * back in. They cover the whole right of the section and would otherwise
   * swallow the drags that reach the head underneath — the same bargain the
   * old overlay layer made, for the same reason.
   */
  const rightColumn =
    "pointer-events-none px-(--block-inset) lg:absolute lg:inset-y-0 lg:left-[64.2%] lg:right-[3.1%] lg:px-0";

  return (
    <>
      {/* — the still half ------------------------------------------------ */}
      {/* Pinned for the whole section from `lg` up, which is what gives the
          cards beside it something to stack against. Below `lg` it is just the
          top of an ordinary column and the blocks fall into it in source
          order. */}
      <div
        ref={stillRef}
        className="pointer-events-none relative flex min-h-screen w-full flex-col justify-center gap-5 px-(--block-inset) pt-[6vh] pb-[calc(6vh+2.5rem)] sm:gap-6 lg:sticky lg:top-0 lg:block lg:h-screen lg:min-h-0 lg:gap-0 lg:px-0 lg:pt-0 lg:pb-0"
      >
        {/* "ABOUT" itself is <Title /> in the scene, where no reader can get at
            it, so the section's heading lives here */}
        <h2 className="sr-only">About</h2>

        {/* — where and when --------------------------------------------- */}
        {/* Top of the left column in the design (80, 116 of 1906 x 947), on its
            own rather than hung off the foot of anything: it and the copy block
            below are pinned to opposite ends of the same column, so neither can
            push the other about as the headline rewraps. */}
        <ul
          ref={metaRef}
          className="space-y-2 lg:absolute lg:top-[12.2%] lg:left-[4.2%] lg:space-y-3"
        >
          <li className="flex items-center gap-3.5">
            <GlobeIcon className={iconSize + " text-white"} />
            <span className={metaText}>born in brazil / based in london</span>
          </li>
          <li className="flex items-center gap-3.5">
            <PrismIcon className={iconSize + " text-white"} />
            <span className={metaText}>
              local time <LocalTime />
            </span>
          </li>
          <li className="flex items-center gap-3.5">
            <StarIcon className={iconSize + " text-white"} />
            <span className={metaText}>since 1993</span>
          </li>
        </ul>

        {/* — who i am ---------------------------------------------------- */}
        {/* the eyebrow is a marker for the copy under it, so with neither field
            filled the block goes rather than leaving a rule floating on its own.

            Set against the *foot* of the column (the design's 841 of 947, so
            11.2% up from the bottom) rather than flowing down from the meta
            list: the headline is the block whose height the copy decides, and it
            grows upwards into the empty middle of the column instead of pushing
            the paragraph down towards <SiteNav />. */}
        {(title || description) && (
          <div className="mb-6 lg:absolute lg:bottom-[11.2%] lg:left-[3.7%] lg:mb-0 lg:w-[31.9%]">
            <Eyebrow ref={eyebrowRef}>who i am</Eyebrow>

            {/* the design breaks this over four lines, but a Text field is one
                line in the editor, so the breaks are the column's to make — it
                is sized to wrap the copy the same way. `pre-line` is there for
                the author who does get a newline in. */}
            {title && (
              <p
                ref={titleRef}
                className={
                  "font-display mt-3 font-extrabold text-white " +
                  CAPS +
                  " " +
                  LEADING +
                  " text-base tracking-normal whitespace-pre-line sm:text-lg lg:text-xl xl:text-2xl 2xl:text-[1.75rem] short:text-lg shorter:text-[0.85rem]"
                }
              >
                {title}
              </p>
            )}

            {description && (
              <p
                ref={descriptionRef}
                className={
                  "mt-3 " +
                  CAPS +
                  " " +
                  MUTED +
                  " " +
                  LEADING +
                  " text-xs tracking-normal lg:max-w-[93%] lg:text-sm xl:mt-5 xl:text-base 2xl:mt-6 2xl:text-lg short:text-sm shorter:text-[0.75rem]"
                }
              >
                {description}
              </p>
            )}
          </div>
        )}

        {/* — the face ---------------------------------------------------- */}
        {/* The head is scene geometry — <Head />, over in the R3F tree — and
            this is the hole it sits in: an empty box that <Scene /> matches the
            face to every frame, so the two cannot drift apart as the copy above
            it rewraps. Nothing is drawn here; the canvas shows through.

            Gone from `lg` up, where the face is back to the world position it is
            authored at and the blocks are placed around it. `display: none`
            takes the box away entirely, which is what ./faceSlot reads as "no
            column to sit in" — so the two halves stay in step through a resize
            across the breakpoint. */}
        <div
          ref={publishFaceSlot}
          aria-hidden
          className="mt-[8vw] mb-[3vw] aspect-[784/1519] w-[min(66vw,37vh)] shrink-0 self-center lg:hidden"
        />
      </div>

      {/* — the pile ------------------------------------------------------ */}
      {/* From `lg` up the intro never touches this: the cards scroll in, which
          is an entrance already. See {@link SkillCard} and {@link STATS_SHIFT}.
          Below `lg` it fades in with the rest of the column. */}
      {skills.length > 0 && (
        <div ref={stackRef} className={rightColumn}>
          {/* Two figures the pile cannot be laid out without.

              `--lead` is the space above the first card, so it rises into place
              rather than being there already — see {@link cardFlowVh}. Padding
              rather than a margin on the first card, which would collapse
              straight out through the list and move the list itself.

              `h-full` is the room the pinned cards are held in. It has to be a
              height and not trailing space: a margin on the last card collapses
              out through the list's bottom edge, and padding sits outside the
              content box the cards are actually constrained by. See
              {@link stackFitsVh}. */}
          <ul
            style={{ "--lead": cardFlowVh(0) + "vh" } as CSSProperties}
            className="lg:h-full lg:pt-(--lead)"
          >
            {skills.map(({ skill, description }, i) => (
              <SkillCard
                // a group item carries no id of its own, and position is the
                // only thing that identifies a card here — it is also the
                // card's place in the pile, so this key is load-bearing
                key={i}
                ref={i === skills.length - 1 ? lastCardRef : undefined}
                index={i}
                count={skills.length}
                skill={skill}
                description={description}
              />
            ))}
          </ul>
        </div>
      )}

      {/* — my stats ------------------------------------------------------ */}
      {/* Its own full-height box with one sticky child, so it pins near the
          foot of the screen and holds there for the rest of the section without
          taking any of the flow the pile beside it needs.

          Sticky from flow 0, so it is pinned the moment the section lands and
          never moves again — what says *when* it appears is the cue above,
          which fades it in once the pile is finished. Position and timing kept
          apart like that is what lets it arrive without sliding. */}
      {numbers.length > 0 && (
        <div className={rightColumn}>
          <ul
            ref={statsRef}
            style={{ "--stats-top": STATS_TOP_VH + "vh" } as CSSProperties}
            className="grid grid-cols-3 gap-2 lg:sticky lg:top-(--stats-top) lg:gap-4"
          >
            {numbers.map(({ number, label }, i) => (
              <li
                key={i}
                className={
                  "pointer-events-auto flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-white " +
                  STAT_PLATE +
                  " px-2 py-3 text-center lg:h-[14.3vh] lg:gap-3 lg:py-4"
                }
              >
                <span
                  className={
                    "font-display " +
                    LEADING +
                    " font-extrabold text-white text-xl lg:text-3xl xl:text-4xl 2xl:text-[2.75rem]"
                  }
                >
                  {number}
                </span>
                <span
                  className={
                    CAPS +
                    " " +
                    MUTED +
                    " " +
                    LEADING +
                    " text-[0.5rem] lg:text-[0.625rem] xl:text-xs 2xl:text-base"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
