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
 * The one place the page's scroll position is read, once a frame, for
 * everything that is placed by it — the camera rig, the About column, the head
 * set into it, the hero's door and steps.
 *
 * ── Why it is read here and not from a `scroll` listener ───────────────────
 *
 * Lenis only *drives* the scroll when it is smoothing, which is the wheel and
 * nothing else: `syncTouch` is off, so a finger scrolls the document natively.
 * In that mode `lenis.animatedScroll` is not a position Lenis is easing to, it
 * is a copy taken in Lenis's own `scroll` handler — and a `scroll` event is a
 * main-thread notification about a scroll that has already happened somewhere
 * else.
 *
 * On iOS that gap is the whole problem. Momentum scrolling runs on the
 * compositor, and Safari coalesces the events it reports back: the page keeps
 * moving at the display's rate while the main thread hears about it in bursts.
 * Everything placed from the cached value then holds still for two or three
 * frames and jumps, which is not a frame rate problem — the renderer is
 * producing a perfectly steady 60 frames of a position that stopped being true
 * — and so never shows up as one. It reads as flicker and chop.
 *
 * `window.scrollY` read inside the frame is the live compositor offset, so the
 * stair-step goes away. It is a layout read, hence exactly one of them, at the
 * top of the frame, before anything writes: `<AboutOverlayDriver />` and the
 * rest run later in the same frame and only write.
 *
 * The read happens *before* `lenis.raf()` because that call is what scrolls the
 * document while smoothing — reading after it would be a read of a layout the
 * same frame just dirtied. Which is also why the smooth branch takes
 * `animatedScroll` instead: it is the position Lenis has just moved the page
 * to, so it is the fresher of the two, and the native read above it is a frame
 * behind.
 *
 * ── The priority is load-bearing ──────────────────────────────────────────
 *
 * `useFrame` subscribes from a layout effect, and layout effects run child
 * first, so a provider that took the default 0 would be sorted *after* the
 * children reading from it — <ScrollRig /> among them, mounted directly under
 * <SceneManager /> — and hand them last frame's number. Not a hypothetical: the
 * rig and the About column would then be placed from two different frames'
 * scroll, and the head is fitted into a hole whose position depends on both.
 *
 * A negative priority sorts ahead of every default subscriber without claiming
 * the render: R3F only counts `priority > 0` towards taking `gl.render` away
 * from itself, so this stays a reader and <EffectComposer /> at 1 still draws
 * the frame.
 */
export function ScrollYProvider({ children }: { children: React.ReactNode }) {
  const lenis = useLenis();
  const scrollY = useRef(0);

  useFrame((state) => {
    const native = window.scrollY;

    lenis?.raf(state.clock.elapsedTime * 1000);

    scrollY.current =
      lenis?.isScrolling === "smooth" ? lenis.animatedScroll : native;
  }, -1);

  return (
    <ScrollYContext.Provider value={{ scrollY }}>
      {children}
    </ScrollYContext.Provider>
  );
}
