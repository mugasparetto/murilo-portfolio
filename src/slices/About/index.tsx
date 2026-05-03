"use client";

import { FC, useEffect, useRef, useId } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

import Scene from "./scene/Scene";

gsap.registerPlugin(useGSAP, SplitText);

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
      node: (
        <Scene
          scrollWindow={{ startVh: 345, endVh: 460 }}
          content={{
            head: {
              title: slice.primary.head_title,
              description: slice.primary.head_description,
            },
            eyes: {
              title: slice.primary.eyes_title,
              description: slice.primary.eyes_description,
            },
            mouth: {
              title: slice.primary.mouth_title,
              description: slice.primary.mouth_description,
            },
          }}
        />
      ),
      active: true,
    });

    return () => remove(id);
  }, [id, register, remove]);

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
      className="h-[400vh] relative"
    ></section>
  );
};

export default About;
