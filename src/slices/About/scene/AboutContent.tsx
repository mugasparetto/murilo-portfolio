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
 * From `lg` up the whole section moves with the scroll, and nothing in it moves
 * on a clock: the copy in the left column arrives on a range per block (see
 * {@link revealRangeVh}), the pile stacks, and the stats follow it.
 *
 * Each card is `position: sticky` at its own slot, with a
 * beat's worth of flow under it, so the whole of the *stacking* is three CSS
 * declarations and the browser — see {@link SkillCard}, and {@link cardFlowVh}
 * for the arithmetic. Only the fade on top of it is script, and only because
 * a sticky box is the one subject a `view()` timeline cannot measure honestly
 * — see {@link useCardArrival}.
 *
 * The stats are scrolled in the same way, and off the same scroll: their ranges
 * open a beat after the last card locks, so what brings them in is the pile
 * having finished rather than a clock started when it did. See
 * {@link statRangeVh}, and {@link restVh} for the scroll that pays for it.
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
const MUTED = "text-white/72";

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

/* --------------------------------------------------------------------------
   The pile's arithmetic

   Traced off the Figma frames and kept in `vh`, which from `lg` up is exact
   rather than convenient: the still box is `h-screen` and the card column spans
   the section, so a share of the design's 947 is a share of the viewport.

   All of it feeds `position: sticky`. Nothing here runs per frame — the cards
   are pinned by the compositor, and these numbers only say where and when.
   -------------------------------------------------------------------------- */

/** The first card's top and a card's height: 191 and 235 of 947. */
const CARD_TOP_VH = 19;
const CARD_HEIGHT_VH = 22;

/**
 * The step between two cards, 58 of 947 — and also the height of a card's
 * header row, which is the whole illusion: a card covers everything of the one
 * behind it *except* its header, because it starts exactly where that card's
 * body does. Change one and change the other.
 */
const CARD_STEP_VH = 6.1;

/**
 * The two figures above as CSS lengths rather than as plain `vh` — what the
 * markup actually gets.
 *
 * `vh` is exact for this composition only while the viewport keeps the design
 * frame's aspect. A card's *height* is a share of the design's 947, but its
 * *width* is a share of its 1519, handed to it by the column
 * (`lg:left-[64.2%] lg:right-[3.1%]`, so 32.7vw). On the frame the two agree
 * and the card is the wide band the design draws. On a portrait tablet they do
 * not: 1024x1366 clears `lg` by a hair, so the column collapses to 335px while
 * the height holds at 273 — a card very nearly square, with a header 6.1vh of
 * a much taller screen and an icon two thirds of the card's width sitting on
 * top of the blurb.
 *
 * So each gains a ceiling in `vw` — the same figure taken against the design's
 * width instead of its height, 1519:947 making 1vh worth 0.6234vw — and a
 * floor in `rem`, because the type inside them does not scale with either: the
 * header sets 16px and the blurb up to six lines of 11px, and a card taken
 * down to the pure ratio at 1024 would have nowhere to put them. The ceiling
 * is what the design asks for and the floor is what the copy needs; the `vh`
 * figure still wins whenever it is the smallest of the three, so a wide window
 * is never handed a card the shape of a narrow one.
 *
 * The ceiling falls below the `vh` figure once the viewport is taller than
 * about 1.6 times its width, which is the design frame's own aspect. So this
 * is not only the portrait tablet: a 4:3 monitor and a small landscape tablet
 * are inside it too, and both were already drawing a card squarer and an icon
 * wider than the design's share. Every viewport these bind on is one they move
 * *towards* 2.6:1, and 16:9 and wider is untouched to the pixel. `short:`
 * cannot reach them at all — 50rem of height puts 20vh under the floor, so the
 * card's own `vh` figure is always the smallest term there.
 *
 * ── What a clamped step is allowed to touch ───────────────────────────────
 *
 * The step is the one figure the scroll arithmetic might be expected to
 * notice, and it does not: a card pins at `CARD_TOP + i * STEP` and flows at
 * `80 + i * (BEAT + STEP)`, so
 *
 *     lock = flow - slot = 80 + i * BEAT - CARD_TOP
 *
 * and the step cancels straight out of it — the same cancellation
 * {@link cardDwellVh} is built on. Every offset in {@link cardRangeVh} and the
 * whole of {@link sectionVh} are untouched, and stay the plain `vh` numbers
 * they are. What does have to follow is the gap under a card, which is flow
 * spacing *less the card's own height* and so has to be written as that
 * subtraction rather than as its result — see {@link cardGap}.
 *
 * The `vh` functions themselves are left alone. {@link stackFitsVh} and
 * {@link cardSpawnFitsVh} still read them, and both are upper bounds: a clamp
 * only ever makes the pile shorter than they assume.
 */
const CARD_HEIGHT = `min(${CARD_HEIGHT_VH}vh, max(12.47vw, 11rem))`;
const CARD_STEP = `min(${CARD_STEP_VH}vh, max(3.8vw, 2.75rem))`;

/** Where the stats pin: 698 of 947, with the design's 135 of height under it. */
const STATS_TOP_VH = 73.7;

/**
 * How much scroll the copy gets to itself after the section lands, before the
 * first card's top edge crosses the fold.
 *
 * The knob to turn if the pile starts too early or too late — everything after
 * it shifts along, including the section's own height. It is also the room the
 * intro has: the copy arrives over the scroll before card 0 climbs, so a
 * headline long enough to run past that is answered here. See
 * {@link pileStartVh}.
 */
const INTRO_HOLD_VH = 0;

/**
 * One card's arrival: the scroll from one card locking to the next.
 *
 * The pile's pacing dial, and the only one. A card's own travel is 1:1 with the
 * wheel — sticky gives it that and cannot be argued with — so the way to spend
 * more scroll on the same movement is to widen the gap between arrivals, not to
 * stretch the arrivals themselves. Raising this lengthens the dwell on each
 * finished card by exactly what it adds, leaves {@link CARD_TRAVEL_VH} and the
 * fade untouched, and grows {@link sectionVh} to pay for it.
 */
const BEAT_VH = 25;

/* --------------------------------------------------------------------------
   The stats' arrival

   Scroll, like the pile's — not seconds. The three boxes used to be cued by an
   observer and then played on a clock, which is the one beat in the section
   whose pace the reader did not set: it fired at a line and ran at its own
   speed from there, so scrolling on made no difference to it and scrolling back
   undid it in a rush rather than by exactly as much as had been taken back.

   The distances are unchanged — {@link STATS_SHIFT} up, the same fade, the same
   count-off. Only what drives them is different, and these are the same figures
   restated in the units the scroll actually has: `vh` rather than seconds.
   -------------------------------------------------------------------------- */

/**
 * How much scroll passes after the last card locks before the first stat box
 * begins to arrive.
 *
 * The composition's one rule about these two blocks: the stats belong to the
 * *end* of the pile, so nothing of theirs may start while a card is still
 * moving. The lock is the pile's last movement, and this is the beat after it.
 */
const STATS_LEAD_VH = 2;

/** One box's arrival: the scroll its rise and its fade play over, together. */
const STATS_ARRIVE_VH = 11;

/**
 * The count-off, box to box — the old `ROW_STAGGER` in the units the scroll
 * has. Short against {@link STATS_ARRIVE_VH} for the same reason it was short
 * against the tween's half-second: three boxes should read as one block
 * arriving unevenly, not as three separate arrivals.
 */
const STATS_STAGGER_VH = 5;

/**
 * What is left under the finished stats before the document ends.
 *
 * Not slack. An arrival that completes on the page's final pixel reads as
 * having been cut off whatever it actually did, because the reader runs out of
 * scroll at the same moment it runs out of animation and cannot tell the two
 * apart.
 */
const STATS_DWELL_VH = 3;

/* --------------------------------------------------------------------------
   The left column's arrival

   The last of the section's three blocks to stop being a timeline, and it went
   for the reason the stats did: the intro was played *at* the reader rather
   than by them. An observer fired as the section landed and a GSAP sequence ran
   from there at its own pace — so scrolling on did nothing to it, scrolling
   back undid nothing, and a reader who turned around halfway found the copy
   finishing behind them.

   The distances are the ones the timeline had, restated in the units the scroll
   has: {@link REVEAL_RISE} up out of the mask, {@link COPY_SHIFT} either side
   of the headline, the same order, the same count-off. What changed is who
   drives them — and that the spacing is geometry now, so the beats hold their
   relation to each other on the way back up without anything being written
   twice.

   It costs the section no height. The whole intro runs inside the scroll card
   0 already has before it starts to climb — see {@link pileStartVh}, which is
   the invariant, and the warning in {@link useCopyReveal} that says when a
   headline has outgrown it.
   -------------------------------------------------------------------------- */

/**
 * How much scroll passes after the section lands before the first word climbs.
 *
 * Zero, and deliberately: the still half is pinned from that moment, the camera
 * flight from the hero has just come to rest, and the reader's next turn of the
 * wheel is what the copy is waiting for. Raise it to hold the section still for
 * a beat before anything moves.
 */
const COPY_LEAD_VH = 0;

/**
 * One word's climb out of its mask, and the count-off between two of them.
 *
 * The old `REVEAL`'s 0.6s and 0.06s at the ratio they had — the stagger is a
 * tenth of the arrival, which is what makes a headline read word by word rather
 * than as a block sliding up. Unlike the seconds they replace, these are spent
 * per word: a longer headline now takes proportionally more *scroll*, which is
 * the one thing that can push the intro into the pile. See {@link introRunVh}.
 */
const WORD_ARRIVE_VH = 9;
const WORD_STAGGER_VH = 0.9;

/** One settle: the eyebrow, the paragraph, and each meta row. `COPY`'s 0.5s. */
const COPY_ARRIVE_VH = 8;

/**
 * The old `META_LEAD` and `ROW_STAGGER` in the units the scroll has — the top
 * of the column set off against the copy at the foot of it, and the count-off
 * inside the meta list itself.
 */
