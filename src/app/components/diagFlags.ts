"use client";

/**
 * The one piece of <Diagnostics /> that has to live outside it: the
 * postprocessing bypass.
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
