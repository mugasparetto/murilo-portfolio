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
import { publishFaceSlot } from "./AboutOverlay";
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
 * Below `lg` the blocks stack into a single column, traced off the mobile draft
 * (node 1398-689, a 375 x 1417 frame): who i am, the stat cards, the face, then
 * the skills list with the meta list under it. The stat cards are the one block
 * that changes shape rather than just size — stacked number-over-label and
 * three across, they cost ~80px instead of ~180.
 *
 * That column is about 1.7 screens tall on a phone, and it is meant to be. The
 * face sits in the middle of it at the draft's proportions, and the whole thing
 * scrolls through the section rather than being pinned to one viewport: see
 * <AboutOverlay />, whose layer is sized by this column below `lg` and travels
 * with the page scroll, and <Scene />, which puts the head in the box reserved
 * for it here. Everything only fits one pinned screen if the head is shrunk to
 * about a thumbnail, which is not what the draft asks for — measured against
 * the real faces, the four blocks of copy already take ~630px of the ~700 a
 * phone has.
 *
 * The foot of the column clears <SiteNav /> — a bar across the bottom at `md`,
 * a hamburger in the corner below it — so the meta list can't land on top of it
 * at the end of the travel.
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
 * The translucent black behind the stat cards and the skills rows.
 *
 * ── No backdrop-filter here, and it must not come back ────────────────────
 *
 * The design draws these as frosted glass, and they were `backdrop-blur-lg`
 * until it turned out to be most of the section's frame budget. The reason is
 * structural rather than a matter of degree: this layer is DOM over a canvas
 * that fills the viewport, so a backdrop-filter's backdrop *is* the scene. A
 * backdrop-filter is a draw-time compositor operation with no cross-frame
 * cache — if a frame is produced and the element is in it, the filter runs.
 * Whether the element moved is irrelevant, so <AboutOverlayDriver />'s careful
 * "skip the write if nothing changed" buys nothing at all here. And a frame is
 * always produced: <Postprocessing /> ends on `<Noise />`, which reseeds every
 * pixel on the canvas every frame, for ever, even with the camera at rest.
 *
 * Seven of them, at 82fps, each re-sampling its own box grown by three sigma
 * on every side — `blur(16px)` is sigma, not a radius, so that's ±48px — and
 * at the browser's device scale factor, which `dpr={[1, 1.5]}` doesn't clamp:
 * that only sizes the WebGL drawing buffer. Which is also why the harness's
 * `5` can't shift this cost, and why it lands in `other` rather than `js` or
 * `gpu` — see <Diagnostics />.
 *
 * Opacity does the legible half of the job on its own, which is the half that
 * matters. From `lg` up the cards sit at the left edge and the skills at the
 * right, over the black backdrop plane, a grid that fades to 0.1 out there and
 * the vignette's darkest band — blurring near-black returns near-black, so the
 * design's own 40% stands and nothing visible changed. Below `lg` the column
 * stacks squarely onto the face, where white caps over the holographic bands
 * need the extra 20% to read.
 *
 * NB the two blocks that are nothing but type — "who i am" and the stats
 * eyebrow — still carry no backing at any width, which on a phone puts them
 * straight onto the face. That predates this and is a design call, not a
 * performance one; if they should have a plate below `lg`, this is it.
 */
const PLATE = "bg-black/40 backdrop-blur-lg";

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
 * <AboutContent /> holds three cards, four rows, four turning solids and three
 * inline icons, none of which have anything to say about the time — and every
 * one of them was being reconciled once a second, for ever, to change eight
 * characters. Held down here, the rest of the tree re-renders only when the
 * copy changes, which at runtime is never.
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
 * The stat cards are a set, and a set is worth counting off: their eyebrow
 * leads, taking the same drop the "who i am" one takes, and the cards follow
 * row by row.
 *
 * The skills list is the same kind of set, but from `lg` up it doesn't get the
 * same treatment — there it travels whole, eyebrow and rows together, because
 * what it has to do at that size is arrive level with the face beside it, as
 * one labelled object. Below `lg` there is no face to be level with and the
 * list is the last thing in the column, coming up under a thumb a row at a
 * time, so it counts off exactly as the cards do.
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
 * `ROW_LEAD` sets the stats block off against the skills one beside it, so the
 * two halves of that beat don't start together.
 *
 * `CARD_LEAD` is the gap inside the stats block: the cards start while their
 * eyebrow is still moving, which is what keeps the label and the set it labels
 * reading as one thing. It's the one figure here that holds below `lg` too,
 * where the block plays on its own arrival and has nothing to be spaced
 * against — see {@link useCopyReveal}. `ROW_STAGGER` is short enough that three
 * cards are done well inside the tween's own half-second — it's a count-off,
 * not a queue.
 */
