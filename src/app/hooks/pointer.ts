"use client";

import { useSyncExternalStore } from "react";

/**
 * The *primary* pointer, not any pointer: a laptop with a touchscreen answers
 * `fine` here, which is right for what this is asked — whether a drag on this
 * device is a finger the browser may take over as a page pan, or a cursor that
 * can only ever be doing what the page thinks it is doing.
 */
const COARSE = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia?.(COARSE);
  if (!mql) return () => {};

  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia?.(COARSE).matches ?? false;

// The server has no pointer to report and no way to guess one. Consumers that
// render SSR'd markup therefore get `false` first and the truth on mount, the
// same bargain `useBreakpoints` makes; everything inside the <Canvas> mounts
// client-side and never sees this snapshot at all.
const getServerSnapshot = () => false;

/**
 * Whether the device is driven by touch — a live subscription, so a tablet
 * docked to a mouse mid-session is picked up rather than frozen at whatever it
 * was on mount.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