const META_LEAD_VH = 2;
const ROW_STAGGER_VH = 1.8;

/** Binary floating point turns `20.2 + 6.1` into `26.299999999999997`. */
const vh = (n: number) => Math.round(n * 100) / 100;

/**
 * The scroll from the last card's lock to the last stat box being solid — the
 * whole of the arrival, stagger included.
 */
const statsRunVh = (count: number) =>
  vh(
    STATS_LEAD_VH + STATS_STAGGER_VH * Math.max(0, count - 1) + STATS_ARRIVE_VH,
  );

/**
 * Scroll between the last card locking and the bottom of the page.
 *
 * Everything the section still has to do happens in here — the last card
 * travelling the final stretch to its slot, its fade finishing, and now the
 * whole of the stats' arrival rather than merely the cue for it. Every one of
 * them is measured from the page's own end, so cutting it fine does not make
 * them worse, it stops them happening: at 1 they landed within 1 to 7vh of the
 * very last pixel and stopped happening at all.
 *
 * Which is why it is a function of the stat count rather than a figure typed
 * here — the same argument {@link sectionVh} makes about the cards. Scrolling
 * the stats in costs {@link statsRunVh} of wheel that being *told* to play them
 * did not, and a fourth box added in Prismic asks for another
 * {@link STATS_STAGGER_VH} of it. Typed as a constant, the fourth box would
 * have to find that scroll inside a runway three boxes already fill, and would
 * finish under the fold.
 *
 * With no stats at all there is nothing to make room for and the old 5 stands,
 * which is still what the last card's own fade wants.
 *
 * A section's last viewport is unreachable anyway — scrolled to the very
 * bottom, the fold sits on the section's own end — so {@link sectionVh} adds
 * that screen on top of this.
 */
const REST_MIN_VH = 5;
const restVh = (stats: number) =>
  stats === 0 ? REST_MIN_VH : vh(statsRunVh(stats) + STATS_DWELL_VH);

/**
 * Where the *fallback* cues the stats, as a root extension in `vh` — see
 * {@link statsCueMargin}, and {@link useCopyReveal} for when it is used at all,
 * which is only where the browser cannot drive an animation from the scroll.
 *
 * Placed to fire exactly where the scrolled arrival starts, so the two paths
 * agree on the moment even though they disagree on everything after it: one
 * scrubs, the other plays. Derived rather than typed for that reason — a change
 * to {@link STATS_LEAD_VH} moves both.
 *
 * The stats are cued off an empty marker at the foot of the card column rather
 * than off the last card, and that is worth keeping even here. The card is
 * *pinned* from the moment it lands: it does not move again, so nothing about
 * it changes as the reader pulls away, and there would be nothing for an
 * observer to see until they had scrolled back past the lock — the whole of
 * {@link restVh}, with the stats hanging there for all of it. The marker is in
 * flow and never stops moving, so it answers in both directions.
 *
 * It is spent as a root *extension* rather than as page height: the observer
 * watches for the marker entering a viewport grown this much taller than the
 * real one, which happens while the marker is still below the fold. So the cue
 * needs no runway of its own at the end of the section.
 */
const statsCueVh = (stats: number) => vh(restVh(stats) - STATS_LEAD_VH);

/** Where card `i` pins. */
const cardSlotVh = (i: number) => vh(CARD_TOP_VH + i * CARD_STEP_VH);

/**
 * The same, as the CSS length the markup gets — the top figure is still `vh`,
 * the step is {@link CARD_STEP} and so is only nominally 6.1 of them.
 */
const cardSlot = (i: number) => `calc(${CARD_TOP_VH}vh + ${i} * ${CARD_STEP})`;

/**
 * A card's arrival: how far below its own slot it starts to appear, and how
 * much of that distance it spends fading in.
 *
 * Sticky gives a card its travel but cannot hide it on the way, so without
 * these a card is in view from the moment it clears the bottom of the screen:
 * 60 to 80vh of drifting up before it lands, which reads as the pile arriving
 * from off the page rather than assembling in front of the reader. Fading it
 * over the first stretch is what shortens the journey, without touching the
 * timing that decides when each card locks.
 *
 * ── Why it is measured from the slot and not from the screen ──────────────
 *
 * These used to be two fixed screen positions — appear at 65vh, solid at 52vh,
 * the same for every card. That looks right written down and is wrong in
 * motion, because a card's arrival is not the distance to a line on the screen,
 * it is the distance to *its own slot* — and every card pins one
 * {@link CARD_STEP_VH} lower than the last. Fixed lines meant the arrival got
 * shorter each time while the fade stayed the same length, which reads as the
 * pile speeding up towards the end: little scroll, a lot happening.
 *
 * Anchored to the slot instead, all of it falls out uniform. Every card appears
 * {@link CARD_TRAVEL_VH} below where it will land, fades over the first
 * {@link CARD_FADE_VH} of that, and rises the rest of the way solid — the same
 * arrival, four times, which is what a pile assembling should look like.
 *
 * Two invariants come free that used to need watching. A card is solid
 * `TRAVEL - FADE` above its own slot by construction, so it can no longer still
 * be fading when it pins — which would freeze it half-drawn, a pinned card
 * having stopped moving. And each card appears `(BEAT + STEP) - TRAVEL` after
 * the one before it locked, the same gap every time, so two cards are never in
 * flight at once.
 *
 * Read by {@link useCardArrival} and nowhere else — see there for why the
 * arrival is measured in script rather than handed to a `view()` timeline,
 * which is where it lived until it turned out that a sticky subject and
 * `view()` cannot both be telling the truth.
 */
const CARD_TRAVEL_VH = 12;
const CARD_FADE_VH = 10;

/**
 * How fast a card climbs into its slot, as a share of the scroll that carries
 * it. 1 is sticky's own rate; lower is slower, and the same movement then costs
 * more wheel.
 *
 * Spent on the scroll timeline in globals.css and nowhere else, and that is not
 * an implementation detail — it is the whole reason this figure can exist. An
 * unpinned sticky card moves exactly with the scroll, and the obvious way to
 * change that is to write a counter-transform from {@link useCardArrival},
 * which is already reading every card's rect anyway. It does not work: a sticky
 * position is the compositor's and a transform written from script is the main
 * thread's, so the two agree only on the frames script gets and the card
 * judders on the ones it misses — worst in this section, which is drawing a
 * WebGL scene throughout. It has to be composited to be smooth, so it lives on
 * a scroll-driven animation or it does not live anywhere.
 *
 * It changes the arrival and nothing else. Where a card locks is still where
 * sticky says, so {@link cardLockVh} and {@link sectionVh} are untouched and the
 * page is not a pixel taller — the scroll the climb takes comes out of the dwell
 * that sat between arrivals. Which is the limit on how low it goes: see
 * {@link cardDwellVh}.
 */
const CARD_SPEED = 0.65;

/**
 * The scroll one arrival costs: {@link CARD_TRAVEL_VH} of movement at
 * {@link CARD_SPEED}.
 *
 * The card is held {@link CARD_TRAVEL_VH} above where flow puts it as the range
 * opens and let go of exactly as it lands, so the lift it carries is the
 * difference between the two. Outside the range `animation-fill-mode: both`
 * holds it at one end or the other, which is the fallback's clamp for free.
 */
const CARD_RUNWAY_VH = vh(CARD_TRAVEL_VH / CARD_SPEED);

/**
 * The scroll between one card locking and the next appearing.
 *
 * The invariant {@link CARD_TRAVEL_VH} used to get for nothing, back when an
 * arrival cost exactly its own height in wheel. Below zero a card is still
 * climbing as the next one starts and the pile reads as two things moving
 * rather than one arriving, so {@link CARD_SPEED} cannot be turned down for
 * ever without {@link BEAT_VH} following it. The step cancels — a card that
 * pins one {@link CARD_STEP_VH} lower also starts that much lower — so the beat
 * is the whole of the gap. Checked in development; see <AboutContent />.
 */
const cardDwellVh = () => vh(BEAT_VH - CARD_RUNWAY_VH);

/** Where card `i` is on the screen when it starts to appear, and when it is solid. */
const cardSpawnVh = (i: number) => vh(cardSlotVh(i) + CARD_TRAVEL_VH);
const cardSolidVh = (i: number) => vh(cardSpawnVh(i) - CARD_FADE_VH);

/**
 * The scroll offsets card `i`'s two animations run between, as CSS lengths.
 *
 * Measured from the top of the *page* rather than the section, because a scroll
 * progress timeline is the document's and its range is in document
 * coordinates — hence `--about-top`, the one figure here that has to be
 * measured rather than derived, and the only reason script is involved at all.
 * See {@link usePileTimeline}.
 *
 * - `--climb-from` to `--climb-to` is the lift, unwinding linearly: the card
 *   closes {@link CARD_RUNWAY_VH} of scroll while covering
 *   {@link CARD_TRAVEL_VH} of screen, and reaches zero exactly at the lock.
 * - the fade shares its start and finishes where the card would have been
 *   {@link CARD_FADE_VH} into that climb, so a card is never still fading when
 *   it pins — the invariant {@link CARD_TRAVEL_VH} describes, restated in
 *   scroll.
 * - `--flat-*` is the same fade over the arrival the card has with no lift on
 *   it, for readers who asked not to see things move.
 */
const cardRangeVh = (i: number) => {
  const lock = cardLockVh(i);
  const at = (n: number) => `calc(var(--about-top) + ${vh(n)}vh)`;

  return {
    "--climb-from": at(lock - CARD_RUNWAY_VH),
    "--climb-to": at(lock),
    "--fade-to": at(lock - (CARD_TRAVEL_VH - CARD_FADE_VH) / CARD_SPEED),
    "--flat-from": at(lock - CARD_TRAVEL_VH),
    "--flat-to": at(lock - (CARD_TRAVEL_VH - CARD_FADE_VH)),
  };
};