const BLOCK_LEAD = 0.35;
const ROW_LEAD = 0.35;
const CARD_LEAD = 0.2;
const ROW_STAGGER = 0.2;

/**
 * When it fires. "The section is visible" is just the title's own box entering
 * the viewport — an IntersectionObserver reads the layer's transform for free,
 * where a scroll position would have to be re-derived from the camera.
 *
 * The bottom margin is the whole of the timing, and it is a different figure
 * on each side of `lg`, because the layer underneath moves differently on each
 * side of it — see <AboutOverlay />.
 *
 * From `lg` up the layer is exactly one viewport and is slid into place as a
 * unit by <AboutOverlayDriver />: the title never scrolls past the reader, it
 * arrives with the whole section at once. So the root is cropped hard, and the
 * section has to be most of the way in before the title crosses what's left of
 * the bottom edge — rather than firing the moment the block clears the bottom
 * of the window, with nowhere yet to be seen rising into.
 *
 * Below `lg` the layer is the column's own height, a good deal taller than one
 * screen, and once the section has arrived it carries on up a pixel per pixel
 * scrolled. The title enters from the bottom like ordinary page content, and
 * the crop above turns into the wrong instruction there: it would hold the
 * words parked while the reader watched an empty block travel most of the
 * screen, then play them as they left the top of it. A sixth of the viewport
 * is the ordinary “clear the fold by about a line” trigger — the words rise
 * where the reader is already looking, with the whole screen below them left
 * for the beats hung behind the title.
 *
 * Threshold stays at 0 on both. With the root cropped at all, asking for a
 * *share* of the title to be inside it couples the timing to how many lines
 * the copy happens to take, and from `lg` up a title taller than what's left
 * of the root would never reach the ratio at all. At 0 it's the top edge
 * crossing that fires it, which is the same moment whatever the copy does.
 */
const REVEAL_ROOT_MARGIN = {
  base: "0px 0px -20% 0px",
  lg: "0px 0px -65% 0px",
} as const;
const REVEAL_THRESHOLD = 0;

/** `lg`, as BREAKPOINTS has it — the width the layer changes shape at. */
const LG_QUERY = "(min-width: 64rem)";

/**
 * The elements the reveal writes to. An object rather than six positional
 * parameters: they are all `RefObject<HTMLElement | null>` at the call site,
 * so a list of them is a list of things that would swap silently.
 */
type RevealRefs = {
  title: RefObject<HTMLElement | null>;
  eyebrow: RefObject<HTMLElement | null>;
  description: RefObject<HTMLElement | null>;
  /** the block, which is what travels from `lg` up */
  skills: RefObject<HTMLElement | null>;
  /** and the two pieces inside it, which are what travel below `lg` */
  skillsEyebrow: RefObject<HTMLElement | null>;
  skillsList: RefObject<HTMLElement | null>;
  statsEyebrow: RefObject<HTMLElement | null>;
  stats: RefObject<HTMLElement | null>;
};

