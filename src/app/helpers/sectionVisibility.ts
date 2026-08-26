"use client";

import { RefObject, useEffect, useRef } from "react";

/**
 * Whether a section's scene group is near enough to the viewport to be worth
 * drawing, by the `name` it is registered under — "scene-hero", "scene-about".
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Both slices register with `active: true` and never move off it, so every
 * frame of the About section also draws the whole hero: the terrain's eight
 * tiles, the mountains, the steps with a skinned figure on them, the door, the
 * sky and its stars. None of it is on screen from the About pose, and all of it
 * is in the frame budget. A phone pays for that twice over — once in the draw,
 * once in the postprocessing chain that has to composite a bigger scene.
 *
 * <SceneRegistry />'s `setActive` already existed for this and both slices
 * already had the observer written to drive it, commented out. The reason it
 * could not be turned on is that `active` *filters* the entry out of
 * <SceneManager />'s list, which unmounts the subtree: geometry disposed,
 * shaders dropped, and a rebuild on the way back that lands as one enormous
 * frame in the middle of a scroll. Exactly the hitch it was meant to avoid.
 *
 * So the flag drives `visible` on a group instead — the bisect toggles in
 * <Diagnostics /> take the same route, and for the same reason: three's
 * renderer skips a hidden subtree whole while everything it owns stays
 * uploaded, so the toggle costs a frame rather than a rebuild.
 *
 * `visible` stops the *draw*. It does not stop a `useFrame`, and the hero's
 * most expensive per-frame work is not a draw call — see <FluidMaterial />,
 * which ping-pongs a 512 x 1024 simulation into a render target on every frame
 * whether or not the door it feeds is on screen. That work has to ask, which is
 * what this store is for and why it is a module rather than a prop: the asking
 * happens deep inside a hook that knows nothing about sections.
 *
 * Kin to {@link ./slices/About/scene/aboutVisibility}, which answers a
 * different question — whether the About *DOM layer* is on screen, for the
 * tickers riding on it. Separate because they can disagree: the scene group is
 * drawn from a viewport away, the band is only shown once it is over the
 * screen.
 */

/**
 * True for anything nobody has published an answer for, so a section that never
 * registers an observer is drawn rather than silently culled. A missing entry
 * means "no opinion", never "no".
 */
const onScreen = new Map<string, boolean>();

const listeners = new Set<() => void>();

export function sectionOnScreen(name: string) {
  return onScreen.get(name) ?? true;
}

/** <SceneManager /> only — it mirrors the registry's `active` in here. */
export function setSectionOnScreen(name: string, next: boolean) {
  if (onScreen.get(name) === next) return;
  onScreen.set(name, next);
  listeners.forEach((l) => l());
}

export function onSectionVisibility(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The same answer as a ref, for the per-frame readers.
 *
 * A ref rather than `useSyncExternalStore` because none of them render
 * anything from it: they read it at the top of a `useFrame` and return early.
 * Subscribing through React would re-render a scene's whole subtree twice per
 * scroll-through to change a boolean nothing puts in its markup.
 */
export function useSectionOnScreenRef(name: string): RefObject<boolean> {
  const ref = useRef(sectionOnScreen(name));

  useEffect(() => {
    ref.current = sectionOnScreen(name);

    return onSectionVisibility(() => {
      ref.current = sectionOnScreen(name);
    });
  }, [name]);

  return ref;
}
