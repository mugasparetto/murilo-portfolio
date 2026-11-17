"use client";

import {
  type RefObject,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  onSectionVisibility,
  sectionOnScreen,
} from "@/app/helpers/sectionVisibility";
import { blockInset } from "@/slices/Hero/scene/Name";

/** space between the nav's right edge and the badge, in px */
const GAP = 8;

const heroOnScreen = () => sectionOnScreen("scene-hero");
// the store's own default for a section nobody has reported on yet
const heroOnServer = () => true;

/**
 * A badge fixed beside <SiteNav /> saying whether the hero's scene group is
 * being drawn — the `active` flag <SceneManager /> mirrors into
 * {@link sectionOnScreen}, i.e. the same answer `visible` and the hero's
 * per-frame early-outs read. It does *not* reflect <Diagnostics />'s key 1,
 * which hides the outer named group imperatively and never touches the store.
 *
 * The nav changes width (the hamburger opens to 160px; at md it's an
 * auto-width bar centred on the page), so the badge measures the nav's right
 * edge rather than guessing it. `bottom` comes from the same classes the nav
 * uses, so the two stay on one baseline without reading the viewport height.
 */
export default function HeroSceneStatus({
  navRef,
}: {
  navRef: RefObject<HTMLElement | null>;
}) {
  const on = useSyncExternalStore(
    onSectionVisibility,
    heroOnScreen,
    heroOnServer,
  );

  const [box, setBox] = useState<{ left: number; height: number } | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const measure = () => {
      const rect = nav.getBoundingClientRect();
      // Below md the open menu grows upward, so match the hamburger's row
      // rather than the whole panel; at md the button is `display: none` and
      // the bar is one row anyway.
      const button = nav.querySelector("button");
      const height =
        button && button.offsetParent !== null
          ? button.offsetHeight + 2 // + the nav's 1px border either side
          : rect.height;
      setBox({ left: rect.right + GAP, height });
    };

    measure();
    // ResizeObserver catches the width transition frame by frame; `resize`
    // catches the centred bar moving and the vw-based inset changing.
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [navRef]);

  if (!box) return null;

  return (
    <div
      aria-hidden
      data-hero-scene={on ? "on" : "off"}
      className="pointer-events-none fixed bottom-(--block-inset) z-50 flex select-none items-center gap-2 rounded-sm border border-white bg-black px-3 text-xs uppercase tracking-[0.15em] text-white md:bottom-6"
      style={{ ...blockInset, left: box.left, height: box.height }}
    >
      <span
        className={`size-2 rounded-full transition-colors duration-150 ${on ? "bg-emerald-400" : "bg-red-500"}`}
      />
      <span className="whitespace-nowrap">hero {on ? "on" : "off"}</span>
    </div>
  );
}
