import * as THREE from "three";

/**
 * World-space silhouette of the About backdrop — the black plane that wipes up
 * over the hero as the page scrolls into that section.
 *
 * The hero's overlays (<NameOverlay />, <HeadlineOverlay />) are DOM sitting on
 * top of the canvas, so no amount of depth testing can put them behind it. They
 * clip themselves against this instead, the same way the name clips itself
 * against the door.
 *
 * <About />'s scene publishes it on mount and the hero reads it, which is why
 * the handle lives out here rather than in either slice. It's a singleton for
 * the same reason <ParallaxRig />'s cancel matrix is: there is only ever one
 * backdrop, and it never moves once it's built.
 *
 * The loop is closed implicitly and runs counter-clockwise on screen —
 * bottom-left, along the bottom, up the right edge, back along the curved top —
 * so a consumer can punch it straight out of a clockwise outer contour.
 */
let outline: readonly THREE.Vector3[] | null = null;

export function publishBackdrop(points: readonly THREE.Vector3[] | null) {
  outline = points;
}

export function backdropOutline() {
  return outline;
}
