"use client";

import { FC, useEffect, useId, useMemo, useRef } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

import Scene from "./scene/Scene";
import WorksCards from "./scene/WorksCards";
import { measureWorks, publishWorks } from "./scene/worksScroll";
import { worksSectionVh } from "./scene-core/presets";

/**
 * Props for `Works`.
 */
export type WorksProps = SliceComponentProps<Content.WorksSlice>;

/**
 * Component for "Works" Slices.
 */
const Works: FC<WorksProps> = ({ slice }) => {
  const worksRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { register, remove, setActive } = useSceneRegistry();

  const works = slice.primary.works ?? [];

  /**
   * How much scroll this section is worth.
   *
   * A screen for the tunnel to be seen through, plus the flight's own weight,
   * plus what the launch spends getting up to the About section's speed — see
   * {@link worksSectionVh}, which reads all three off the path. Derived
   * rather than typed so that editing the preset in ./scene-core/presets cannot
   * quietly change the pace of the whole thing: a longer tunnel takes more page,
   * exactly as much more as it added.
   */
  const heightVh = useMemo(() => worksSectionVh(), []);

  // Register scene once, after About's 20 — the entries are sorted by priority
  // and mounted in that order, so this section's geometry keeps the same
  // relation to the one above it that the page does.
  useEffect(() => {
    register({
      id,
      name: "scene-works",
      priority: 30,
      node: <Scene />,
      active: true,
    });

    return () => remove(id);
  }, [id, register, remove]);

  // Drawn while the section is anywhere near the viewport, hidden once it is a
  // long way off — the same margin the other two sections use, so a section
  // being flown towards is already drawn by the time it is in frame.
  //
  // It is the coarse gate, not the whole answer: <Scene /> hides the tunnel
  // again unless the section's own scroll has actually started, because the
  // wall stands 400 units in front of the About head and a viewport of margin
  // would otherwise put it there while the head is still on screen.
  useEffect(() => {
    const el = worksRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => setActive(id, entry.isIntersecting),
      { root: null, threshold: 0, rootMargin: "100% 0px 100% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [id, setActive]);

  /**
   * Re-measure the section's box whenever the page could have reflowed.
   *
   * The section's own height only changes with the viewport, but its *position*
   * moves whenever anything above it does — the About section is as tall as
   * Prismic has skills — so the document is watched as well as the element.
   * ../About/scene/AboutContent makes the same pair of subscriptions, for the
   * same two reasons.
   *
   * Coalesced to one measurement a frame: on iOS every step of the address
   * bar's animation fires a `resize`, and each of those would otherwise be a
   * forced layout in a frame that is also drawing the tunnel.
   */
  useEffect(() => {
    const el = worksRef.current;
    if (!el) return;

    let pending = 0;

    const measure = () => {
      pending = 0;
      measureWorks();
    };

    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(measure);
    };

    publishWorks(el);

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observer.observe(document.documentElement);
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      publishWorks(null);
    };
  }, []);

  return (
    <section
      ref={worksRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      // Nothing but scroll: everything this section shows is either in the
      // shared canvas or in the fixed card layer below, and the height is what
      // gives the flight something to be driven by.
      className="relative"
      style={{ height: `${heightVh}vh` }}
    >
      <WorksCards works={works} />
    </section>
  );
};

export default Works;
