"use client";

import {
  createContext,
  useContext,
  useRef,
  useLayoutEffect,
  RefObject,
} from "react";
import { useLenis } from "lenis/react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type ScrollProgressValue = {
  scrollProgress: React.MutableRefObject<number>;
  scrollElement: HTMLElement | null;
};

const ScrollProgressContext = createContext<ScrollProgressValue | null>(null);

export function useScrollProgress(): ScrollProgressValue {
  const ctx = useContext(ScrollProgressContext);
  if (!ctx)
    throw new Error(
      "useScrollProgress must be used within ScrollProgressProvider"
    );
  return ctx;
}

export { ScrollProgressContext };

type Props = {
  children: React.ReactNode;
  damping?: number;
  elementRef: RefObject<HTMLElement | null>;
  elementTop: RefObject<number>;
  elementHeight: RefObject<number>;
};

export function ScrollProgressProvider({
  children,
  damping = 6,
  elementRef,
  elementTop,
  elementHeight,
}: Props) {
  const lenis = useLenis();

  useLayoutEffect(() => {
    const measure = () => {
      const el = elementRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      elementTop.current = rect.top + window.scrollY;
      elementHeight.current = rect.height;
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [elementHeight, elementRef, elementTop]);

  const scrollProgress = useRef<number>(0);

  useFrame((state, delta) => {
    lenis?.raf(state.clock.elapsedTime * 1000);
    const scrollY = lenis?.animatedScroll ?? window.scrollY;

    const start = elementTop.current;
    const end = start + elementHeight.current - window.innerHeight;
    if (end <= start) return;

    const raw = THREE.MathUtils.clamp((scrollY - start) / (end - start), 0, 1);
    scrollProgress.current = THREE.MathUtils.damp(
      scrollProgress.current,
      raw,
      damping,
      delta
    );
  });

  return (
    <ScrollProgressContext.Provider
      value={{ scrollProgress, scrollElement: elementRef.current }}
    >
      {children}
    </ScrollProgressContext.Provider>
  );
}
