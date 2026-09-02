"use client";

import { FC, useEffect, useId, useRef } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

import Scene from "./scene/Scene";

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

  return (
    <section
      ref={worksRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      // a screen of its own, so there is something to scroll into and see the
      // cube against
      className="relative h-screen"
    >
      {/**
       * 💡 Use the Prismic MCP server with your code editor
       * 📚 Docs: https://prismic.io/docs/ai#code-with-prismics-mcp-server
       */}
    </section>
  );
};

export default Works;