/**
 * The offset a card carries as its range opens, unwound to nothing by its lock.
 *
 * Measured against where *sticky* would have put the card, not against its
 * slot, and negative because of it: over the {@link CARD_RUNWAY_VH} the range
 * spans, sticky carries the card that whole distance up the screen, and the
 * arrival is only meant to be {@link CARD_TRAVEL_VH} of it. So the card is held
 * the difference — 8vh at the current figures — *above* where flow has it, and
 * the keyframe gives that back as the range plays.
 */
const CARD_LIFT = vh(CARD_TRAVEL_VH - CARD_RUNWAY_VH) + "vh";

/**
 * Whether the browser can drive the pile from the scroll itself.
 *
 * The one thing that decides which of the two arrivals runs. Read after mount
 * rather than during render: the server cannot know it, and a `data-` attribute
 * that disagreed with the markup React sent would be a hydration mismatch.
 */
const canDriveFromScroll = () =>
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("animation-timeline: scroll()");

/**
 * Whether the deepest card still starts below the fold.
 *
 * The one thing anchoring to the slot costs: the spawn line walks down the
 * screen with the pile, so past a certain count the last card's would be off the
 * bottom of it — and a card that is meant to start appearing below the fold
 * instead enters already part-faded. Checked in development; see the warning in
 * <AboutContent />.
 */
const cardSpawnFitsVh = (count: number) => cardSpawnVh(Math.max(1, count) - 1);

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
  vh(80 + INTRO_HOLD_VH + i * (BEAT_VH + CARD_STEP_VH));

/** The scroll, measured from the section's top edge, at which card `i` pins. */
const cardLockVh = (i: number) => vh(cardFlowVh(i) - cardSlotVh(i));

/**
 * The section's own height, for <About /> to set on it.
 *
 * The section is pinned from `lg` up, so its height measures nothing about its
 * content — it is purely how much wheel the things inside it are given, which
 * is why it has to come off the two counts. Typed as a class, a fifth skill
 * would get the same height four of them share and every beat would shorten to
 * make room; a fourth stat box would have no scroll to arrive over.
 *
 * The cards decide the bulk of it and the stats the tail — see {@link restVh},
 * which is where the second count is spent, and which is the whole of the
 * difference the stats being scrolled in rather than played makes to the
 * page's length.
 *
 * The extra screen is not slack: the bottom of the page puts the fold on the
 * section's own end, so the last 100vh of any section can never be scrolled
 * *through*. Without it the final card would never reach its slot.
 */
export const sectionVh = (count: number, stats: number) =>
  vh(cardLockVh(Math.max(1, count) - 1) + 100 + restVh(stats));

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
 *
 * `cardFlowVh(i + 1) - cardFlowVh(i) - CARD_HEIGHT_VH`, written as the
 * subtraction rather than as the 11.1 it comes to, and it has to be: flow
 * spacing is what the lock timing is made of and is fixed at `BEAT + STEP`, so
 * a card given less height than the nominal {@link CARD_HEIGHT_VH} has to be
 * given exactly that much more gap, or every card below it flows early and
 * locks late. With the height and the step clamped the same way, the sum is
 * invariant and {@link cardLockVh} keeps telling the truth.
 */
const cardGap = (i: number, count: number) =>
  i === count - 1
    ? "0px"
    : `calc(${vh(BEAT_VH)}vh + ${CARD_STEP} - ${CARD_HEIGHT})`;

/* --------------------------------------------------------------------------
   Below `lg`

   Almost nothing, and that is the arrangement rather than an omission. The
   pile from `lg` up is three declarations and a page of arithmetic to place
   them; down here the cards are ordinary blocks in an ordinary column, so
   there is no slot to compute, no dwell to hold and no run-out to leave. The
   column is as tall as its content, and the reader scrolls it.

   The one figure left is what the page has to *end* on, the last block in the
   column being the last thing before <SiteNav />.
   -------------------------------------------------------------------------- */

/**
 * The room left under the last block in the column, which is what the page now
 * ends on.
 *
 * <SiteNav /> is fixed to the bottom left, so the last thing in the column has
 * to clear it: the bar's own inset (`--block-inset` below md, `1.5rem` from md
 * up — the larger of the two, one figure serving both), the bar itself (a
 * 2.5rem square below md, a row of links a shade under 3rem from md up), and a
 * little air over it. `1.25rem` of air is what "a little bit above the menu"
 * comes to at every width: enough to read as clearance, not enough to read as
 * a gap.
 */
const NAV_CLEAR_SM = "calc(max(var(--block-inset), 1.5rem) + 3rem + 1.25rem)";

/**
 * The scroll offsets stat box `i`'s arrival runs between, as CSS lengths — the
 * same shape as {@link cardRangeVh}, off the same measured `--about-top`, and
 * for the same reason: a scroll progress timeline is the document's, so its
 * range is in document coordinates and CSS cannot ask where the section starts.
 *
 * The whole of the count-off is here. One keyframe, one range per box, each
 * beginning {@link STATS_STAGGER_VH} later than the last — which is a stagger
 * expressed as geometry rather than as a delay, and is why the boxes unwind in
 * the right order on the way back up without anything being written twice. A
 * reversed timed stagger has to be asked for; a range simply reads backwards.
 *
 * `skills` is here because the anchor is the pile's end rather than anything
 * about the stats themselves: they start {@link STATS_LEAD_VH} after the last
 * card locks, so where they start moves with the card count. See {@link restVh}
 * for the runway this is spent out of.
 */
const statRangeVh = (i: number, skills: number) => {
  const start = vh(
    cardLockVh(Math.max(1, skills) - 1) + STATS_LEAD_VH + i * STATS_STAGGER_VH,
  );
  const at = (n: number) => `calc(var(--about-top) + ${vh(n)}vh)`;

  return {
    "--stat-from": at(start),
    "--stat-to": at(start + STATS_ARRIVE_VH),
  };
};

/**
 * The root the fallback's cue is watched against: the viewport, grown
 * {@link statsCueVh} taller at the bottom.
 *
 * A margin in `%` because that is all `rootMargin` takes, and a percentage
 * there is a share of the root's own height — which is the viewport, so it is a
 * `vh` by another name.
 */
const statsCueMargin = (stats: number) => `0px 0px ${statsCueVh(stats)}% 0px`;

/**
 * The scroll one element of the intro arrives over, as CSS lengths — the same
 * shape as {@link cardRangeVh} and {@link statRangeVh}, off the same measured
 * `--about-top`, and for the same reason: a scroll progress timeline is the
 * document's, so its range is in document coordinates and CSS cannot ask where
 * the section starts.
 *
 * One builder for all four groups, because the only thing that separates them
 * is where their range opens. What each one starts *from* is the other half of
 * the arrival and travels with the element — see `--copy-shift` in globals.css.
 *
 * Measured from the section's top edge, which from `lg` up is the moment the
 * still half pins: at 0 the composition has just landed and nothing in it will
 * move again on its own.
 */
const revealRangeVh = (start: number, run = COPY_ARRIVE_VH) => {
  const at = (n: number) => `calc(var(--about-top) + ${vh(n)}vh)`;

  return {
    "--reveal-from": at(start),
    "--reveal-to": at(start + run),
  };
};

/** Where word `i` of the headline begins to climb, and the range it climbs over. */
const wordStartVh = (i: number) => vh(COPY_LEAD_VH + i * WORD_STAGGER_VH);
const wordRangeVh = (i: number) =>
  revealRangeVh(wordStartVh(i), WORD_ARRIVE_VH);

/**
 * The old `settle` label: the scroll at which the headline's last word lands,
 * and so the moment the eyebrow and the paragraph close on it from either side.
 *
 * Derived from the word count rather than typed, exactly as the label was
 * placed at the end of the words' tween rather than at a delay guessed against
 * it — the handoff has to move with the copy, or a headline one line longer
 * hands off while it is still writing itself.
 */
const copySettleVh = (words: number) =>
  vh(wordStartVh(Math.max(1, words) - 1) + WORD_ARRIVE_VH);

/** The eyebrow's and the paragraph's shared range, hung off that settle. */
const copyRangeVh = (words: number) => revealRangeVh(copySettleVh(words));

/**
 * Meta row `i`, counting off a {@link META_LEAD_VH} behind the settle.
 *
 * The stagger is geometry here, the same way the stats' is: each row's range
 * opens a {@link ROW_STAGGER_VH} later than the last, so the three of them
 * unwind in the right order on the way back up with nothing having asked for
 * it. A timed stagger has to be reversed; a range is simply read backwards.
 */
const metaRangeVh = (i: number, words: number) =>
  revealRangeVh(vh(copySettleVh(words) + META_LEAD_VH + i * ROW_STAGGER_VH));

/**
 * The whole intro, end to end.
 *
 * The last thing to land is the last meta row, which is the one block hung
 * *behind* the settle rather than on it — so with a meta list rendered the run
 * is its lead and its count-off, and without one it is the settle itself. Both
 * then take the one arrival that every block below the words shares.
 */
const introRunVh = (words: number, rows: number) => {
  const settle = copySettleVh(words);
  const last =
    rows > 0 ? settle + META_LEAD_VH + (rows - 1) * ROW_STAGGER_VH : settle;

  return vh(last + COPY_ARRIVE_VH);
};

/**
 * The scroll the intro has to itself: card 0 starts climbing here.
 *
 * The composition's rule about these two blocks, and the mirror of
 * {@link STATS_LEAD_VH} at the other end of the section — nothing of the pile's
 * may start while the copy is still arriving. Checked in development; see
 * {@link useCopyReveal}, and {@link INTRO_HOLD_VH}, which is the knob that buys
 * the copy more of it.
 */
