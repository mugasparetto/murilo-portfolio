import { useState, useRef } from "react";
import { useFrame } from "@react-three/fiber";

export function useAdaptiveGate({ disableBelow = 30, enableAbove = 45 } = {}) {
  const [enabled, setEnabled] = useState(true);

  const frames = useRef(0);
  const last = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();

    if (now - last.current >= 1000) {
      const fps = frames.current;
      frames.current = 0;
      last.current = now;

      setEnabled((prev) => {
        if (prev && fps < disableBelow) return false;
        if (!prev && fps > enableAbove) return true;
        return prev;
      });
    }
  });

  return enabled;
}
