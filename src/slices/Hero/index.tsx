"use client";

import { FC, useRef, useId, useEffect } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import Experience from "./scene/Experience";
import { HeroPrimaryProvider } from "./hero-context";
import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

/**
 * Props for `Hero`.
 */
export type HeroProps = SliceComponentProps<Content.HeroSlice>;

/**
 * Component for "Hero" Slices.
 */
const Hero: FC<HeroProps> = ({ slice }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { register, remove, setActive } = useSceneRegistry();

  // Register scene once
  useEffect(() => {
    register({
      id,
      priority: 10,
      node: (
        <HeroPrimaryProvider primary={slice.primary}>
          <Experience scrollRef={heroRef} />
        </HeroPrimaryProvider>
      ),
      active: true,
    });

    return () => remove(id);
  }, [id, slice.primary, register, remove]);

  // Toggle active when slice is in view
  // useEffect(() => {
  //   const el = heroRef.current;
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
      ref={heroRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      style={{ width: "100%", height: "320vh" }}
    ></section>
  );
};

export default Hero;
