import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { progressInWindow, ScrollWindow } from "./ScrollRig";
import { KeyTextField } from "@prismicio/client";
import { useScrollProgress } from "@/app/hooks/ScrollProgress";
import { useBreakpoints, BREAKPOINTS } from "@/app/hooks/breakpoints";

type Props = {
  tagline: KeyTextField;
  description: KeyTextField;
  totalPagesCount: number;
  scrollWindow: ScrollWindow;
};

export default function Headline({
  tagline = "",
  description = "",
  totalPagesCount = 0,
  scrollWindow = { startPage: 1, endPage: 2 },
}: Props) {
  const firstLineRef = useRef<HTMLSpanElement | null>(null);
  const secondLineRef = useRef<HTMLSpanElement | null>(null);
  const { scrollProgress } = useScrollProgress();
  const { up } = useBreakpoints(BREAKPOINTS);

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
      position={[!up.md ? 0 : -3860, !up.md ? 90 : 1955, !up.md ? 0 : -5500]}
      className="w-[22rem] md:w-[24rem] opacity-75 md:opacity-100 px-5! md:px-0! max-w-100 left-[50%]! md:left-0! translate-x-[-50%] md:translate-x-0"
    >
      <div className="flex flex-col pointer-events-none">
        <span
          ref={firstLineRef}
          className="blind-shutter font-bold text-white lowercase md:text-2xl text-lg relative with-star"
          style={{ wordSpacing: !up.md ? 32 : 56 }}
        >
          {tagline}
        </span>
        <span
          ref={secondLineRef}
          className="blind-shutter lowercase text-white/90 text-sm md:text-base"
          style={{ letterSpacing: !up.md ? -0.2 : undefined }}
        >
          {description}
        </span>
      </div>
    </Html>
  );
}
