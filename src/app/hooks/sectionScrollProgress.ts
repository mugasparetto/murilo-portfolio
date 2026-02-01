"use client";

import { RefObject, useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScrollY } from "./ScrollY";

export function useSectionScrollProgress(
  sectionRef: RefObject<HTMLElement | null>,
  { damping = 100 }: { damping?: number } = {},
) {
  const { scrollY } = useScrollY();

  const top = useRef(0);
  const height = useRef(0);
  const progress = useRef(0);

  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      top.current = rect.top + window.scrollY;
      height.current = rect.height;
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sectionRef]);

  useFrame((_, delta) => {
    if (!sectionRef.current) return;

    const start = top.current;
    const end = top.current + height.current - window.innerHeight;

    const raw = THREE.MathUtils.clamp(
      (scrollY.current - start) / (end - start),
      0,
      1,
    );

    progress.current = THREE.MathUtils.damp(
      progress.current,
      raw,
      damping,
      delta,
    );
  });

  return { progress, sectionRef };
}
