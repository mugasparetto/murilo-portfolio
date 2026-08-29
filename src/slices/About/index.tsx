"use client";

import { CSSProperties, FC, useEffect, useMemo, useRef, useId } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import gsap from "gsap";
import SplitText from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

import { useSceneRegistry } from "@/app/hooks/SceneRegistry";
import { blockInset } from "@/slices/Hero/scene/Name";

import Scene from "./scene/Scene";
import { setAboutOnScreen } from "./scene/aboutVisibility";
import AboutContent, { sectionVh } from "./scene/AboutContent";

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

  /**
   * How much scroll this section is worth.
   *
   * A function of the skill count rather than a figure typed here, because
   * from `lg` up the still half of this section is *pinned*: it is one
   * `sticky top-0 h-screen` box, so nothing about the section's height is a
   * measurement of its content — it is purely how much wheel the card stack is
   * given to play through. Typed as a class, a fifth skill added in Prismic
   * would get the same 350vh four of them share, with every beat shortening to
   * make room. See <AboutContent />, which sizes the cards' flow gaps off the
   * same three figures so the two can't drift.
   *
   * Four skills come out at exactly the 350vh this section has always been.
   *
   * Only applied from `lg` up — below it the section is an ordinary column and
   * its height is whatever the copy needs, so this goes through a custom
   * property that a `lg:` class picks up rather than straight onto `height`.
   */
  const count = slice.primary.skills.length;
  const height = useMemo(
    () => ({ "--about-h": `${sectionVh(count)}vh` }) as CSSProperties,
    [count],
  );

  // Register scene once
  useEffect(() => {
    register({
      id,
      name: "scene-about",
      priority: 20,
      node: <Scene />,
      active: true,
    });

    return () => remove(id);
  }, [id, register, remove]);

  /**
   * Whether the section is on screen at all, for the two things on it that
   * would otherwise keep working the whole way down the page: <SolidIcon />'s
   * ticker and the meta list's clock — see ./scene/aboutVisibility.
   *
   * This used to fall out of <AboutOverlayDriver />, which was already deciding
   * every frame whether the layer it was translating had left the screen. With
   * the section back in normal flow there is nothing to translate and nothing
   * to derive it from, and an observer is what the answer always wanted to be:
   * it is a question about a box and the viewport, and it costs nothing between
   * the two crossings a page-load actually has.
   *
   * Tighter than the `setActive` margin below on purpose. That one keeps the
   * scene *drawn* well beyond the fold so the camera flight has something to
   * fly to; this one is about work nobody can see the result of, so it wants
   * the plain answer with no margin at all.
   */
  useEffect(() => {
    const el = aboutRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => setAboutOnScreen(entry.isIntersecting),
      { root: null, threshold: 0 },
    );

    io.observe(el);

    return () => {
      io.disconnect();
      // a slice that unmounts mid-scroll would otherwise leave the work hung
      // off the flag running behind it
      setAboutOnScreen(false);
    };
  }, []);

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
      style={{ ...blockInset, ...height }}
      // Below `lg` a plain column, and the three blocks fall into it in source
      // order. From `lg` up a fixed-height block the still half pins inside —
      // see <AboutContent />, which is the whole composition and returns the
      // three siblings this positions.
      //
      // `blockInset` rides on the section rather than on any one of them, so
      // all three inherit the same `px-(--block-inset)` the hero's overlays
      // line up against.
      className="relative flex flex-col lg:block lg:h-(--about-h)"
    >
      <AboutContent
        sectionRef={aboutRef}
        title={slice.primary.title}
        description={slice.primary.description}
        numbers={slice.primary.numbers}
        skills={slice.primary.skills}
      />
    </section>
  );
};

export default About;
