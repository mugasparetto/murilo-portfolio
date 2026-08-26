"use client";

import { FC, useRef, useId, useEffect } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import Scene from "./scene/Scene";
import NameOverlay from "./scene/Name";
import HeadlineOverlay from "./scene/Headline";
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
      name: "scene-hero",
      priority: 10,
      node: <Scene scrollRef={heroRef} />,
      active: true,
    });

    return () => remove(id);
  }, [id, slice.primary, register, remove]);

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
    const el = heroRef.current;
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
      ref={heroRef}
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className="h-[250vh]"
    >
      {/* DOM, so the composer's vignette and the pointer parallax can't reach
          them; the drivers inside the scene move them with the camera */}
      <NameOverlay
        firstName={slice.primary.first_name}
        lastName={slice.primary.last_name}
      />
      <HeadlineOverlay
        tagline={slice.primary.tag_line}
        description={slice.primary.description}
      />
    </section>
  );
};

export default Hero;
