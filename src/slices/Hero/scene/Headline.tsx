"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyTextField } from "@prismicio/client";

import { clipToBackdrop, createBackdropClip } from "@/app/helpers/backdrop";
import { blockInset, nameBand, type BandRect } from "./Name";
import SpecularButton from "@/app/components/SpecularButton";

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

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

type Props = {
  tagline: KeyTextField;
  description: KeyTextField;
};

const overlay: {
  band: HTMLDivElement | null;
  /** border-box height, kept current by a resize observer */
  height: number;
} = { band: null, height: 0 };

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
      //
      // The side inset matches the centred name svg's left edge, which pulls in
      // below md; both values come from `blockFill` via `blockInset`, so the two
      // still move together.
      className="pointer-events-none fixed top-0 left-0 z-1 w-full px-(--block-inset) pt-4 md:px-(--block-inset-md) md:pt-7 lg:pt-9 xl:pt-10 2xl:pt-11"
      style={{
        ...blockInset,
        contain: "layout style",
        // moved every frame and never re-laid-out, so keep it on its own
        // compositor layer
        willChange: "transform",
        // the driver reveals it once it has placed it, so it can't flash at the
        // top of the viewport first
        visibility: "hidden",
      }}
    >
      <hr className="border-white/60 pb-3 md:hidden" />

      {head && (
        <h2 className="flex items-center font-display m-0 text-base leading-tight font-extrabold text-white uppercase md:text-lg lg:text-xl xl:text-2xl 2xl:text-3xl">
          <span>{head.split(" ")[0]}</span>
          <span className="h-0.5 w-1 lg:w-12 xl:w-18 mx-1 md:mx-1 lg:mx-4 xl:mx-6 bg-white opacity-0 lg:opacity-100" />
          <span>{head.split(" ")[1]}</span>
        </h2>
      )}

      {body && (
        <p className="m-0 mt-1 max-w-full text-xs leading-relaxed text-white/80 uppercase md:max-w-76 lg:mt-1 lg:max-w-md lg:text-sm xl:max-w-lg 2xl:max-w-140 2xl:text-base">
          {body}
        </p>
      )}

      <SpecularButton
        // `size` only picks a set of classes, so the md step is a media query
        // like everything else here rather than a second read of the viewport —
        // these three are `lg`'s half of SIZES in <SpecularButton />.
        size="sm"
        onClick={() => {}}
        // cta-button is what the icon swap hangs its hover off — see globals.css
        className="cta-button pointer-events-auto mt-5 md:mt-10 md:px-10 md:py-4.5 md:text-[1.15rem] lg:px-8 lg:py-4"
        tintOpacity={1}
        tint="#000"
        textColor="#fff"
        autoAnimate
        radius={40}
        intensity={1.35}
        speed={0.5}
      >
        <span className="inline-flex items-center gap-4">
          Get in touch
          <span
            aria-hidden="true"
            className="grid size-6 md:size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white text-black *:col-start-1 *:row-start-1"
          >
            <SendIcon className="cta-icon-lead size-3 md:size-4" />
            <SendIcon className="cta-icon-copy size-3 md:size-4" />
          </span>
        </span>
      </SpecularButton>
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
  const clip = useMemo(() => createBackdropClip(), []);
  const lastY = useRef(NaN);
  const lastHidden = useRef<boolean | null>(null);

  useFrame(() => {
    const band = overlay.band;
    if (!band || !nameBand(rect, camera, size.width, size.height)) return;

    // the name's bottom edge — the last echo's baseline, or the type's own
    // below md, where there are no echoes — is the band's top
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

    // the band's box starts at the name's bottom edge, so the outline has to be
    // projected relative to `y`
    clipToBackdrop(clip, band, camera, size.width, size.height, y, bandH);
  });

  return null;
}
