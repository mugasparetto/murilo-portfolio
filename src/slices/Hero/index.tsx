import { FC } from "react";
import { Content } from "@prismicio/client";
import { SliceComponentProps } from "@prismicio/react";

import Scene from "../../app/components/scene/Scene";
import { HeroPrimaryProvider } from "./hero-context";

/**
 * Props for `Hero`.
 */
export type HeroProps = SliceComponentProps<Content.HeroSlice>;

/**
 * Component for "Hero" Slices.
 */
const Hero: FC<HeroProps> = ({ slice }) => {
  return (
    <HeroPrimaryProvider primary={slice.primary}>
      <section
        data-slice-type={slice.slice_type}
        data-slice-variation={slice.variation}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene />
      </section>
    </HeroPrimaryProvider>
  );
};

export default Hero;
