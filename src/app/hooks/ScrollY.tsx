// ScrollY.tsx
"use client";

import { createContext, useContext, useRef } from "react";
import { useLenis } from "lenis/react";
import { useFrame } from "@react-three/fiber";

type ScrollYValue = { scrollY: React.MutableRefObject<number> };
const ScrollYContext = createContext<ScrollYValue | null>(null);

export function useScrollY() {
  const ctx = useContext(ScrollYContext);
  if (!ctx) throw new Error("useScrollY must be used within ScrollYProvider");
  return ctx;
}

export function ScrollYProvider({ children }: { children: React.ReactNode }) {
  const lenis = useLenis();
  const scrollY = useRef(0);

  useFrame((state) => {
    lenis?.raf(state.clock.elapsedTime * 1000);
    scrollY.current = lenis?.animatedScroll ?? window.scrollY;
  });

  return (
    <ScrollYContext.Provider value={{ scrollY }}>
      {children}
    </ScrollYContext.Provider>
  );
}