const pileStartVh = () => vh(cardLockVh(0) - CARD_RUNWAY_VH);

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
 * It is also why nothing in this hook may tween a *card* from `lg` up: up there
 * a card carries the stack driver's transform, and two writers on one property
 * is a fight neither wins. Below `lg` there is no driver — the stylesheet's
 * rules are behind a media query and {@link useCardArrival} stands down — so
 * the cards are the intro's alone, and it deals them in. See
 * {@link CARD_ENTER_X}.
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
 *
 * Seconds, so from `lg` up this is the fallback's copy of the movement: where
 * the browser can drive an animation from the scroll the same rise is spent as
 * {@link WORD_ARRIVE_VH} and {@link WORD_STAGGER_VH}, at the same ratio and in
 * the same order. Change one and change the other — they are one animation
 * written twice, in the two units the two paths have.
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
 * How a skill card enters below `lg`: in from the side, fading as it comes,
 * and the side alternating down the deck — card 0 from the left, card 1 from
 * the right, and so on.
 *
 * From `lg` up the pile arrives by being *scrolled*: every card rises into its
 * slot and the intro never touches it — see {@link STATS_SHIFT}. Below `lg`
 * there is no pile and no slot, so the column has to say something for itself,
 * and a block that only fades says the least of it. Dealt from alternating
 * sides it reads as a hand being laid out: the direction is what separates one
 * card from the next, and it is the one thing a fade cannot carry.
 *
 * A px figure rather than a share of the card, which is {@link COPY_SHIFT}'s
 * argument turned around. The card is a full-width block, so a percentage
 * would throw it a tenth of the way across a phone and a third of the way
 * across a tablet for the same declaration. This is a card being dealt, not a
 * card travelling, and a deal is the same length whatever it is dealt onto.
 *
 * Far enough that the card starts outside the column, which is why the pile
 * clips — see the `overflow-x-clip` on it, without which the throw is a page
 * that scrolls sideways for the length of one tween.
 */
const CARD_ENTER_X = 48;
const cardEnterX = (i: number) => (i % 2 ? CARD_ENTER_X : -CARD_ENTER_X);

/**
 * The deal itself: {@link COPY}'s curve, over a little longer because the
 * distance is a little further. `clearProps` for {@link CLEAR}'s reason, and
 * here it is the whole of why a card may be tweened at all — the transform is
 * gone by the time the card is at rest, so the hairline it is drawn with is
 * back on the pixel grid.
 */
const CARD_ENTER = {
  duration: 0.6,
  ease: "power2.out",
  clearProps: CLEAR,
} as const;

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
 * Below `lg` the cards arrive one at a time and under their own steam: there
 * is no sticky there, no pile, and nothing else to make them feel like they
 * arrived — so each is dealt in from its own side as it clears the fold. See
 * {@link CARD_ENTER_X}.
 *
 * The stats keep a settle on both sides. Theirs is one pinned box that holds
 * its place for the whole section rather than a pile moving through it, so
 * there is nothing for a transform to disturb — and they are the one block that
 * has to announce itself rather than simply having been there.
 *
 * It is also the distance they leave on, on both sides and by construction. In
 * the ranged version there is no "out" to write at all: a range read backwards
 * is the arrival backwards. In the fallback the same timeline is `reverse()`d
 * rather than rewritten. Either way the two cannot drift.
 *
 * Spent from the stylesheet from `lg` up, as `--stats-shift` — one figure, two
 * readers, so it is published to the markup rather than restated in CSS. See
 * {@link statRangeVh}.
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
 *
 * The fallback's, like {@link REVEAL} — {@link META_LEAD_VH} and
 * {@link ROW_STAGGER_VH} are the same two figures in `vh`. `ROW_STAGGER` is
 * still spent on the stats as well, which have no lead of their own down there.
 */
const META_LEAD = 0.15;
const ROW_STAGGER = 0.12;

/**
 * When the fallback fires.
 *
 * Two different questions on the two sides of `lg`, because the section is two
 * different shapes there — and from `lg` up a question only a browser that
 * cannot scroll the intro in still has to ask. Where the ranges take, there is
 * no trigger and no moment: the copy is at whatever point of its arrival the
 * scroll says it is.
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
  /**
   * The stats below `lg`, which are the one block the page *ends* on.
   *
   * A fifth of the viewport is the right crop for a block that scrolls through
   * it — the words rise where the reader is already looking. It is the wrong
   * one, and silently so, for a block that comes to rest a nav's height above
   * the fold and stops there: its top never reaches the crop line, the
   * observer never fires, and the boxes sit at the `opacity: 0` the intro
   * parks them at with nothing on screen to say why. That is exactly what a
   * phone was being shown: the section's last block, permanently blank, with
   * the reader already at the bottom of the page and nowhere left to scroll to
   * fix it. The one thing that would have cleared the crop is a screen of
   * empty page under the boxes, which is a whole viewport of nothing spent on
   * an observer's margin.
   *
   * So: no crop. The boxes count off as they crest the bottom edge, which is
   * also the first moment there is anything to look at.
   */
  statsSm: "0px",
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
   * The pinned box, and what the fallback's one trigger from `lg` up is
   * watched at — see {@link REVEAL_ROOT_MARGIN}. Unwatched where the intro is
   * ranged, which has no trigger to place at all.
   */
  still: RefObject<HTMLElement | null>;
  title: RefObject<HTMLElement | null>;
  eyebrow: RefObject<HTMLElement | null>;
  description: RefObject<HTMLElement | null>;
  /** the meta list at the top of the left column */
  meta: RefObject<HTMLElement | null>;
  /**
   * The column the cards stack in. Untouched from `lg` up, where the pile
   * arrives by being scrolled (see {@link STATS_SHIFT}); below it, what the
   * intro wants from this is the cards inside — see {@link CARD_ENTER_X}.
   */
  stack: RefObject<HTMLElement | null>;
  stats: RefObject<HTMLElement | null>;
  /**
   * The empty marker at the foot of the card column, whose approach to the
   * bottom of the page cues the stats where they cannot be scrolled in — see
   * {@link statsCueVh}, and `scrolled` for when that is. Unwatched otherwise,
   * and unwatched below `lg`, where there is no pile to wait for and the stats
   * take their own trigger.
   */
  statsCue: RefObject<HTMLDivElement | null>;
};

/**
 * The section's intro — the headline's words climbing out of their masks, the
 * eyebrow above and the paragraph below closing on them as they land, and the
 * meta list counting off at the top of the same column.
 *
 * From `lg` up, where the browser can drive an animation from the scroll, none
 * of that is a timeline. This hook splits the headline, works out where each of
 * the four groups arrives, and writes those ranges onto the elements for the
 * rule in globals.css to read — see {@link revealRangeVh}. The reader is the
 * clock and the only one, in both directions: scrolling on advances the intro
 * by exactly as much as was scrolled, and a reader who turns around halfway
 * through finds it exactly as far along as they left it.
 *
 * That is the third and last of the section's blocks to come off a clock. The
 * cards went first, then the stats, and the argument was the same each time: a
 * timeline fired at a line plays at its own pace from there, so it cannot be
 * scrolled through, scrolled back, or stopped by stopping. What survives of it
 * is the geometry — the same distances, the same order, the same handoff at the
 * headline's last word, restated in the units the scroll has.
 *
 * ── Everything below is the fallback ──────────────────────────────────────
 *
 * The timelines are kept for the two cases the stylesheet cannot serve: a
 * browser with no `animation-timeline`, and below `lg`, where the section is an
 * ordinary column rather than a pinned composition.
 *
 * That sequence is one timeline from `lg` up and several below it, for the same
 * reason {@link REVEAL_ROOT_MARGIN} is two figures. From `lg` up the section
 * arrives whole, every block already on screen behind the one trigger, so the
 * beats are spaced against *each other* — {@link META_LEAD} and friends are
 * what make three blocks read as one reveal rather than three.
 *
 * Below `lg` those same leads would be spacing beats against a clock while the
 * reader spaces them against the scroll: the section is a column taller than
 * the screen, and by the time the last beat played the cards would still be two
 * thumb-flicks below the fold, finished before they were ever seen. So each of
 * the column's blocks takes its own trigger at the same
 * {@link REVEAL_ROOT_MARGIN} `base` edge and plays as it clears the fold, and
 * the scroll does the spacing the leads do above. A card counts as a block for
 * that purpose: down there the pile is not one trigger but one per card, each
 * dealt in from its own side as the reader reaches it — see
 * {@link CARD_ENTER_X}.
 *
 * Every observer down there is a one-shot: it drops itself as it fires, so a
 * beat plays on the way down and stays played on the way back up. The stats are
 * the exception, and the only thing in the fallback that plays backwards as
 * well — they belong to the end of the pile, which the reader can leave again.
 * See the trigger below.
 *
 * ── Both paths ────────────────────────────────────────────────────────────
 *
 * The split is made once, up front, whichever path is taken. Splitting into
 * words rather than lines is what makes it safe to do before the display face
 * has swapped in: the masked words are inline-blocks and re-wrap on their own,
 * where a line split would be measured against the fallback and stay that way.
 *
 * The copy is a dependency, so an edit in Prismic re-splits rather than
 * animating spans that no longer hold it, and so are the two counts — the
 * stats' because the fallback reads the boxes off the list below, the skills'
 * because the pile is what the intro has to keep out of the way of.
 *
 * The headline is what the whole sequence hangs off — it carries the split, the
 * settle every other block is placed against, and the scope this runs in — so
 * with no headline rendered there is nothing for the rest to follow and it all
 * stays as typeset.
 */
