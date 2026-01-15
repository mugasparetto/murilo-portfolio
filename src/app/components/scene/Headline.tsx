import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useScroll } from "@react-three/drei";
import * as THREE from "three";
import { progressInWindow, ScrollWindow } from "./ScrollRig";
import { KeyTextField } from "@prismicio/client";

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
  const scroll = useScroll();

  useFrame(() => {
    const t = progressInWindow(scroll.offset, totalPagesCount, scrollWindow);
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
      wrapperClass="super-fixed"
      position={[-3860, 1955, -5500]}
      className="w-[24rem]"
    >
      <div className="flex flex-col pointer-events-none">
        <span
          ref={firstLineRef}
          className="blind-shutter font-bold text-white lowercase text-2xl relative with-star"
          style={{ wordSpacing: 56 }}
        >
          {tagline}
        </span>
        <span
          ref={secondLineRef}
          className="blind-shutter lowercase text-white/90"
        >
          {description}
        </span>
      </div>
    </Html>
  );
}
