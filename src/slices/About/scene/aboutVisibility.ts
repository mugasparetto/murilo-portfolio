"use client";

/**
 * Whether the About section is on screen, as a store.
 *
 * The section spends most of the page out of view, and two things in it would
 * otherwise keep working the whole time: <SolidIcon />'s ticker, redrawing four
 * turning solids thirty times a second, and the meta list's clock, re-rendering
 * once a second. Neither has any business running for a section nobody can see,
 * and simply being scrolled past doesn't stop either of them — an element that
 * isn't being painted still runs its timers.
 *
 * Its own module rather than a pair of exports on the slice, for the reason
 * `diagFlags` is its own: both readers are plain DOM and want nothing but a
 * boolean, and neither should have to import a section to get one.
 *
 * Module-scoped for the reason ./faceSlot's handle is: there is only ever one
 * About section, so a singleton is honest here.
 */

/**
 * False to start: the observer that sets it hasn't run yet, and on the server
 * there is no viewport for anything to be on screen of. So the server and the
 * first client render agree, which is what the snapshot below is for.
 */
let onScreen = false;

const listeners = new Set<() => void>();

/** the snapshot — read straight by the ticker, through `useSyncExternalStore` by React */
export function aboutOnScreen() {
  return onScreen;
}

/** the server has placed nothing, which is the same answer the band starts at */
export function aboutOnScreenOnServer() {
  return false;
}

/**
 * <About />'s own IntersectionObserver only. The guard is belt and braces now
 * that the caller is an observer rather than a frame loop — an observer already
 * fires only on a crossing — but it costs one comparison, and it means nothing
 * here depends on that staying true.
 */
export function setAboutOnScreen(next: boolean) {
  if (next === onScreen) return;
  onScreen = next;
  listeners.forEach((l) => l());
}

export function onAboutVisibility(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
