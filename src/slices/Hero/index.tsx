"use client";

import { FC, useRef } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import Scene from "./scene/Scene";
import { HeroPrimaryProvider } from "./hero-context";

/**
 * Props for `Hero`.
 */
export type HeroProps = SliceComponentProps<Content.HeroSlice>;

/**
 * Component for "Hero" Slices.
 */
const Hero: FC<HeroProps> = ({ slice }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  return (
    <HeroPrimaryProvider primary={slice.primary}>
      <section
        ref={heroRef}
        data-slice-type={slice.slice_type}
        data-slice-variation={slice.variation}
        style={{ width: "100%", height: "400vh" }}
      >
        <div className="sticky top-0" style={{ height: "100vh" }}>
          <Scene scrollRef={heroRef} />
        </div>
      </section>
    </HeroPrimaryProvider>
  );
};

export default Hero;
