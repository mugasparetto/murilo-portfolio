import { RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { progressInWindow, ScrollWindow } from "@/app/components/ScrollRig";
import { KeyTextField } from "@prismicio/client";
import { useBreakpoints, BREAKPOINTS } from "@/app/hooks/breakpoints";

type Props = {
  tagline: KeyTextField;
  description: KeyTextField;
  totalPagesCount: number;
  scrollWindow: ScrollWindow;
  scrollProgress: RefObject<number>;
};

type Tier = keyof typeof BREAKPOINTS;

const RESPONSIVE: Record<
  Tier,
  {
    position: { x: number; y: number };
  }
> = {
  md: {
    position: { x: -3000, y: 2400 },
  },
  lg: {
    position: { x: -3400, y: 2255 },
  },
  xl: {
    position: { x: -3660, y: 2150 },
  },
  "2xl": {
    position: { x: -3860, y: 1955 },
  },
};

export default function Headline({
  tagline = "",
  description = "",
  totalPagesCount = 0,
  scrollWindow = { startPage: 1, endPage: 2 },
  scrollProgress,
}: Props) {
  const firstLineRef = useRef<HTMLSpanElement | null>(null);
  const secondLineRef = useRef<HTMLSpanElement | null>(null);
  const { up, tier } = useBreakpoints(BREAKPOINTS);

  useFrame(() => {
    const t = progressInWindow(
      scrollProgress.current,
      totalPagesCount,
      scrollWindow,
    );
    const open = 1 - THREE.MathUtils.clamp(t, 0, 1); // 1..0

    const fL = firstLineRef.current;
    if (!fL) return;

    fL.style.setProperty("--open", String(open));

    const el = secondLineRef.current;

    if (!el) return;

    el.style.setProperty("--open", String(open));
  });

  return (
    <Html
      fullscreen={!up.md ? true : false}
      wrapperClass="fixed!"
      position={[
        !up.md ? 0 : RESPONSIVE[tier]?.position.x,
        !up.md ? 90 : RESPONSIVE[tier]?.position.y,
        !up.md ? 0 : -5500,
      ]}
      className="w-[22rem] md:w-[16rem] xl:w-[18rem] opacity-75 md:opacity-100 px-5! md:px-0! max-w-100 left-[50%]! md:left-0! translate-x-[-50%] md:translate-x-0"
    >
      <div className="flex flex-col pointer-events-none">
        <span
          ref={firstLineRef}
          className="blind-shutter font-bold text-white lowercase md:text-xl xl:text-2xl text-lg relative with-star"
          style={{ wordSpacing: !up.md ? 32 : 56 }}
        >
          {tagline}
        </span>
        <span
          ref={secondLineRef}
          className="blind-shutter lowercase text-white/90 text-sm md:text-sm xl:text-base"
          style={{ letterSpacing: !up.md ? -0.2 : undefined }}
        >
          {description}
        </span>
      </div>
    </Html>
  );
}
