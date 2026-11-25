"use client";

/**
 * The handle between the card markup and the frame loop that places it.
 *
 * The cards are DOM, not geometry, and they have to be: they carry a link, a
 * thumbnail the browser can decode and cache, and type that stays type at every
 * distance rather than a texture that resolves into one. But *where* they go is
 * a 3D question — the anchor is a point on the tunnel wall, and the answer
 * changes with the camera, so it is only known inside a `useFrame`.
 *
 * So the markup publishes its elements here on mount and <TunnelCards /> —
 * which lives inside the <Canvas /> — writes their transforms directly. The
 * same arrangement <NameOverlay /> and its driver use in the hero, and for the
 * same reason: routing a per-frame transform through React state would
 * re-render five cards on every frame of the scroll to change a string.
 *
 * Module-scoped: there is only ever one Works section, and its slots are
 * numbered by the path the tunnel is compiled from — which is compiled for as
 * many works as there are, so slot `i` is always work `i`.
 */

const elements: (HTMLElement | null)[] = [];

export function publishCardSlot(index: number, el: HTMLElement | null) {
  elements[index] = el;
}

export function cardSlot(index: number) {
  return elements[index] ?? null;
}
