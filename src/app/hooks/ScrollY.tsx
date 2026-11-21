// ScrollY.tsx
"use client";
import { createContext, useContext, useRef } from "react";
import { useLenis } from "lenis/react";
import { useFrame } from "@react-three/fiber";

type ScrollYValue = { scrollY: React.MutableRefObject<number> };
const ScrollYContext = createContext<ScrollYValue | null>(null);

export function useScrollY() {
  const ctx = useContext(ScrollYContext);
  if (!ctx) throw new Error("useScrollY must be used within ScrollYProvider");
  return ctx;
}

/**
 * The `useFrame` priorities the scroll pipeline runs at, in order: the read
 * below, then <ScrollRig /> placing the camera from it, then every section at
 * the default 0. See the provider's last section for why the order matters
 * and why all of them stay at or below 0.
 */
export const SCROLL_PRIORITY = -2;
export const RIG_PRIORITY = -1;

/**
 * The one place the page's scroll position is read, once a frame, for
 * everything that is placed by it — the camera rig, the About column, the head
 * set into it, the hero's door and steps.
 *
 * ── Lenis moves the page, and it does it here ─────────────────────────────
 *
 * Both inputs that matter go through Lenis: the wheel (`smoothWheel`) and,
 * with `syncTouch` on, the finger too. Either way Lenis cancels the browser's
 * own scroll — `preventDefault()` on the `wheel` or `touchmove` — keeps a
 * target from the deltas, and moves the document towards it itself with
 * `window.scrollTo()`. It does that from `raf()`, and `autoRaf` is off, so the
 * call below is where the page moves: on the main thread, inside this
 * callback, once a frame. (The keyboard and the scrollbar still scroll
 * natively and are read here the same way; neither is what this is tuned
 * for.)
 *
 * So `raf()` goes first and `window.scrollY` is read after it. That read is
 * the offset the DOM is about to be painted at in this same frame, because
 * Lenis has just written it, so everything placed from it moves in lockstep
 * with the copy. A `scroll` listener would hear about the same write before
 * the next frame — one frame late, which is why there isn't one.
 *
 * ── Why `window.scrollY`, and nothing of Lenis's ───────────────────────────
 *
 * This used to read `window.scrollY` *before* `raf()`, and take
 * `lenis.animatedScroll` instead whenever `isScrolling` said "smooth". That
 * was written for `syncTouch: false`, when a finger scrolled natively and only
 * the wheel went through Lenis. With touch going through Lenis as well, both
 * halves are wrong:
 *
 * - `isScrolling` does not mean "Lenis moved the page this frame". A finger is
 *   eased with `lerp: 1`, which lands on a slow drag's target within a frame
 *   or two, and the update that lands it ends in `reset()` — `isScrolling =
 *   false` — inside the same `raf()` that has just scrolled the page. Those
 *   frames fell through to the read taken before it, which was a frame old.
 * - `animatedScroll` is the position Lenis *asked* for, not the one it got. It
 *   is fractional, and the browser keeps a document's scroll offset in whole
 *   CSS pixels, so the page lands up to a pixel away from it. That is three
 *   device pixels on an iPhone.
 *
 * Together, a slow drag alternated between the unrounded figure and the
 * rounded, frame-old one, and the scene stepped *backwards* against the copy
 * by a few device pixels in about one moving frame in ten. One source, read
 * after the only write, has neither problem: it is what the DOM is drawn at,
 * rounding included.
 *
 * It is still exactly one layout read a frame, and a cheap one. Scrolling does
 * not invalidate layout, and Lenis already reads `scrollY` itself straight
 * after its own write on every frame a scroll settles (that is what `reset()`
 * does). Keep anything registered with `lenis.on("scroll")` free of DOM
 * writes, though. Those run inside `raf()`, and this read would be the one to
 * pay for them.
 *
 * ── The priority is load-bearing ──────────────────────────────────────────
 *
 * `useFrame` subscribes from a layout effect, and layout effects run child
 * first, so a provider that took the default 0 would be sorted *after* the
 * children reading from it and hand them last frame's number. Hence
 * {@link SCROLL_PRIORITY}, ahead of <ScrollRig /> at {@link RIG_PRIORITY},
 * ahead of every section at 0. The camera is a term in where the head lands
 * (<Scene /> casts a ray through it to find the head's hole), so the read, the
 * camera and the placement have to happen in that order, all in one frame.
 *
 * Negative and not merely low: R3F only counts `priority > 0` towards taking
 * `gl.render` away from itself, so these stay readers and <EffectComposer />
 * at 1 still draws the frame.
 */
export function ScrollYProvider({ children }: { children: React.ReactNode }) {
  const lenis = useLenis();
  const scrollY = useRef(0);

  useFrame((state) => {
    lenis?.raf(state.clock.elapsedTime * 1000);

    scrollY.current = window.scrollY;
  }, SCROLL_PRIORITY);

  return (
    <ScrollYContext.Provider value={{ scrollY }}>
      {children}
    </ScrollYContext.Provider>
  );
}