function useCopyReveal(
  refs: RevealRefs,
  title: string,
  description: string,
  statCount: number,
  /**
   * The pile, which the intro has to be finished ahead of. Above `lg` this hook
   * leaves it alone entirely — the cards scroll in — and below `lg` it deals
   * them in one at a time; either way the count is what says how much scroll
   * card 0 leaves the copy, and a long enough headline can outgrow it. See the
   * warning below.
   */
  skillCount: number,
) {
  useGSAP(
    () => {
      const el = refs.title.current;
      if (!el) return;

      // whoever asked not to see things move gets the headline as typeset, with
      // nothing split, parked, marked or observed — same bargain as
      // <SolidIcon />. It is also the whole of the reduced-motion arm for the
      // ranged path below: an unmarked element is one the stylesheet never
      // finds, so there is no rule up there to write an exception to.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Read here rather than through `useBreakpoints`, the same way the motion
      // query above is: everything below is built once and left alone, so a
      // subscription would only re-render the section for a figure nothing
      // reads again. A resize across `lg` before the section has arrived keeps
      // the layout it mounted with — re-running the effect there would re-split
      // the headline and re-park its words on a viewport that has just changed
      // shape under the reader.
      const wide = window.matchMedia(LG_QUERY).matches;

      // Whether the intro belongs to the stylesheet rather than to this hook.
      //
      // Asked of the feature rather than of the armed attribute, which is not
      // set yet: `usePileTimeline` is a passive effect and this is a layout
      // one, so it has not run. If it later finds the ranges did not resolve it
      // disarms the section, and the copy is then simply there, unanimated —
      // which is the quiet failure to have, the loud one being a block that
      // stays invisible with nothing to say why.
      const scrolled = wide && canDriveFromScroll();

      // `mask` wraps each word in its own `overflow: clip` box — the hard edge
      // the words climb out from
      const split = SplitText.create(el, { type: "words", mask: "words" });

      // One on each side of the headline; the eyebrow is always there, the
      // paragraph is a field.
      const eyebrow = refs.eyebrow.current;
      const paragraph = refs.description.current;

      // The meta rows are read off their list rather than collected through
      // refs of their own: they're fixed markup, so the DOM already holds them
      // in order and a ref array would only restate it.
      const metaRows = refs.meta.current
        ? Array.from(refs.meta.current.children)
        : [];

      if (scrolled) {
        // ── the intro, driven from the scroll ─────────────────────────────
        //
        // Nothing is parked here and nothing is observed. The rule's
        // `animation-fill-mode: both` holds every element at its start pose
        // from the moment the section is armed, which is the parking; each
        // range opening is the trigger; and the distance between two of them is
        // the count-off. All this has to do is publish the geometry.
        const marked: HTMLElement[] = [];

        /**
         * Publishes one element's arrival — the scroll it plays over, and how
         * far from its place it starts. The attribute is what the stylesheet
         * finds it by, and what the cleanup takes back.
         */
        const arrive = (
          target: Element,
          range: Record<string, string>,
          shift: string,
        ) => {
          const node = target as HTMLElement;
          for (const [prop, value] of Object.entries(range)) {
            node.style.setProperty(prop, value);
          }
          node.style.setProperty("--copy-shift", shift);
          node.dataset.aboutReveal = "";
          marked.push(node);
        };

        const words = split.words.length;

        // A percentage rather than a length, which is {@link REVEAL_RISE}
        // measured against the word's own mask — the same figure the tween
        // spent as `yPercent`, and the reason the words can share a keyframe
        // with the blocks that move a fixed 16px.
        split.words.forEach((word, i) =>
          arrive(word, wordRangeVh(i), REVEAL_RISE + "%"),
        );

        // The handoff, in scroll rather than in seconds. Both blocks share the
        // one range and start from opposite sides of the headline, so they
        // still read as the copy gathering around it rather than as a third and
        // a fourth thing arriving.
        const settle = copyRangeVh(words);
        /*
         * Writing to elements held in the caller's refs, which the compiler
         * reads as a hook argument being modified. It is the same write
         * `gsap.set` makes on the other path and in the same place — this is a
         * layout effect, not render — and it is only visible to the rule here
         * because a style property set by hand is something it can see through
         * and a tween is not. The elements are the section's own DOM; nothing
         * React owns is touched.
         */
        /* eslint-disable react-hooks/immutability */
        if (eyebrow) {
          arrive(eyebrow, settle, -COPY_SHIFT + "px");
          // the one element whose fade does not end at 1 — see
          // {@link EYEBROW_OPACITY}, and the rule in globals.css
          eyebrow.style.setProperty(
            "--reveal-opacity",
            String(EYEBROW_OPACITY),
          );
        }
        if (paragraph) arrive(paragraph, settle, COPY_SHIFT + "px");

        metaRows.forEach((row, i) =>
          arrive(row, metaRangeVh(i, words), -COPY_SHIFT + "px"),
        );
        /* eslint-enable react-hooks/immutability */

        // The one thing this geometry cannot check for itself, and the only way
        // the intro can outgrow its runway: the stagger is spent per word now,
        // so a long enough headline is still writing itself as card 0 starts to
        // climb. Nothing breaks — the two simply overlap, where the composition
        // says the copy is finished before the pile begins.
        if (process.env.NODE_ENV !== "production" && skillCount > 0) {
          const run = introRunVh(words, metaRows.length);
          const room = pileStartVh();
          if (run > room) {
            console.warn(
              `<AboutContent />: the intro takes ${run}vh of scroll but the ` +
                `first card starts climbing at ${room}vh, so the copy is ` +
                `still arriving as the pile is — shorten the headline, tighten ` +
                `WORD_STAGGER_VH, or raise INTRO_HOLD_VH, which moves the ` +
                `whole pile later. See introRunVh.`,
            );
          }
        }

        return () => {
          for (const node of marked) {
            delete node.dataset.aboutReveal;
            node.style.removeProperty("--reveal-from");
            node.style.removeProperty("--reveal-to");
            node.style.removeProperty("--copy-shift");
            node.style.removeProperty("--reveal-opacity");
          }
          // puts the original text node back, taking the spans and everything
          // set on them with it
          split.revert();
        };
      }

      // ── the fallback, and the whole of the intro below `lg` ─────────────
      //
      // Here the elements are parked by script, because here it is script that
      // moves them. The words go to their start pose right away rather than on
      // the trigger: waiting for the trigger to park them would flash the
      // finished headline for a frame if the section were ever already on
      // screen.
      gsap.set(split.words, { opacity: 0, yPercent: REVEAL_RISE });
      if (eyebrow) gsap.set(eyebrow, { opacity: 0, y: -COPY_SHIFT });
      if (paragraph) gsap.set(paragraph, { opacity: 0, y: COPY_SHIFT });
      if (metaRows.length) {
        gsap.set(metaRows, { opacity: 0, y: -COPY_SHIFT });
      }

      // Below `lg` only, and the cards themselves rather than the column around
      // them: each is parked off to the side it will be dealt from. Above `lg`
      // the cards arrive by scrolling and the intro has nothing to say about
      // them — see {@link STATS_SHIFT} — and parking them here regardless would
      // leave the pile at `opacity: 0` for ever, since nothing up there would
      // then be tweening it back.
      const stack = refs.stack.current;
      const cards =
        !wide && stack
          ? Array.from(stack.querySelectorAll<HTMLElement>("[data-about-card]"))
          : [];
      if (cards.length) {
        gsap.set(cards, { opacity: 0, x: (i: number) => cardEnterX(i) });
      }

      // The stat boxes count off on a timeline in both of the cases that reach
      // this far: the browser that cannot scroll them in, and below `lg`, where
      // what they wait on is the last card rather than the whole pinned pile —
      // see the gate in that branch.
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
        // with the word count, exactly as {@link copySettleVh} does on the
        // other path — rather than at a delay guessed against it. Two tweens
        // off the one label rather than one over both, because they fade to
        // different places; the label is what keeps them together.
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

      /** One card, dealt in from its own side — see {@link CARD_ENTER_X}. */
      const cardBeat = (
        tl: gsap.core.Timeline,
        card: Element,
        at: gsap.Position,
      ) => {
        tl.to(card, { opacity: 1, x: 0, ...CARD_ENTER }, at);
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

      const whenVisible = (
        target: Element,
        play: () => void,
        crop: string = rootMargin,
      ) => {
        const io = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) return;
            io.disconnect();
            play();
          },
          { threshold: REVEAL_THRESHOLD, rootMargin: crop },
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

        // The stats. What this approximates is a scrub: the cue is placed at
        // the scroll the ranges would have opened at (see {@link statsCueVh})
        // and the beat then plays at its own pace from there instead of at the
        // reader's. Watched at a marker that never stops moving, so it at least
        // answers the moment the reader turns around rather than waiting out
        // the pinned pile.
        //
        // The one reveal here that is not a one-shot, and the only one that
        // should not be. Every other block plays as the section arrives and has
        // no reason to be undone — but the stats belong to the end of the pile,
        // and a reader who scrolls back up past it finishing ought to find them
        // gone, exactly as they found them the first time. A range does that by
        // simply being read backwards; a timeline has to be told, so it is
        // built once, paused, and driven both ways. `reverse()` runs that same
        // tween backwards — the fade, the rise and the stagger, in the other
        // order — which cannot drift from the animation in because it *is* the
        // animation in.
        const cue = refs.statsCue.current;
        if (cue && statBoxes.length) {
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
              rootMargin: statsCueMargin(statCount),
            },
          );
          io.observe(cue);
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
        // The stats, held behind the last card.
        //
        // The two triggers are only tens of pixels of scroll apart and they are
        // in the wrong order: the stats' own block crests the bottom edge while
        // the card above it is still short of the crop the cards are watched
        // through, so on the geometry alone the boxes would count off just
        // ahead of the card they belong behind. Not by enough to read as a
        // sequence — by exactly enough to read as a mistake.
        //
        // So the trigger says *when the stats may play* and this says *not
        // before the pile has been dealt*, which are two different questions
        // and were only ever one by accident. The gate keeps the reader's
        // scroll in charge either way: the boxes still wait for the fold, and a
        // reader who has already scrolled past the last card finds them playing
        // the moment it lands.
        //
        // What the gate leans on is that the last card is always *on* screen
        // once the stats are: the page ends a nav's clearance under them, so
        // there is not enough document left below that card to scroll it off
        // the top. Give the section a tail taller than a screen and that stops
        // being true — a reader could then be looking at the stats with the
        // card that releases them out of sight above, and the boxes would wait
        // for a trigger that never comes.
        let pileDealt = cards.length === 0;
        let statsCued = false;

        const playStats = () => statsBeat(gsap.timeline(), 0);
        const cueStats = () => {
          if (pileDealt) playStats();
          else statsCued = true;
        };
        const dealt = () => {
          pileDealt = true;
          if (statsCued) playStats();
        };

        // The pile: one trigger per card and one card per trigger, so the deck
        // is laid out down the column at the reader's own pace rather than
        // arriving as one block. Nothing is staggered here — the scroll is the
        // stagger, exactly as it is between the blocks above.
        //
        // A fling to the foot of the section fires several at once, which is
        // the same bargain every trigger in this branch makes: what it costs is
        // the order between two cards the reader crossed in one frame, and what
        // it buys is that nothing ever plays out of sight.
        cards.forEach((card, i) => {
          whenVisible(card, () => {
            const tl = gsap.timeline();
            cardBeat(tl, card, 0);
            if (i === cards.length - 1) tl.call(dealt);
          });
        });

        // the one block that ends the page, and so the one that cannot be
        // watched through the fold — see {@link REVEAL_ROOT_MARGIN}
        if (stats) whenVisible(stats, cueStats, REVEAL_ROOT_MARGIN.statsSm);
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

/**
 * The card arrival, measured off the scroll — and the fallback for it rather
 * than the way it normally runs. Where `animation-timeline: scroll()` exists
 * the pile is driven from globals.css instead and none of this is wired up at
 * all; see {@link usePileTimeline}, and {@link CARD_SPEED} for why that has to
 * be where the movement lives.
 *
 * What this cannot do is the half that sends the work to the stylesheet: a
 * climb slower than the scroll carrying it. A correction written from here is
 * the main thread's and the sticky position under it is the compositor's, and
 * on any frame this loop misses the two disagree by the whole of the
 * correction. So the fallback's cards arrive at sticky's own rate. They arrive
 * on the same beat, in the same place, over the same distance — only faster,
 * which is a thing nobody can notice without the other one beside it.
 *
 * ── Why this is not `animation-timeline: view()` ──────────────────────────
 *
 * It was, and the rule was the obvious one: a view-progress timeline on each
 * card, with {@link cardSpawnVh} and {@link cardSolidVh} turned into
 * percentages of its `cover` range. It is also silently wrong, because the
 * subject is `position: sticky` and a view timeline measures the box where it
 * is actually painted. A pinned card is still on screen, so its cover range is
 * stretched by the whole length of its pin — and the stops, computed as shares
 * of the range the card would have had if it had kept moving, then land nowhere
 * near where they were meant to.
 *
 * The pin is long, and longest for the first card, which holds its slot from
 * the moment it lands until the end of the section. Driving the real geometry
 * in Chrome 152 and reading back the screen position each card was at when its
 * fade began:
 *
 *     card   slot    fade begins at   travel   intended
 *       1    20.2vh      20.2vh        0.0vh    44.8vh
 *       2    26.3vh      39.6vh       13.3vh    44.8vh
 *       3    32.4vh      62.5vh       30.1vh    44.8vh
 *       4    38.5vh      75.7vh       37.2vh    44.8vh
 *
 * The arrival grows down the stack, and the first card does not arrive at all
 * so much as appear in place: it is already pinned when its fade starts, so it
 * brightens standing still — the one thing a scroll-linked fade exists to avoid.
 * Nothing about the stops was wrong; the range they were shares of was.
 *
 * It cannot be corrected from the stylesheet. The stretch is a function of how
 * long each card stays pinned, which is a function of the section's own height,
 * so compensating for it would tie every fade to {@link restVh} and to the
 * height of the list the cards are held in — and it is one browser's reading of
 * a corner the spec still has open, so the next one need not agree. A rect is
 * what the card is actually doing, and it costs one rAF.
 *
 * ── What it costs ─────────────────────────────────────────────────────────
 *
 * One `requestAnimationFrame` per scroll burst, and only while the pile exists
 * and is being looked at — never below `lg`, and never while the section is off
 * screen. Inside it, every `getBoundingClientRect` before any style is written:
 * read and write interleaved, each card would force the layout the one before it
 * had just dirtied, four times a frame, in the section that is also drawing a
 * WebGL scene.
 *
 * Measuring rather than deriving is the same argument as above. The positions
 * are all knowable from {@link cardFlowVh} and the section's page offset, but
 * that would be the layout restated in arithmetic — and restating the layout in
 * a form that then disagreed with it is exactly how the `view()` version got it
 * wrong. A rect is what the card is actually doing.
 *
 * ── The one thing it doesn't do ───────────────────────────────────────────
 *
 * The first frame after hydration is unfaded: this is a passive effect, so it
 * runs after the browser has painted once. It shows only on a reload with the
 * section already on screen, and the alternative — parking the cards at
 * `opacity: 0` in CSS and letting script reveal them — trades a frame for a
 * page that is blank without JavaScript. A frame is cheaper.
 */
function useCardArrival(
  /** where the handover is published — see {@link usePileTimeline} */
  sectionRef: RefObject<HTMLElement | null>,
  stackRef: RefObject<HTMLDivElement | null>,
  count: number,
) {
  useEffect(() => {
    const section = sectionRef.current;
    const stack = stackRef.current;
    if (!section || !stack || count === 0) return;

    const cards = Array.from(
      stack.querySelectorAll<HTMLElement>("[data-about-card]"),
    );
    if (cards.length === 0) return;

    // Both stops are the card's own rather than the pile's, which is what makes
    // every arrival the same length — see {@link CARD_TRAVEL_VH}. Held in `vh`
    // and turned into pixels inside the frame, since the viewport is the one
    // part of this that moves. Document order is pile order, so the index is
    // the card's place in it.
    const arrival = cards.map((_, i) => ({
      spawn: cardSpawnVh(i),
      solid: cardSolidVh(i),
    }));

    const wide = window.matchMedia(LG_QUERY);

    let frame = 0;

    /**
     * Whether this loop has actually written to the cards, and so whether there
     * is anything of its own to take back.
     *
     * It matters because below `lg` the cards are somebody else's: the intro
     * parks them off to the side and deals them in one at a time — see
     * {@link CARD_ENTER_X} — and this loop's `sync` runs there too, on every
     * crossing of the section's own visibility. Clearing unconditionally, it
     * would wipe that parking the first time the section came into view and
     * hand the reader the whole deck at once, face up.
     */
    let painted = false;

    /** Drops the inline opacity this loop wrote, and only that. */
    const clear = () => {
      if (!painted) return;
      painted = false;
      for (const card of cards) card.style.opacity = "";
    };

    const paint = () => {
      frame = 0;
      painted = true;

      const screen = window.innerHeight;

      // every read first — see above
      const tops = cards.map((card) => card.getBoundingClientRect().top);

      for (let i = 0; i < cards.length; i++) {
        const spawn = (arrival[i].spawn / 100) * screen;
        const solid = (arrival[i].solid / 100) * screen;

        // 0 at `spawn`, 1 at `solid`, held at both ends: a card is invisible
        // until it has risen to `spawn` and stays solid once past `solid`,
        // which is `animation-fill-mode: both` written out
        const at = (spawn - tops[i]) / (spawn - solid);
        const progress = at < 0 ? 0 : at > 1 ? 1 : at;

        // Opacity and nothing else. The climb is the stylesheet's alone — see
        // {@link CARD_SPEED} — so the fallback's cards ride sticky's own 1:1
        // and there is no transform here to write. Which is just as well: a
        // `translate` of any value, `0 0` included, is enough to make the card
        // a containing block and take its 1px borders off the pixel grid. See
        // {@link CLEAR}, which is the same argument about GSAP's leftovers.
        cards[i].style.opacity = String(progress);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const listen = () => {
      // adding a listener that is already on the same target, for the same
      // event, with the same options is a no-op, so `sync` can be called as
      // often as it likes
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
    };

    const deafen = () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };

    /**
     * When this runs at all, which is on two conditions rather than one.
     *
     * Below `lg` there is no pile — no sticky, no slots, the cards are ordinary
     * blocks in a column and the intro deals them in itself. So the
     * listeners come and go with the breakpoint rather than being filtered
     * inside the handler, and the inline styles go back on the way down: left
     * behind, a card that had faded in on a wide window would still be carrying
     * that opacity in a layout that never asked for it.
     *
     * And only while the section is on screen. A `scroll` listener is a
     * page-wide cost paid on every frame of every scroll, and the cards it moves
     * are inside one section that spends most of the page out of view — the same
     * argument ./aboutVisibility already makes for the ticker and the clock, and
     * the same store answers it. Its observer takes the section at `threshold:
     * 0` with no margin, so a card cannot be on screen when the flag is false.
     *
     * Leaving the screen does not clear: the cards should still be however the
     * scroll last left them when the reader comes back to them.
     */
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;

      // The stylesheet has the pile — see {@link usePileTimeline}, whose own
      // listener is registered before this one and so has already had its say
      // on the change that brought us here. A CSS animation outranks an inline
      // style, so the two running together would not actually fight; what it
      // would cost is a scroll listener and four rects a frame maintaining
      // styles nothing reads, which is the whole of what the handover saves.
      if (section.dataset.aboutTimeline !== undefined) {
        deafen();
        clear();
        return;
      }

      if (!wide.matches) {
        deafen();
        clear();
        return;
      }

      if (!aboutOnScreen()) {
        deafen();
        return;
      }

      listen();
      paint();
    };

    sync();
    wide.addEventListener("change", sync);
    const unwatch = onAboutVisibility(sync);

    return () => {
      cancelAnimationFrame(frame);
      wide.removeEventListener("change", sync);
      unwatch();
      deafen();
      clear();
    };
  }, [sectionRef, stackRef, count]);
}

/**
 * Hands the section's scroll-driven arrivals to the stylesheet, where the
 * browser can take them: the intro in the left column, the pile, and behind it
 * the stats.
 *
 * The scroll timelines in globals.css can say everything about those arrivals
 * except *where the section is*: a scroll progress timeline is the document's,
 * its range is in document coordinates, and CSS has no way to ask how far down
 * the page an element sits. So that one number is measured here and published
 * as `--about-top`, and the ranges in {@link revealRangeVh},
 * {@link cardRangeVh} and {@link statRangeVh} are written as it plus a figure
 * in `vh` — every other number in any of the three arrivals stays a constant
 * the stylesheet resolves for itself.
 *
 * One measurement for all of them, published on the *section* rather than on
 * any one block. They live in different subtrees — the copy is in the pinned
 * half on the left, the pile is a column on the right, the stats are their own
 * box beside it — and the figure is a fact about the section rather than about
 * any of them, so the element they all inherit from is where it belongs. It is
 * also what lets the attribute below arm and disarm the three together: they
 * are one geometry, and a browser that resolves the ranges for one resolves
 * them for all.
 *
 * It is the section's distance from the top of the *page*, so it moves whenever
 * anything above About changes height, not only when About does — hence the
 * observer on the documentElement as well as on the section. Both are watched
 * because either can move it without the other noticing: a rewrap in the hero
 * pushes the section down without resizing it, and a card count changing
 * resizes the section without moving it.
 *
 * The attribute it sets is both the switch and the whole of the handover:
 * {@link useCardArrival} reads it and stands down, so there is no state to keep
 * in step and no render spent saying which of the two is running. Whether the
 * rule actually took is then asked of an element rather than assumed — see
 * `ranged`, which is the difference between this degrading to the fallback and
 * it degrading to every card arriving over the whole length of the page.
 *
 * Nothing here runs per frame. The measurement is a rAF-coalesced reflow
 * handler, the same shape as the face slot's, and between reflows this hook
 * costs nothing at all — no scroll listener, no rects, no styles. That is the
 * entire point: the arrivals stop being work.
 */
function usePileTimeline(
  sectionRef: RefObject<HTMLElement | null>,
  count: number,
  stats: number,
) {
  useEffect(() => {
    const section = sectionRef.current;
    // No count guard: the intro reads this figure too, and the left column is
    // always rendered. It used to return early with neither the pile nor the
    // stats present, which was true then and is a section-wide blackout now —
    // the copy's ranges would resolve against `calc(0px + …)` and the whole
    // reveal would be placed somewhere near the top of the document.
    if (!section || !canDriveFromScroll()) return;

    const wide = window.matchMedia(LG_QUERY);
    let pending = 0;

    /**
     * Publishes the section's distance from the top of the page, then arms the
     * rule that reads it — strictly in that order. The other way round is not a
     * race that usually comes out right: it is a frame of every card playing
     * against `calc(0px + …)`, which puts the whole arrival somewhere near the
     * top of the document.
     */
    const measure = () => {
      pending = 0;
      // rounded because it is spent inside a `calc` several times per card, and
      // a sub-pixel scroll offset says nothing a reader can see
      const top = Math.round(
        section.getBoundingClientRect().top + window.scrollY,
      );
      section.style.setProperty("--about-top", top + "px");
      section.dataset.aboutTimeline = "";
    };

    /**
     * Whether the ranges actually took — asked of an element, not of the
     * feature.
     *
     * {@link canDriveFromScroll} can only answer for `animation-timeline`, and
     * that is not the whole of what globals.css asks for. The ranges are
     * `calc()` over a custom property, and an engine that took the timeline but
     * not the range would drop `animation-range` to its initial `normal` —
     * which is not a small degradation but the loudest one available, every
     * card playing its whole arrival across the entire length of the document.
     * No `@supports` test covers a declaration that specific, so the answer
     * comes from the computed style of a card that is really carrying it.
     *
     * A resolved range is a pair of lengths, so `px` is the whole of the test.
     *
     * The *longhand* is what it reads, and that matters. `animation-range` is a
     * shorthand, and a shorthand is the least portable thing to ask
     * `getComputedStyle` for — an engine that declines to serialize one hands
     * back `""`, which reads here as "the range didn't take" and bars a browser
     * that was driving the pile perfectly well. It fails to the fallback rather
     * than to something broken, so it would never show up as a bug; it would
     * just quietly cost that engine the composited arrival. The longhand is
     * always serialized, and asking for it costs exactly the same.
     *
     * A card if there is one, a stat box or a marked word otherwise. All three
     * carry the same kind of declaration off the same custom property, so any
     * of them answers for the rest — and a section with stats but no skills, or
     * with neither, would have no card to ask.
     *
     * The words are there to be asked by the time this runs: they are marked
     * from {@link useCopyReveal}, which is a layout effect, and this is a
     * passive one.
     */
    const ranged = () => {
      const subject = section.querySelector<HTMLElement>(
        "[data-about-card], [data-about-stat], [data-about-reveal]",
      );
      return (
        !!subject &&
        getComputedStyle(subject)
          .getPropertyValue("animation-range-start")
          .includes("px")
      );
    };

    /**
     * Re-measures, and re-decides whether the stylesheet keeps the arrivals.
     *
     * Below `lg` the rules sit behind a media query, so there is nothing to
     * verify and nothing to hand back — {@link useCardArrival} idles and clears
     * there too, and the stats take their own trigger. The check is asked only
     * where its answer means something, and asked again if the reader resizes
     * into it.
     */
    const sync = () => {
      measure();
      if (wide.matches && !ranged()) delete section.dataset.aboutTimeline;
    };

    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(sync);
    };

    sync();

    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    observer.observe(section);
    window.addEventListener("resize", schedule, { passive: true });
    wide.addEventListener("change", sync);

    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      wide.removeEventListener("change", sync);
      delete section.dataset.aboutTimeline;
      section.style.removeProperty("--about-top");
    };
  }, [sectionRef, count, stats]);
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
 * There is no first-card special case. Card 0 starts a screen and a hold below
 * the section's top edge like every other card starts a beat below the one
 * before it — see {@link cardFlowVh} — so it rises into its slot on the scroll
 * rather than being there when the section lands. It falls out of the same rule
 * as the rest instead of being exempted from it, which is what let the fade it
 * used to need to arrive on go away.
 *
 * `z-index` is the stacking order itself: later cards paint over earlier ones,
 * which is what turns four overlapping boxes into a pile rather than a mess.
 *
 * Below `lg` none of this applies — every `lg:` prefix above says so — and the
 * card is an ordinary block in the column, open, at its natural height. There
 * is nothing to stack against down there: the still half is not pinned, the
 * section has no height of its own, and a deck held against the foot of a
 * phone's screen is a screen the reader has to scroll past twice. So the cards
 * simply follow each other down the page, which is also the only reading order
 * a narrow column has.
 *
 * `relative` at that width for the solid below, which is placed against the
 * card's own box — from `lg` up `sticky` is what makes the card a containing
 * block, and in flow nothing would.
 */
function SkillCard({
  index,
  count,
  skill,
  description,
}: {
  index: number;
  count: number;
  skill: KeyTextField;
  description: KeyTextField;
}) {
  return (
    <li
      // the hook {@link useCardArrival} collects the pile by, in document
      // order, which is pile order
      data-about-card=""
      style={
        {
          // All three clamped rather than plain `vh` — see {@link CARD_HEIGHT}
          // for why a portrait viewport cannot be given the figures a
          // landscape one is, and for why the scroll arithmetic does not care.
          "--slot": cardSlot(index),
          "--card-h": CARD_HEIGHT,
          "--header-h": CARD_STEP,
          // a beat's worth of runway for every card but the last, whose gap is
          // the run-out that keeps the finished pile pinned — see
          // {@link cardGap}, which carries the card's clamped height back out
          // so the flow spacing the lock is measured against stays put
          "--gap": cardGap(index, count),
          // the scroll this card's arrival plays over, for the timeline in
          // globals.css — inert until <AboutContent /> arms it, and ignored
          // entirely by the rAF fallback
          ...cardRangeVh(index),
          zIndex: index,
        } as CSSProperties
      }
      className={
        "pointer-events-auto relative mb-3 border-2 rounded-sm lg:rounded-none lg:border-0 lg:border-y-2 border-white " +
        PLATE +
        " lg:sticky lg:top-(--slot) lg:mb-(--gap) lg:h-(--card-h)"
      }
    >
      {/* The header row. Its height *is* {@link CARD_STEP_VH} from `lg` up --
          that equality is what a collapsed card in the pile shows. */}
      <div className="flex pt-6 pb-14 items-center gap-3 px-[5%] lg:pt-0 lg:pb-0 lg:h-(--header-h) lg:gap-2">
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
            " truncate font-extrabold text-white text-lg 2xl:text-xl"
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
            " px-[5%] pb-6 tracking-normal md:pr-[25%] lg:absolute lg:bottom-[14%] lg:left-[5%] lg:w-[67%] xl:w-[62%] lg:p-0 text-sm 2xl:text-sm short:w-[72%]"
          }
        >
          {description}
        </p>
      )}

      {/* The sky's solids, a different one on each card and each turning at its
          own rate — see <SolidIcon />. It replaces the design's placed bitmap,
          which is a reference crop and already soft at this size.

          Square, so its height decides its width — and the width is the half
          that has to be answered for, because the blurb is beside it and not
          under it. 86% of the card is 33% of the column on the design frame
          and two thirds of it on a portrait tablet, so the height carries the
          same figure a second time as a ceiling in `vw`: 0.86 * 20vh at
          1519:947. The clamp on {@link CARD_HEIGHT} shortens the card; this is
          what keeps the solid from simply filling the shorter card instead.

          `short:` is left as the plain percentage, and overrides this outright
          — a card that is already at its `vh` height there (see
          {@link CARD_HEIGHT}) wants the shorter solid the variant was added
          for, not a second clamp on top of it. */}
      <SolidIcon
        kind={solidForRow(index)}
        seed={index}
        className="pointer-events-none absolute right-[4%] bottom-4 size-16 text-white hidden md:block md:aspect-square md:w-auto md:h-[calc(0.6*var(--card-h))] lg:top-1/2 lg:bottom-auto lg:aspect-square lg:h-[min(calc(0.86*var(--card-h)),8.8vw)] lg:w-auto lg:-translate-y-1/2 short:h-[50%] short:top-[60%]"
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
  const statsCueRef = useRef<HTMLDivElement>(null);

  useCopyReveal(
    {
      still: stillRef,
      title: titleRef,
      eyebrow: eyebrowRef,
      description: descriptionRef,
      meta: metaRef,
      stack: stackRef,
      stats: statsRef,
      statsCue: statsCueRef,
    },
    title ?? "",
    description ?? "",
    numbers.length,
    skills.length,
  );

  // The section's three scroll-driven arrivals — the copy, the pile, and the
  // stats behind it — armed from one measurement. See {@link CARD_SPEED} for
  // why the pile's fallback differs in the movement itself rather than only in
  // where the work happens, and `scrolled` in {@link useCopyReveal} for the
  // other two, which keep the timelines they used to run on for the browsers
  // that need them.
  usePileTimeline(sectionRef, skills.length, numbers.length);
  useCardArrival(sectionRef, stackRef, skills.length);

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
    if (fits > 100) {
      console.warn(
        `<AboutContent />: ${skills.length} skill cards make a pile ${fits}vh ` +
          `tall, which is more than the screen. The lower cards will lose their ` +
          `pinning and the last will grow through the stats — see stackFitsVh.`,
      );
    }

    // The other end of the same problem: the arrivals are measured from the
    // slots, so the spawn line walks down the screen with them and eventually
    // walks off it.
    const spawn = cardSpawnFitsVh(skills.length);
    if (spawn > 100) {
      console.warn(
        `<AboutContent />: with ${skills.length} skill cards the last one ` +
          `starts appearing at ${spawn}vh, which is below the fold. It will ` +
          `enter the screen already part-faded — shorten CARD_TRAVEL_VH or ` +
          `CARD_STEP_VH. See cardSpawnFitsVh.`,
      );
    }

    // And the invariant that used to hold by construction, back when an arrival
    // cost exactly its own height in scroll: a slower card needs more of the
    // beat to arrive in, and can run out of it.
    const dwell = cardDwellVh();
    if (dwell < 0) {
      console.warn(
        `<AboutContent />: at CARD_SPEED ${CARD_SPEED} an arrival takes ` +
          `${CARD_RUNWAY_VH}vh of scroll, which is ${-dwell}vh more than the ` +
          `beat between two cards, so two will be climbing at once — raise ` +
          `BEAT_VH or CARD_SPEED. See cardDwellVh.`,
      );
    }
  }, [skills.length]);

  const iconSize = "size-4 shrink-0 xl:size-5 2xl:size-6";
  const metaText =
    CAPS + " " + MUTED + " text-xs lg:text-xs xl:text-[0.8125rem] 2xl:text-sm";

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
        className="pointer-events-none relative flex min-h-screen w-full flex-col justify-center gap-5 px-(--block-inset) pt-[6vh] pb-16 sm:gap-6 lg:sticky lg:top-0 lg:block lg:h-screen lg:min-h-0 lg:gap-0 lg:px-0 lg:pt-0 lg:pb-0"
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
          className="space-y-2 order-2 lg:absolute lg:top-[10%] lg:left-[4.2%] lg:space-y-3"
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
          <div className="mb-6 order-1 lg:absolute lg:bottom-[11.2%] lg:left-[3.7%] lg:mb-0 lg:w-[31.9%]">
            <Eyebrow ref={eyebrowRef}>who i am</Eyebrow>

            {/* the design breaks this over four lines, but a Text field is one
                line in the editor, so the breaks are the column's to make — it
                is sized to wrap the copy the same way. `pre-line` is there for
                the author who does get a newline in. */}
            {title && (
              <h2
                ref={titleRef}
                className={
                  "font-display mt-3 font-extrabold text-white " +
                  CAPS +
                  " " +
                  LEADING +
                  " text-lg tracking-normal whitespace-pre-line lg:text-xl xl:text-2xl 2xl:text-[1.75rem] short:text-lg shorter:text-[0.85rem]"
                }
              >
                {title}
              </h2>
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
                  " text-sm tracking-normal lg:max-w-[93%] lg:text-sm xl:mt-5 xl:text-base 2xl:mt-6 2xl:text-lg short:text-sm shorter:text-[0.75rem]"
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

            The last block in the column and in ordinary flow, so the head
            leaves the screen the way everything above it does — the cards below
            follow it up the page rather than out from under it. `order-3`
            because the two blocks above are ordered too, and an unordered box
            among them would sort to the front.

            Gone from `lg` up, where the face is back to the world position it is
            authored at and the blocks are placed around it. `display: none`
            takes the box away entirely, which is what ./faceSlot reads as "no
            column to sit in" — so the two halves stay in step through a resize
            across the breakpoint. */}
        <div
          ref={publishFaceSlot}
          aria-hidden
          className="order-3 mt-[8vw] aspect-[784/1519] w-[min(66vw,37vh)] shrink-0 self-center lg:hidden"
        />
      </div>

      {/* — the pile ------------------------------------------------------ */}
      {/* From `lg` up the intro never touches this: the cards scroll in, which
          is an entrance already. See {@link SkillCard} and {@link STATS_SHIFT}.
          Below `lg` the cards are dealt in from alternating sides instead, one
          at a time as each clears the fold — see {@link CARD_ENTER_X}.

          Which is what the clip is for: a card starts its tween further out
          than the column is wide, and an overflowing box below `lg` is a page
          that scrolls sideways. `clip` rather than `hidden` because hidden
          makes a scroll container of the box, and a scroll container is the one
          thing the pinned cards inside it cannot be pinned against — gone from
          `lg` up regardless, where nothing here moves sideways at all. */}
      {skills.length > 0 && (
        <div
          ref={stackRef}
          // The distance every card is held above its slot as its range opens;
          // the ranges themselves are per-card and sit on the cards. Set here
          // rather than in globals.css so the arithmetic stays in one file with
          // the constants it is made of — the stylesheet holds no geometry.
          //
          style={{ "--about-lift": CARD_LIFT } as CSSProperties}
          className={rightColumn + " overflow-x-clip lg:overflow-x-visible"}
        >
          {/* The one figure the pile cannot be laid out without.

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
            style={
              {
                "--lead": cardFlowVh(0) + "vh",
              } as CSSProperties
            }
            className="lg:h-full lg:pt-(--lead)"
          >
            {skills.map(({ skill, description }, i) => (
              <SkillCard
                // a group item carries no id of its own, and position is the
                // only thing that identifies a card here — it is also the
                // card's place in the pile, so this key is load-bearing
                key={i}
                index={i}
                count={skills.length}
                skill={skill}
                description={description}
              />
            ))}
          </ul>

          {/* The stats' cue, for browsers that cannot scroll them in: an empty
              marker sitting at the foot of the column, which the list above
              fills exactly. Everything else down here is pinned and therefore
              still, so this is the only thing left that keeps moving with the
              page — which is what lets that fallback answer a change of
              direction rather than waiting out the pile. See
              {@link statsCueVh}. */}
          <div
            ref={statsCueRef}
            aria-hidden
            className="hidden lg:block lg:h-px"
          />
        </div>
      )}

      {/* — my stats ------------------------------------------------------ */}
      {/* Its own full-height box with one sticky child, so it pins near the
          foot of the screen and holds there for the rest of the section without
          taking any of the flow the pile beside it needs.

          Sticky from flow 0, so it is pinned the moment the section lands and
          never moves again — what says *when* it appears is the scroll, on a
          range per box that opens once the pile has finished (see
          {@link statRangeVh}). Position and timing kept apart like that is what
          lets it arrive without sliding: the box does not travel to get here,
          it rises the last {@link STATS_SHIFT} into a place it already had. */}
      {numbers.length > 0 && (
        <div
          // Below `lg` the page ends here, so this block is what stands
          // between the stats and <SiteNav /> — carried as padding rather than
          // as a floor under the block, because what the design asks for is
          // room *under the boxes* and their own height is theirs to decide,
          // however many of them the author gives. See {@link NAV_CLEAR_SM}.
          // From `lg` up the block is placed rather than in flow and the
          // section's own height carries the room, so the padding goes.
          style={{ "--nav-clear-sm": NAV_CLEAR_SM } as CSSProperties}
          className={rightColumn + " pb-(--nav-clear-sm) pt-8 lg:pt-0 lg:pb-0"}
        >
          <ul
            ref={statsRef}
            style={
              {
                "--stats-top": STATS_TOP_VH + "vh",
                // the rise, shared by every box; the ranges are per box and sit
                // on the boxes. Here rather than in globals.css for the same
                // reason `--about-lift` is on the pile — the stylesheet holds
                // no geometry.
                "--stats-shift": STATS_SHIFT + "px",
              } as CSSProperties
            }
            className="grid grid-cols-3 gap-2 lg:sticky lg:top-(--stats-top) lg:gap-[0.75vw]"
          >
            {numbers.map(({ number, label }, i) => (
              <li
                key={i}
                // the hook and the stylesheet both find the boxes by this, the
                // same way they find the cards
                data-about-stat=""
                style={statRangeVh(i, skills.length) as CSSProperties}
                className={
                  "pointer-events-auto flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-white " +
                  PLATE +
                  " px-2 py-3 text-center lg:h-[14.3vh] lg:gap-3 lg:py-4 short:gap-1"
                }
              >
                <span
                  className={
                    "font-display " +
                    LEADING +
                    " font-extrabold text-white text-2xl lg:text-3xl xl:text-4xl 2xl:text-[2.75rem]"
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
                    " text-xs xl:text-xs 2xl:text-base"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* With no stats under them the cards are the last block in the column,
          so the clearance the stats carry as padding becomes a box of its own
          — the same figure, the same reason. See {@link NAV_CLEAR_SM}. */}
      {numbers.length === 0 && skills.length > 0 && (
        <div
          aria-hidden
          style={{ height: NAV_CLEAR_SM }}
          className="lg:hidden"
        />
      )}
    </>
  );
}
