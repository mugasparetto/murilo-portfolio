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
  const textRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { register, remove, setActive } = useSceneRegistry();

  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const playedRef = useRef(false);

  // Register scene once
  useEffect(() => {
    register({
      id,
      priority: 20,
      node: <Scene scrollWindow={{ startVh: 345, endVh: 460 }} />,
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

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (playedRef.current) return;

        playedRef.current = true;
        tlRef.current?.play();
        io.disconnect();
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [slice.primary.about]);

  useGSAP(
    () => {
      const root = textRef.current;
      if (!root) return;

      // Split into lines
      const split = SplitText.create(root, { type: "lines" });

      // Wrap each line in a mask
      split.lines.forEach((line) => {
        const mask = document.createElement("span");
        mask.style.display = "block";
        mask.style.overflow = "hidden";

        const el = line as HTMLElement;
        el.style.display = "block";

        el.parentNode?.insertBefore(mask, el);
        mask.appendChild(el);
      });

      // Start below the mask
      gsap.set(split.lines, { yPercent: 120 });

      // Animate upward reveal (no opacity)
      tlRef.current = gsap.timeline({ paused: true }).to(split.lines, {
        yPercent: 0,
        duration: 1.5,
        ease: "power4.out",
        stagger: 0.15,
      });
    },
    {
      scope: textRef,
    },
  );

  return (
    <section
      ref={aboutRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className="h-[400vh] relative"
    >
      <div className="sticky top-0 grid grid-cols-12 h-screen">
        <p
          ref={textRef}
          className="col-start-7 col-end-13 pr-20 absolute top-[50%] translate-y-[-50%] text-4xl"
        >
          {slice.primary.about}
        </p>
      </div>
    </section>
  );
};

export default About;
