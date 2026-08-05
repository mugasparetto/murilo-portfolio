"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyTextField } from "@prismicio/client";

import { backdropOutline } from "@/app/helpers/backdrop";
import { FILL, nameBand, type BandRect } from "./Name";

/**
 * The headline is the paragraph under the name — read the two as one block:
 * an <h1> with its reflections, and this hanging off the bottom of it.
 *
 * It's DOM for the same reasons the name is: above the canvas, so Vignette and
 * Noise never touch it, and out of reach of the pointer parallax. It splits the
 * same way too — <HeadlineOverlay /> in the Hero section owns the markup,
 * <HeadlineDriver /> in the scene places it once a frame — and meets at the
 * module-scoped `overlay` handle below.
 *
 * Where it differs from the name is what it hides behind. The name is cut by
 * the door; this deliberately isn't, so it stays legible while the door opens
 * over it. The one thing that does swallow it is the About backdrop, which
 * wipes up over the whole hero — that plane publishes its outline and the
 * driver clips against it, since a DOM overlay can't be depth-tested.
 *
 * Placement is entirely inherited: the driver only sets the band's y to the
 * bottom edge of the name block, which <NameOverlay /> and this compute from
 * the identical call. Everything else is static CSS — the left inset matches
 * the name's, and the gap is padding on the band, which is what keeps the
 * band's box origin exactly at the name's bottom edge and so keeps the clip
 * coordinates honest.
 */

type Props = {
  tagline: KeyTextField;
  description: KeyTextField;
};

const overlay: {
  band: HTMLDivElement | null;
  /** border-box height, kept current by a resize observer */
  height: number;
} = { band: null, height: 0 };

/** how far the cut-out's outer contour reaches past the band, in px */
const BLEED = 200;

/**
 * The projected backdrop outline, x/y interleaved, plus the last set actually
 * written. Whole pixels, so a slow camera move doesn't rewrite the path — and
 * so repaint the type — every single frame. Reused buffers, so the frame loop
 * never allocates.
 */
const poly = new Int32Array(64);
const written = new Int32Array(64);

/**
 * Lives in the Hero section, above the canvas. Nothing here changes after
 * mount — <HeadlineDriver /> only ever touches the band's transform and clip.
 */
export default function HeadlineOverlay({
  tagline = "",
  description = "",
}: Props) {
  const head = (tagline ?? "").trim();
  const body = (description ?? "").trim();
  const band = useRef<HTMLDivElement | null>(null);

  // the block's height is whatever the type wraps to, so let the browser report
  // it: the observer covers the breakpoint steps and the font swap alike, and
  // the driver never has to touch the layout.
  //
  // Border box, explicitly: the gap under the name is padding, and a padding
  // step at a breakpoint leaves the *content* box untouched, so the default
  // observer would never fire for it and the clip would run a gap behind.
  useEffect(() => {
    const el = band.current;
    if (!el) return;

    overlay.band = el;

    const ro = new ResizeObserver(([entry]) => {
      overlay.height = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
    });
    ro.observe(el, { box: "border-box" });

    return () => {
      ro.disconnect();
      overlay.band = null;
      overlay.height = 0;
    };
  }, [head, body]);

  if (!head && !body) return null;

  return (
    <div
      ref={band}
      // the sizes step at the breakpoints and nothing here reads the viewport,
      // so they're media queries rather than a measured table: no re-render on
      // resize, and the server renders what the client hydrates. The gap under
      // the name is padding, not a margin, so the band's box still starts
      // exactly at the name's bottom edge — which is what the clip counts on.
      className="pointer-events-none fixed top-0 left-0 z-1 w-full pt-4 md:pt-5 lg:pt-6 xl:pt-7 2xl:pt-8"
      style={{
        // matches the centred name svg's left edge
        paddingLeft: `${(1 - FILL) * 50}%`,
        contain: "layout style",
        // moved every frame and never re-laid-out, so keep it on its own
        // compositor layer
        willChange: "transform",
        // the driver reveals it once it has placed it, so it can't flash at the
        // top of the viewport first
        visibility: "hidden",
      }}
    >
      {head && (
        <h2 className="font-display m-0 text-base leading-tight font-extrabold text-white uppercase md:text-lg lg:text-xl xl:text-2xl 2xl:text-3xl">
          {head}
        </h2>
      )}

      {body && (
        <p className="m-0 mt-2 max-w-76 text-xs leading-relaxed text-white/90 uppercase md:max-w-sm lg:mt-3 lg:max-w-md lg:text-sm xl:max-w-lg 2xl:max-w-140 2xl:text-base">
          {body}
        </p>
      )}
    </div>
  );
}

/**
 * Lives in the scene. Renders nothing — it pins <HeadlineOverlay /> to the
 * bottom of the name and clips it to whatever the About backdrop leaves
 * uncovered, skipping writes that wouldn't change anything so an idle desktop
 * settles to zero DOM work.
 */
export function HeadlineDriver() {
  const { camera, size } = useThree();

  const rect = useMemo<BandRect>(() => ({ y: 0, height: 0 }), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const lastY = useRef(NaN);
  const lastBandH = useRef(NaN);
  const lastCount = useRef(0);
  const lastCut = useRef<boolean | null>(null);
  const lastHidden = useRef<boolean | null>(null);

  useFrame(() => {
    const band = overlay.band;
    if (!band || !nameBand(rect, camera, size.width, size.height)) return;

    // the name's bottom edge — the last echo's baseline — is the band's top
    const y = rect.y + rect.height;
    const bandH = overlay.height;

    const hidden = y + bandH < 0;
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

    // --- backdrop cut-out, in the band's own box.
    //
    // The only thing here that can dirty the type, so it stays "none" until the
    // About plane has actually risen far enough to reach it — which for most of
    // the hero it hasn't.
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
        // backdrop never gets there, but a mask built from one would swallow
        // the whole block, so bail rather than guess.
        if (scratch.z > -1) {
          ahead = false;
          break;
        }

        scratch.applyMatrix4(camera.projectionMatrix);

        const px = Math.round((scratch.x * 0.5 + 0.5) * size.width);
        const py = Math.round((1 - (scratch.y * 0.5 + 0.5)) * size.height) - y;

        poly[n++] = px;
        poly[n++] = py;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      cut = ahead && maxX > 0 && minX < size.width && maxY > 0 && minY < bandH;
    }

    if (!cut) n = 0;

    // integer compare before anything else: writing `clip-path` repaints the
    // type, so it has to be earned
    let moved =
      cut !== lastCut.current ||
      n !== lastCount.current ||
      bandH !== lastBandH.current;

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
      band.style.clipPath = "none";
    } else {
      // outer contour clockwise, the outline counter-clockwise against it, so
      // it punches through under either fill rule — which spares `path()` an
      // `evenodd` argument, the part with the thinnest support
      let d = `M${-BLEED} ${-BLEED}H${size.width + BLEED}V${
        bandH + BLEED
      }H${-BLEED}Z`;

      for (let i = 0; i < n; i += 2) {
        d += `${i ? "L" : "M"}${poly[i]} ${poly[i + 1]}`;
      }

      band.style.clipPath = `path("${d}Z")`;
      for (let i = 0; i < n; i++) written[i] = poly[i];
    }

    lastCut.current = cut;
    lastCount.current = n;
    lastBandH.current = bandH;
  });

  return null;
}
