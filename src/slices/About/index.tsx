"use client";

import { FC, useEffect, useRef, useId } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";

import Scene from "./scene/Scene";
import AboutOverlay from "./scene/AboutOverlay";
import AboutContent from "./scene/AboutContent";

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
      name: "scene-about",
      priority: 20,
      node: <Scene scrollWindow={{ startVh: 345, endVh: 500 }} />,
      active: true,
    });

    return () => remove(id);
  }, [id, register, remove]);

  // Drawn while the section is anywhere near the viewport, hidden once it is a
  // long way off — see {@link setSectionOnScreen}. `active` drives `visible` on
  // the group now rather than filtering the entry out of the scene, so this
  // costs a frame either way and nothing is rebuilt on the way back.
  //
  // A whole viewport of margin on each side, which is far more than the picture
  // needs and deliberately so: the two sections share a camera flight, and the
  // one being flown away from has to stay drawn until it is certainly out of
  // frame. Tighten it by measuring — the section that pops is the one whose
  // margin is too small.
  useEffect(() => {
    const el = aboutRef.current;
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
      ref={aboutRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className="h-[350vh] relative"
    >
      {/* DOM, so the composer's vignette and the pointer parallax can't reach
          it; <AboutOverlayDriver /> inside the scene slides it with the
          section */}
      <AboutOverlay sectionRef={aboutRef}>
        <AboutContent
          title={slice.primary.title}
          description={slice.primary.description}
          numbers={slice.primary.numbers}
          skills={slice.primary.skills}
        />
      </AboutOverlay>
    </section>
  );
};

export default About;
