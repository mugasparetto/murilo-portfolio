"use client";

import { FC, useEffect, useRef, useId } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

import Scene from "./scene/Scene";

/**
 * Props for `About`.
 */
export type AboutProps = SliceComponentProps<Content.AboutSlice>;

/**
 * Component for "About" Slices.
 */
const About: FC<AboutProps> = ({ slice }) => {
  const aboutRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { register, remove, setActive } = useSceneRegistry();

  // Register scene once
  useEffect(() => {
    register({
      id,
      priority: 20,
      node: <Scene />,
      active: true,
    });

    return () => remove(id);
  }, [id, slice.primary, register, remove]);

  // Toggle active when slice is in view
  // useEffect(() => {
  //   const el = aboutRef.current;
  //   if (!el) return;

  //   const io = new IntersectionObserver(
  //     ([entry]) => setActive(id, entry.isIntersecting),
  //     // tweak: becomes active when the section is near viewport
  //     { root: null, threshold: 0.01, rootMargin: "20% 0px 20% 0px" },
  //   );

  //   io.observe(el);
  //   return () => io.disconnect();
  // }, [id, setActive]);

  return (
    <section
      ref={aboutRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      style={{ height: "100vh" }}
    >
      Placeholder component for about (variation: {slice.variation}) slices.
      <br />
      <strong>You can edit this slice directly in your code editor.</strong>
      {/**
       * 💡 Use the Prismic MCP server with your code editor
       * 📚 Docs: https://prismic.io/docs/ai#code-with-prismics-mcp-server
       */}
    </section>
  );
};

export default About;
