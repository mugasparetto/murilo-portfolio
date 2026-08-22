"use client";

import { ReactNode, RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { toBaseFrame } from "@/app/components/ParallaxRig";
import { useScrollY } from "@/app/hooks/ScrollY";
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
 * From `lg` up the layer is viewport-sized and starts life exactly over the
 * viewport, so everything inside is laid out with ordinary CSS against the
 * screen — no projection maths per element — and the single thing the driver
 * does is slide the whole layer with the scene.
 *
 * Below `lg` it is instead as tall as the column inside it, which is a good
 * deal taller than one screen: see <AboutContent />, which stacks the four
 * blocks with the face's own box among them. The layer then does two things
 * rather than one — it still arrives with the scene, and once the section has
 * arrived it carries on up, a pixel per pixel scrolled, so the column reads as
 * an ordinary scrolling page. See {@link travel}.
 *
 * `blockInset` is set on the layer, so anything inside can line its left edge
 * up with the name and the title with `px-(--block-inset)` — see
 * <HeadlineOverlay />, which uses the same pair.
 */

/**
 * The box <AboutContent /> reserves for the face in the middle of the mobile
 * column, in layer coordinates: `left`/`top` from the layer's own top-left
 * corner, so the numbers hold whatever the driver has translated the layer to
 * this frame.
 *
 * Null from `lg` up, where the column reserves nothing and the face keeps the
 * world position it is authored at.
 */
export type FaceSlot = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const overlay: {
  band: HTMLDivElement | null;
  /** the element the slot is measured from, published by <AboutContent /> */
  slot: HTMLElement | null;
  face: FaceSlot | null;
  /** the layer's own height: one viewport from `lg` up, the column's below it */
  height: number;
  /** where the section starts down the page, so {@link travel} knows when to open */
  sectionTop: number;
} = { band: null, slot: null, face: null, height: 0, sectionTop: Infinity };

/**
 * Re-read the two page measurements the layer's motion is built on: how tall
 * the column is, and where the face's box sits inside it.
 *
 * Measured here rather than per frame for the reason above, and because neither
 * changes without a resize, a font swap or an edit in Prismic — all of which
 * the observers in <AboutOverlay /> already watch for.
 *
 * The slot is measured *against the layer* rather than against the viewport, so
 * whatever transform the driver has on the layer cancels out: both rects carry
 * it.
 */
function measure() {
  const band = overlay.band;
  if (!band) return;

  const bandBox = band.getBoundingClientRect();
  overlay.height = bandBox.height;

  const slot = overlay.slot;
  if (!slot) {
    overlay.face = null;
    return;
  }

  const slotBox = slot.getBoundingClientRect();

  // `lg:hidden` takes the box away entirely from `lg` up, which is exactly the
  // signal the scene wants: no slot, no column for the head to sit in
  overlay.face =
    slotBox.width > 0
      ? {
          left: slotBox.left - bandBox.left,
          top: slotBox.top - bandBox.top,
          width: slotBox.width,
          height: slotBox.height,
        }
      : null;
}

/**
 * Where the face's box is, for the scene to put the head in — see <Scene />,
 * which is the only caller.
 */
export function readFaceSlot() {
  return overlay.face;
}

/**
 * Hands the slot element over as a ref callback: `<div ref={publishFaceSlot} />`.
 *
 * Measured on the spot, for the case where it arrives long after the observers
 * below were set up — crossing `lg` re-renders <AboutContent /> and hands over
 * a different element, or none.
 */
export function publishFaceSlot(el: HTMLElement | null) {
  overlay.slot = el;
  measure();
}

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
 * How far the column has been scrolled through the section, in CSS px: nothing
 * until the section's top edge reaches the top of the screen, then a pixel per
 * pixel scrolled, and nothing more once the column's foot has arrived.
 *
 * Page pace rather than a share of the section's 350vh, because this *is* the
 * page scrolling — a column that crept up a few pixels per screenful of wheel
 * would read as broken, however faithfully it filled the section.
 *
 * The section's top is also where the camera arrives: the scroll rig flies
 * hero → about between 115vh and 250vh, and 250vh is the About section's own
 * offset down the page. So the drift above has just closed as this opens, and
 * the two never pull on the layer at once.
 *
 * Always zero from `lg` up, where the layer is exactly one viewport and there
 * is nothing to travel.
 */
function travel(scroll: number, viewportH: number) {
  const max = overlay.height - viewportH;
  if (max <= 0) return 0;

  return Math.min(Math.max(scroll - overlay.sectionTop, 0), max);
}

/**
 * Where the layer sits this frame, in CSS px down from the top of the screen:
 * the drift the camera hasn't closed yet, less however far the column has been
 * scrolled through the section.
 *
 * Whole pixels: a fractional translate resamples everything on the layer every
 * frame, which reads as shimmer on the type.
 *
 * Exported because the head is placed against the *same* number — see <Scene />.
 * Both callers compute it rather than one reading the other's leftovers, so
 * neither depends on which of the two frame callbacks React happened to
 * register first: the head can't be a frame behind the hole it sits in.
 *
 * `scroll` is handed in — <ScrollYProvider /> already keeps it, as the position
 * Lenis has actually eased the page to this frame. Reading `scrollY` here
 * instead would be a layout read from inside a frame, and Lenis has just
 * dirtied the layout by scrolling the document.
 */
export function columnOffset(
  camera: THREE.Camera,
  fov: number,
  viewportH: number,
  scroll: number,
) {
  return Math.round(
    anchorDrift(camera, fov, viewportH) - travel(scroll, viewportH),
  );
}

/**
 * Lives in the About section, above the canvas. The layer <AboutOverlayDriver />
 * slides with the scene — put whatever markup the section needs inside it and
 * lay it out with plain CSS.
 *
 * Interactive children need `pointer-events-auto` of their own: the layer
 * itself is transparent to the pointer so the head pieces underneath stay
 * draggable.
 *
 * `sectionRef` is the section the layer belongs to. It is only ever asked where
 * it starts down the page — see {@link travel} — and it's handed in rather than
 * read off `band.parentElement` so that the relationship is something the call
 * site states, not something this file assumes about markup it doesn't own.
 */
export default function AboutOverlay({
  children,
  sectionRef,
}: {
  children?: ReactNode;
  sectionRef?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const band = overlay.band;
    if (!band) return;

    const relayout = () => {
      const section = sectionRef?.current;
      // Page coordinates, so it can be compared with `scrollY` directly.
      // Infinity with no section to measure: the travel then never opens, which
      // is the right answer for a layer nobody has placed on a page.
      overlay.sectionTop = section
        ? section.getBoundingClientRect().top + window.scrollY
        : Infinity;

      measure();
    };

    relayout();

    // The column's height is the copy's height, so it changes for reasons no
    // resize event fires for: an edit in Prismic, a rewrap, the display face
    // swapping in after first paint. Watching the layer itself catches all of
    // them, and the slot moves with everything above it.
    const observer = new ResizeObserver(relayout);
    observer.observe(band);

    window.addEventListener("resize", relayout, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", relayout);
    };
  }, [sectionRef]);

  return (
    <div
      ref={(el) => {
        overlay.band = el;
      }}
      // Auto height below `lg`, where the column is taller than the screen and
      // the layer is sized by what's inside it; exactly one viewport from `lg`
      // up, which is what the absolutely-placed blocks in there are positioned
      // against.
      className="pointer-events-none fixed top-0 left-0 z-1 w-full lg:h-screen"
      style={{
        ...blockInset,
        contain: "layout style",
        // moved every frame and never re-laid-out, so keep it on its own
        // compositor layer
        willChange: "transform",
        // the driver reveals it once it has placed it, so it can't flash over
        // the hero first
        visibility: "hidden",
        // A viewport below, which is where the driver will put it on its first
        // frame anyway. Untransformed it would sit exactly over the viewport
        // until then, and `visibility` doesn't hide that from geometry:
        // anything inside watching for its own arrival — see <AboutContent />'s
        // title reveal — would see itself on screen before the section is.
        transform: "translate3d(0, 100vh, 0)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Lives in the scene. Renders nothing — it just drives <AboutOverlay /> from the
 * camera and the page scroll, once per frame, skipping writes that wouldn't
 * change anything so a settled section does zero DOM work.
 */
export function AboutOverlayDriver() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { scrollY } = useScrollY();

  const fov = useMemo(
    () => (camera as THREE.PerspectiveCamera).fov ?? 40,
    [camera],
  );

  const lastY = useRef(NaN);
  const lastHidden = useRef<boolean | null>(null);

  useFrame(() => {
    const band = overlay.band;
    if (!band) return;

    const y = columnOffset(camera, fov, size.height, scrollY.current);

    // Off screen either way: the layer's top edge past the bottom of the
    // screen, or its foot past the top. Its own height rather than a viewport,
    // since below `lg` it is a good deal taller than one — and zero until the
    // first measurement, which holds it hidden rather than flashing a column
    // nobody has placed yet.
    const hidden = y >= size.height || y + overlay.height <= 0;
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
