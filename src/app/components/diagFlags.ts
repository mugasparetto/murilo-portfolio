"use client";

/**
 * The two pieces of <Diagnostics /> that have to live outside it: the
 * postprocessing bypass, and the pointer sway.
 *
 * Everything else the harness toggles it can reach on its own — scene groups
 * through the graph, the DOM overlays through `document`, the resolution
 * through R3F's own `setDpr`. The composer is React-owned, so the only way to
 * take it out of the frame is to have <Postprocessing /> stop rendering it,
 * which means a subscription rather than a poke.
 *
 * Module-scoped for the same reason the overlays' handles are: there is only
 * ever one composer, and dev-only wiring shouldn't cost the app a context.
 */

let bypass = false;

const listeners = new Set<() => void>();

/** the store's snapshot — <Postprocessing /> reads it through `useSyncExternalStore` */
export function postBypassed() {
  return bypass;
}

/** the server never bypasses anything, and neither does the first client render */
export function postBypassedOnServer() {
  return false;
}

export function setPostBypassed(next: boolean) {
  if (next === bypass) return;
  bypass = next;
  listeners.forEach((l) => l());
}

export function onPostBypass(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Whether <ParallaxRig /> lets the pointer move the camera — key 6.
 *
 * A plain boolean rather than a store: the only reader is a `useFrame`, so
 * there is nothing to re-render and nobody to notify.
 *
 * It exists because the sway used to ride on key 3. That toggle hid `<main>`,
 * which is the <Canvas />'s `eventSource` — with it hidden the pointer
 * listeners stop firing, `state.pointer` freezes at whatever it last read, and
 * the camera holds an arbitrary offset. So "DOM overlays off" silently meant
 * "and the sway too, at the wrong pose". They're separate costs and they're
 * separate keys.
 */
let sway = true;

export function swayOn() {
  return sway;
}

export function setSwayOn(next: boolean) {
  sway = next;
}
