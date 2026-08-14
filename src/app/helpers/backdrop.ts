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

/**
 * The highest point of the silhouette, in world space — the leading edge, the
 * one that reaches a given overlay first as the plane rises.
 *
 * An overlay anchored to this travels exactly as that edge does, so whatever
 * gap it starts with it keeps, and the edge can never catch it. Written into
 * `out` so the frame loop never allocates; null before <About /> has mounted
 * and published, which is also when there's nothing to hide behind.
 */
export function backdropCrest(out: THREE.Vector3) {
  if (!outline || outline.length === 0) return null;

  let crest = outline[0];
  for (let i = 1; i < outline.length; i++) {
    if (outline[i].y > crest.y) crest = outline[i];
  }

  return out.copy(crest);
}

/** how far the cut-out's outer contour reaches past the clipped box, in px */
const BLEED = 200;

/**
 * Per-element scratch for {@link clipToBackdrop}. Holds the projected outline,
 * the last set actually written, and the cheap comparands that let an unchanged
 * frame bail before it builds a string — all preallocated, so the frame loop
 * never allocates.
 *
 * One per clipped element: two elements sharing a state would each see the
 * other's numbers as "already written" and skip their own update.
 */
export type BackdropClip = {
  /** projected outline, x/y interleaved, in whole pixels */
  poly: Int32Array;
  written: Int32Array;
  scratch: THREE.Vector3;
  count: number;
  cut: boolean | null;
  boxH: number;
};

export function createBackdropClip(): BackdropClip {
  return {
    poly: new Int32Array(64),
    written: new Int32Array(64),
    scratch: new THREE.Vector3(),
    count: 0,
    cut: null,
    boxH: NaN,
  };
}

/**
 * Punch the backdrop's silhouette out of `el` via `clip-path`.
 *
 * The polygon is projected into the element's own box, which is assumed to span
 * the viewport's full width starting at `offsetY` from its top and to be `boxH`
 * tall — the shape both hero overlays have, whether they're pinned to the
 * viewport or translated with the camera.
 *
 * Whole pixels, so a slow camera move doesn't rewrite the path — and so repaint
 * the type — every single frame.
 */
export function clipToBackdrop(
  state: BackdropClip,
  el: HTMLElement,
  camera: THREE.Camera,
  width: number,
  height: number,
  offsetY: number,
  boxH: number,
) {
  const { poly, written, scratch } = state;

  // The only thing here that can dirty the element, so it stays "none" until
  // the About plane has actually risen far enough to reach it — which for most
  // of the hero it hasn't.
  const outline = backdropOutline();
  let n = 0;
  let cut = false;

  if (outline && outline.length * 2 <= poly.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let ahead = true;

    for (let i = 0; i < outline.length; i++) {
      scratch.copy(outline[i]).applyMatrix4(camera.matrixWorldInverse);

      // a point behind the eye projects to a mirrored, meaningless place. The
      // backdrop never gets there, but a mask built from one would swallow the
      // whole block, so bail rather than guess.
      if (scratch.z > -1) {
        ahead = false;
        break;
      }

      scratch.applyMatrix4(camera.projectionMatrix);

      const px = Math.round((scratch.x * 0.5 + 0.5) * width);
      const py = Math.round((1 - (scratch.y * 0.5 + 0.5)) * height) - offsetY;

      poly[n++] = px;
      poly[n++] = py;

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    cut = ahead && maxX > 0 && minX < width && maxY > 0 && minY < boxH;
  }

  if (!cut) n = 0;

  // integer compare before anything else: writing `clip-path` repaints the
  // element, so it has to be earned
  let moved = cut !== state.cut || n !== state.count || boxH !== state.boxH;

  if (cut && !moved) {
    for (let i = 0; i < n; i++) {
      if (poly[i] !== written[i]) {
        moved = true;
        break;
      }
    }
  }

  if (!moved) return;

  if (!cut) {
    el.style.clipPath = "none";
  } else {
    // outer contour clockwise, the outline counter-clockwise against it, so it
    // punches through under either fill rule — which spares `path()` an
    // `evenodd` argument, the part with the thinnest support
    let d = `M${-BLEED} ${-BLEED}H${width + BLEED}V${boxH + BLEED}H${-BLEED}Z`;

    for (let i = 0; i < n; i += 2) {
      d += `${i ? "L" : "M"}${poly[i]} ${poly[i + 1]}`;
    }

    el.style.clipPath = `path("${d}Z")`;
    for (let i = 0; i < n; i++) written[i] = poly[i];
  }

  state.cut = cut;
  state.count = n;
  state.boxH = boxH;
}
