"use client";

/**
 * Whether <AboutOverlay />'s layer is on screen, as a store.
 *
 * The section spends most of the page out of view, and two things on the layer
 * would otherwise keep working the whole time: <SolidIcon />'s ticker, redrawing
 * four turning solids thirty times a second, and the meta list's clock,
 * re-rendering once a second. Neither has any business running for a section
 * nobody can see, and the layer's own `visibility` doesn't stop either of them —
 * a hidden element still runs its timers, it just doesn't paint.
 *
 * Its own module rather than a pair of exports on <AboutOverlay />, for the
 * reason `diagFlags` is its own: the writer is inside the R3F tree, and that
 * file imports three and @react-three/fiber at module scope, while both readers
 * are plain DOM. Nothing that only wants a boolean should have to pull a
 * renderer in to get it.
 *
 * Module-scoped for the reason the layer's own handle is: there is only ever
 * one About section, so a singleton is honest here.
 */

/**
 * False to start, which is what the band's own inline `visibility: "hidden"`
 * says — the driver hasn't placed it yet. So the two can't disagree on the
 * first frame, and the server and the first client render agree as well.
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
 * <AboutOverlayDriver /> only, and only when the answer changes — it is called
 * from inside a frame, so the guard is what keeps a re-render from being a
 * per-frame event. Twice a scroll-through is a non-event; every frame would not
 * be.
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
