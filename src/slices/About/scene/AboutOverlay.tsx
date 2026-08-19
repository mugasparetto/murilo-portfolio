"use client";

import { ReactNode, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { toBaseFrame } from "@/app/components/ParallaxRig";
import { ABOUT_POSE } from "@/app/components/poses";
import { blockInset } from "@/slices/Hero/scene/Name";

/**
 * The About section's HTML layer — the place to put type, links and buttons
 * that belong to this section but shouldn't be geometry.
 *
 * It's DOM for the reasons the hero's overlays are: it sits above the canvas,
 * so Vignette/Noise/Bloom never touch it, and the DOM knows nothing about the
 * camera, so the pointer parallax can't move it. Where <Title /> is deliberately
 * a mesh — it has to be *occluded* by the head pieces dragged across it — this
 * is deliberately not: nothing here goes behind anything.
 *
 * So it comes in the same two halves, since a DOM tree can't live inside the
 * R3F reconciler:
 *
 * - <AboutOverlay />, mounted in the About section, owns the markup;
 * - <AboutOverlayDriver />, mounted in the scene, reads the camera once per
 *   frame and writes to it — no React render involved.
 *
 * They meet at the module-scoped `overlay` handle below, the same way
 * <NameOverlay /> and <ParallaxRig /> publish theirs. There is only ever one
 * About section, so a singleton is honest here.
 *
 * The layer is viewport-sized and starts life exactly over the viewport, so
 * everything inside is laid out with ordinary CSS against the screen — no
 * projection maths per element. The single thing the driver does is slide the
 * whole layer with the scene, which is what keeps the HTML travelling with the
 * section it belongs to instead of hanging in front of the hero on the way in.
 *
 * `blockInset` is set on the layer, so anything inside can line its left edge
 * up with the name and the title with `px-(--block-inset)` — see
 * <HeadlineOverlay />, which uses the same pair.
 */

const overlay: { band: HTMLDivElement | null } = { band: null };

/**
 * Depth the layer is pinned at — the plane <Title /> lives on, clear of the
 * backdrop and its grid at z = 2200.
 *
 * Depth is the pace knob, exactly as it is for the hero overlays: the camera
 * both descends and pitches on its way here, so a point far down the view axis
 * picks up almost nothing but the rotation and crawls, while a near one gets
 * the translation too and arrives fast. Sitting on the title's plane is what
 * makes the HTML and the title move as one block.
 */
const Z = 2210;

/**
 * The point the layer hangs off, on the rest pose's view axis. Only the *delta*
 * from its resting projection is used, so moving this changes how fast the
 * layer arrives, never where it comes to rest.
 */
const ANCHOR = new THREE.Vector3(0, ABOUT_POSE.position[1], Z);

/**
 * The rest pose as a camera, built on first use, so the drift below has
 * something to measure against. Aspect is arbitrary: the fov is vertical, so
 * NDC y doesn't depend on it.
 *
 * <Title /> reaches for the same pose for the same reason — it's the one the
 * scroll rig comes to rest at and holds for the whole section, so it's the only
 * frame in which "where this section sits on screen" means anything.
 */
let restCam: THREE.PerspectiveCamera | null = null;

function restCamera(fov: number) {
  if (!restCam || restCam.fov !== fov) {
    restCam = new THREE.PerspectiveCamera(fov, 1, 50, 100000);
    restCam.position.set(...ABOUT_POSE.position);
    restCam.lookAt(...ABOUT_POSE.lookAt);
    restCam.updateMatrixWorld();
  }

  return restCam;
}

const liveScratch = new THREE.Vector3();
const restScratch = new THREE.Vector3();

/**
 * How far {@link ANCHOR} has drifted from its resting place this frame, in CSS
 * px — large and positive while the hero is still on screen and the section is
 * waiting below, settling to zero once the rig reaches {@link ABOUT_POSE}.
 *
 * This is the whole of the layer's motion: it's `fixed`, so nothing else moves
 * it, and at rest it sits exactly over the viewport.
 *
 * Projected in the base frame, so the pointer parallax is stripped out.
 */
function anchorDrift(camera: THREE.Camera, fov: number, height: number) {
  liveScratch.copy(ANCHOR);
  toBaseFrame(liveScratch);
  liveScratch.project(camera);

  restScratch.copy(ANCHOR).project(restCamera(fov));

  return (restScratch.y - liveScratch.y) * 0.5 * height;
}

/**
 * Lives in the About section, above the canvas. A viewport-sized layer that
 * <AboutOverlayDriver /> slides with the scene — put whatever markup the
 * section needs inside it and lay it out with plain CSS.
 *
 * Interactive children need `pointer-events-auto` of their own: the layer
 * itself is transparent to the pointer so the head pieces underneath stay
 * draggable.
 */
export default function AboutOverlay({ children }: { children?: ReactNode }) {
  return (
    <div
      ref={(el) => {
        overlay.band = el;
      }}
      className="pointer-events-none fixed top-0 left-0 z-1 h-screen w-full"
      style={{
        ...blockInset,
        contain: "layout style",
        // moved every frame and never re-laid-out, so keep it on its own
        // compositor layer
        willChange: "transform",
        // the driver reveals it once it has placed it, so it can't flash over
        // the hero first
        visibility: "hidden",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Lives in the scene. Renders nothing — it just drives <AboutOverlay /> from
 * the camera, once per frame, skipping writes that wouldn't change anything so
 * a settled section does zero DOM work.
 */
export function AboutOverlayDriver() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const fov = useMemo(
    () => (camera as THREE.PerspectiveCamera).fov ?? 40,
    [camera],
  );

  const lastY = useRef(NaN);
  const lastHidden = useRef<boolean | null>(null);

  useFrame(() => {
    const band = overlay.band;
    if (!band) return;

    // whole pixels: a fractional translate resamples everything on the layer
    // every frame, which reads as shimmer on the type
    const y = Math.round(anchorDrift(camera, fov, size.height));

    // the layer is exactly one viewport tall, so a full viewport of drift in
    // either direction has carried it clear of the screen
    const hidden = y >= size.height || y <= -size.height;
    if (hidden !== lastHidden.current) {
      band.style.visibility = hidden ? "hidden" : "visible";
      lastHidden.current = hidden;
    }
    if (hidden) return;

    // compositor-only — the raster is reused, never redrawn. Compared as a
    // number so an unchanged frame doesn't even build the string.
    if (y !== lastY.current) {
      band.style.transform = `translate3d(0,${y}px,0)`;
      lastY.current = y;
    }
  });

  return null;
}