/**
 * Plays {@link REVEAL} over the words of `refs.title` the first time the
 * section comes into view, {@link COPY} over the two blocks around it as that
 * finishes, and {@link BLOCK_SHIFT} over the skills list and the stat cards
 * behind that — once, and only then: each observer is dropped as it fires, so
 * scrolling back up doesn't replay it.
 *
 * That sequence is one timeline from `lg` up and three below it, for the same
 * reason {@link REVEAL_ROOT_MARGIN} is two figures. From `lg` up the section
 * arrives whole, every block already on screen behind the one trigger, so the
 * beats are spaced against *each other* — {@link BLOCK_LEAD} and friends are
 * what make three blocks read as one reveal rather than three.
 *
 * Below `lg` those same leads would be spacing beats against a clock while the
 * reader spaces them against the scroll: the section is a column taller than
 * the screen, and by the time the last beat played the skills list would still
 * be two thumb-flicks below the fold, finished before it was ever seen. So
 * each of the column's three blocks takes its own trigger at the same
 * {@link REVEAL_ROOT_MARGIN} `base` edge and plays as it clears the fold, and
 * the scroll does the spacing the leads do above.
 *
 * What doesn't come apart is what's inside a block: the words still hand off
 * to the eyebrow and paragraph closing on them, and both lists still count off
 * behind their own eyebrow at {@link CARD_LEAD}. Those pairs sit within a few
 * lines of each other on a phone, so they arrive together whatever the reader
 * does — it's only the blocks, a screen or more apart in the column, that the
 * scroll has any say over.
 *
 * The skills block is the one that also changes *what* it moves: a single
 * object from `lg` up, an eyebrow and a list of rows below it — see
 * {@link BLOCK_SHIFT}.
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
  skillCount: number,
) {
  useGSAP(
    () => {
      const el = refs.title.current;
      if (!el) return;

      // whoever asked not to see things move gets the title as typeset, with
      // nothing split, parked or observed — same bargain as <SolidIcon />
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Read here rather than through `useBreakpoints`, the same way the motion
      // query above is: everything below is built once and dropped as it fires,
      // so a subscription would only re-render the section for a figure nothing
      // reads again. A resize across `lg` before the section has arrived keeps
      // the layout it mounted with — re-running the effect there would re-split
      // the title and re-park its words to move the triggers, on a viewport that
      // has just changed shape under the reader.
      //
      // It decides both when the beats fire and, for the skills block, what
      // they move: see the parking below.
      const wide = window.matchMedia(LG_QUERY).matches;

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

      // The last beat's targets. The rows and the cards are both read off
      // their list rather than collected through refs of their own: they are a
      // `map` over a repeatable group, so the DOM already holds them in order
      // and a ref array would only restate it. `statCount` and `skillCount`
      // are dependencies for exactly this reason — an item added in Prismic has
      // to be picked up here, not left as the one row that never moves.
      const skills = refs.skills.current;
      const skillsEyebrow = refs.skillsEyebrow.current;
      const rows = refs.skillsList.current
        ? Array.from(refs.skillsList.current.children)
        : [];
      const statsEyebrow = refs.statsEyebrow.current;
      const cards = refs.stats.current
        ? Array.from(refs.stats.current.children)
        : [];

      // The stats block is always its eyebrow and its cards, one labelling the
      // other. The skills block is that below `lg` and a single object above
      // it, which is the one place the two layouts differ in what they move
      // rather than only in when.
      //
      // From `lg` up it's parked at the wrapper, so the eyebrow rides along
      // inside it — the rule keeps the 0.72 its class gives it instead of being
      // tweened to it, and the block arrives whole, level with the face beside
      // it. Below `lg` there's no face to be level with and the list is the
      // last thing in the column, arriving a row at a time under a thumb: the
      // rows are worth counting off there exactly as the cards are, and a
      // wrapper parked over them would be a second opacity and a second
      // transform on top of the ones each row is already carrying.
      if (wide) {
        if (skills) gsap.set(skills, { opacity: 0, x: BLOCK_SHIFT });
      } else {
        if (skillsEyebrow) {
          gsap.set(skillsEyebrow, { opacity: 0, y: -COPY_SHIFT });
        }
        if (rows.length) gsap.set(rows, { opacity: 0, x: BLOCK_SHIFT });
      }

      if (statsEyebrow) gsap.set(statsEyebrow, { opacity: 0, y: -COPY_SHIFT });
      if (cards.length) gsap.set(cards, { opacity: 0, x: -BLOCK_SHIFT });

      // The three beats, each written once against a timeline the caller
      // hands it. That's what lets the same tweens be one sequence from `lg`
      // up and three separate plays below it, rather than the two layouts
      // keeping two copies of the motion in step by hand.
      //
      // The two that can land anywhere take the position they start at and
      // put their own label there, so the tweens inside them stay related to
      // each other wherever the beat itself falls. The copy beat takes none:
      // it heads its timeline in both layouts.

      /** The title's words, and the eyebrow and paragraph closing on them. */
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

      /**
       * An eyebrow and the set it labels, counting off behind it: the stat
       * cards always, and the skills rows below `lg`. One function because
       * they are the same object — a rule, a label, and a short list under it
       * — and should be read as one wherever both are on screen.
       *
       * Both tween to the same rest pose, so the side each travels in from is
       * the parking's to say rather than this function's: the cards enter from
       * the left of the frame, the skills rows from the right, each keeping
       * the direction the design gives its block.
       */
      const listBeat = (
        tl: gsap.core.Timeline,
        at: gsap.Position,
        label: string,
        eyebrowEl: HTMLElement | null,
        items: Element[],
      ) => {
        tl.addLabel(label, at);
        if (eyebrowEl) {
          tl.to(eyebrowEl, { opacity: EYEBROW_OPACITY, y: 0, ...COPY }, label);
        }
        if (items.length) {
          tl.to(
            items,
            { opacity: 1, x: 0, ...COPY, stagger: ROW_STAGGER },
            `${label}+=${CARD_LEAD}`,
          );
        }
      };

      /** The stats eyebrow, and the cards counting off behind it. */
      const statsBeat = (tl: gsap.core.Timeline, at: gsap.Position) =>
        listBeat(tl, at, "stats", statsEyebrow, cards);

      /**
       * The skills block: one object from `lg` up, an eyebrow and a list of
       * rows below it — see the parking above for why.
       */
      const skillsBeat = (tl: gsap.core.Timeline, at: gsap.Position) => {
        if (wide) {
          if (skills) tl.to(skills, { opacity: 1, x: 0, ...COPY }, at);
          return;
        }
        listBeat(tl, at, "skills", skillsEyebrow, rows);
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
        // One trigger, one timeline: the section arrives whole, so the beats
        // are spaced against each other. One label for the whole last beat,
        // offset from the copy's rather than appended, so the blocks stay
        // related to each other however long the title's own beat runs.
        whenVisible(el, () => {
          const tl = gsap.timeline();
          copyBeat(tl);
          tl.addLabel("blocks", `settle+=${BLOCK_LEAD}`);
          skillsBeat(tl, "blocks");
          statsBeat(tl, `blocks+=${ROW_LEAD}`);
        });
      } else {
        // A trigger each, and no leads: the column is taller than the screen,
        // so the reader's scroll is what spaces these — see above.
        //
        // Each block is watched at its own top, which is the eyebrow where it
        // has one: the eyebrow is parked too, so anchoring lower would leave
        // the reader looking at the gap where its rule should be. The title
        // block is the exception — it stays on the title, which is the box the
        // margin was set against and the element this whole hook is scoped to.
        whenVisible(el, () => copyBeat(gsap.timeline()));

        const statsTop = statsEyebrow ?? refs.stats.current;
        if (statsTop)
          whenVisible(statsTop, () => statsBeat(gsap.timeline(), 0));

        const skillsTop = skillsEyebrow ?? skills;
        if (skillsTop) {
          whenVisible(skillsTop, () => skillsBeat(gsap.timeline(), 0));
        }
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

export default function AboutContent({
  title,
  description,
  numbers,
  skills,
}: Props) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const eyebrowRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const skillsEyebrowRef = useRef<HTMLElement>(null);
  const skillsListRef = useRef<HTMLUListElement>(null);
  const statsEyebrowRef = useRef<HTMLElement>(null);
  const statsRef = useRef<HTMLUListElement>(null);

  useCopyReveal(
    {
      title: titleRef,
      eyebrow: eyebrowRef,
      description: descriptionRef,
      skills: skillsRef,
      skillsEyebrow: skillsEyebrowRef,
      skillsList: skillsListRef,
      statsEyebrow: statsEyebrowRef,
      stats: statsRef,
    },
    title ?? "",
    description ?? "",
    numbers.length,
    skills.length,
  );

  const iconSize = "size-4 shrink-0 xl:size-5 2xl:size-6";
  const metaText = `${CAPS} ${MUTED} text-[0.6875rem] lg:text-xs xl:text-[0.8125rem] 2xl:text-sm`;

  return (
    <div className="relative flex min-h-screen w-full flex-col justify-center gap-5 px-(--block-inset) pt-[6vh] pb-[calc(6vh+2.5rem)] sm:gap-6 lg:block lg:h-full lg:min-h-0 lg:gap-0 lg:px-0 lg:pt-0 lg:pb-0">
      {/* "ABOUT" itself is <Title /> in the scene, where no reader can get at
          it, so the section's heading lives here */}
      <h2 className="sr-only">About</h2>

      {/* — who i am ------------------------------------------------------ */}
      {/* the eyebrow is a marker for the copy under it, so with neither field
          filled the block goes rather than leaving a rule floating on its own */}
      {(title || description) && (
        <div
          className={`lg:absolute lg:top-[10.7%] lg:right-[3.4%] lg:left-[64.8%] mb-6 lg:mb-0`}
        >
          <Eyebrow ref={eyebrowRef}>who i am</Eyebrow>

          {/* the design breaks this over three lines, but a Text field is one
              line in the editor, so the breaks are the column's to make — it's
              sized to wrap the copy the same way. `pre-line` is there for the
              author who does get a newline in. */}
          {title && (
            <p
              ref={titleRef}
              className={`font-display mt-2 font-extrabold text-white ${CAPS} ${LEADING} text-base tracking-normal whitespace-pre-line sm:text-lg lg:text-xl xl:text-2xl 2xl:text-[1.75rem] short:text-lg shorter:text-[0.85rem]`}
            >
              {title}
            </p>
          )}

          {description && (
            <p
              ref={descriptionRef}
              className={`mt-3 ${CAPS} ${MUTED} ${LEADING} text-xs tracking-normal lg:text-sm lg:max-w-[93%] xl:mt-5 xl:text-base 2xl:mt-6 2xl:text-lg short:text-sm shorter:text-[0.75rem]`}
            >
              {description}
            </p>
          )}
        </div>
      )}

      {/* — the numbers --------------------------------------------------- */}
      {/* the eyebrow labels the cards, so with no numbers to label it goes too
          rather than leaving a rule over nothing.

          Eyebrow and list share one box, the way "who i am" does on the right:
          the box is what sits at the design's 10.7%, so the pair still reads as
          one line across the section, and the space under the rule is a margin
          rather than the difference between two percentages — that difference
          is a slice of the section's height, so it opened up on a tall viewport
          and closed on a short one. Stacked below `lg` the box is static and
          falls into the column in source order. */}
      {numbers.length > 0 && (
        <div className="lg:absolute lg:top-[10.7%] lg:left-[3.9%] lg:w-[30%]">
          <Eyebrow ref={statsEyebrowRef}>my stats</Eyebrow>

          <ul
            ref={statsRef}
            // three across is what the design's count wants; a fourth card
            // wraps rather than squeezing the labels onto two lines. The top
            // margin is the design's gap under the rule, sized off the type so
            // it holds at any height.
            className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 lg:block lg:space-y-2"
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
                //
                // The item is the intro's target and holds nothing but the box it
                // reserves — the card itself is the element inside. The two are
                // split because both want `transform`: the intro writes one here
                // every frame, and a transition on the same element would smear
                // that animation and then lose to its inline value anyway. Held
                // apart, the intro moves the item and the hover moves the card.
                className="lg:ml-(--stagger) lg:h-16 lg:w-[77.6%] xl:h-20 2xl:h-24 min-[112rem]:h-25"
              >
                {/* `pointer-events-auto` because <AboutOverlay />'s layer is
                    transparent to the pointer — see the skills rows below */}
                <div
                  className={`pointer-events-auto flex h-full flex-col items-center rounded-sm border-2 border-white ${PLATE} px-2 py-2.5 text-center transition-transform duration-300 ease-out hover:translate-x-4 lg:flex-row lg:items-center lg:gap-8 lg:px-3 lg:py-0 lg:text-left xl:gap-12 xl:px-4 2xl:gap-16 2xl:px-5 min-[112rem]:px-6`}
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
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* — the face ------------------------------------------------------ */}
      {/* The head is scene geometry — <Head />, over in the R3F tree — and this
          is the hole it sits in: an empty box that <Scene /> measures and
          matches the face to every frame, so the two can't drift apart as the
          copy above it rewraps. Nothing is drawn here; the canvas shows through.

          The draft's numbers: 203 of 375 across, which is the 54vw below, and
          the texture's own 784 x 1519 aspect, which is what makes the box the
          same shape as the thing filling it. The margins are the draft's 49px
          above and 31px below, less the column's own gap, and in `vw` for the
          same reason the width is — they are proportions of the frame, not
          measurements of one phone.

          The `vh` half of that `min` is a ceiling, not a second opinion. The
          face is nearly twice as tall as it is wide, so a width traced off a
          375px frame turns into 150vh of head on a landscape phone or a small
          laptop window, where 54vw is half of something much wider — a face
          you could never see at once however far you scrolled. 31vh of width
          is 60vh of height, which is the most that leaves the whole of it on
          screen at a glance. On anything shaped like the frame it was drawn
          for, the `vw` side wins and the draft's proportions stand.

          Gone from `lg` up, where the face is back to the world position it is
          authored at and the blocks are placed around it. `display: none` is
          what the scene reads as "no column to sit in", so the two halves stay
          in step through a resize across the breakpoint. */}
      <div
        ref={publishFaceSlot}
        aria-hidden
        className="mt-[8vw] mb-[3vw] aspect-[784/1519] w-[min(66vw,37vh)] shrink-0 self-center lg:hidden"
      />

      {/* — my skills, and where and when --------------------------------- */}
      {/* One row rather than two blocks placed independently: the meta list is
          set against the foot of the skills list, and that list is as tall as
          the skill count makes it, so the alignment has to come from a shared
          container rather than a percentage traced off the design's three
          rows. The row spans the stat cards' left edge to the skills list's
          right, which is what puts the meta list under the cards.

          Below `lg` the wrapper is just another item in the column and the two
          fall into it in source order, so the skills list still comes first. */}
      <div className="flex flex-col gap-5 sm:gap-6 lg:absolute lg:bottom-[12%] lg:right-[3.4%] lg:left-[3.9%] lg:flex-row lg:items-end lg:gap-0">
        {skills.length > 0 && (
          // the design's right-hand column, 64.8%–96.6% of the frame, as a
          // share of this row; `order` because it reads first in the DOM and
          // sits second across
          <div ref={skillsRef} className="lg:order-2 lg:ml-auto lg:w-[34.3%]">
            <Eyebrow ref={skillsEyebrowRef}>my skills</Eyebrow>

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

                That split is load-bearing, not style: it settles the hairline
                at the source. A composited layer is snapped out to whole pixels
                before it's drawn, and this list is sized in percentages all the
                way up, so its box lands mid-pixel; a wrapper frame is something
                the rows can round themselves a fraction wider than and paint
                their black over — which is how the right border went missing
                while the left, the top and the dividers stayed. Rows that carry
                their own edges snap with them, and have nothing left to escape.

                It used to carry a second reason — the rows were frosted, and a
                rounded, clipping *ancestor* over a backdrop-filter forces a
                mask pass on its own render surface, which cost most of the
                section's frame budget. The filters are gone now (see
                {@link PLATE}), so that half no longer applies. Keep the shape
                anyway: the hairline reason stands on its own, and the rule the
                mask pass taught still holds for anything that comes back —
                nothing on this layer wants a clipping ancestor. */}
            {/* Between `md` and `lg` the column is wide enough that a single
                stack leaves the list running well past the copy beside it, so
                the rows pair off into two columns there and nowhere else. The
                shared-divider frame can't survive that split — `first` and
                `last` are the grid's first and last cells, not each column's —
                so in that range every row closes its own box instead (see the
                row classes below), which is why the columns take a gap. */}
            <ul
              ref={skillsListRef}
              className="mt-2.5 lg:mt-4 mb-6 lg:mb-0 md:grid md:grid-cols-2 md:gap-2 lg:block lg:w-[90.4%]"
            >
              {skills.map(({ skill }, i) => (
                <li
                  key={i}
                  // `pointer-events-auto` because <AboutOverlay />'s layer is
                  // transparent to the pointer — without it the row never sees a
                  // hover. Scoped to the plate so the gaps around the list stay
                  // transparent and the head pieces underneath stay draggable.
                  className={`group pointer-events-auto flex h-10 items-stretch border-x border-b border-white max-md:first:border-t max-md:first:rounded-t-sm max-md:last:rounded-b-sm md:max-lg:rounded-sm md:max-lg:border-t lg:first:border-t lg:first:rounded-t-sm lg:last:rounded-b-sm ${PLATE} lg:h-12 xl:h-14 2xl:h-16 short:h-10 shorter:h-8`}
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
                    /* the label alone slides on hover — the icon keeps its
                       cell, so the divider it sits against stays put */
                    className={`flex flex-1 items-center px-3 text-white transition-transform duration-300 ease-out group-hover:translate-x-4 ${CAPS} text-sm lg:px-4 lg:text-base xl:px-6 xl:text-xl 2xl:text-2xl short:text-sm shorter:text-xs`}
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
              local time <LocalTime />
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
