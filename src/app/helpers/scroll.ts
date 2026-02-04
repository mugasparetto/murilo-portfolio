import * as THREE from "three";
import { RefObject, useRef, useMemo, useEffect } from "react";

export const easeCos = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

// Convert weights (e.g. [0.25,0.5,0.25]) into cumulative ranges in 0..1
export const makeRanges = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => {
    const start = acc;
    acc += w / sum;
    return { start, end: acc };
  });
};

// Local eased progress for segment i
export const segmentProgress = (
  t: number,
  ranges: { start: number; end: number }[],
  i: number,
) => {
  const r = ranges[i];
  const local = (t - r.start) / (r.end - r.start);
  return easeCos(THREE.MathUtils.clamp(local, 0, 1));
};

export type VhWindow = {
  startVh: number; // inclusive
  endVh: number; // exclusive
};

export function progressInVhWindow(vh: number, w: VhWindow) {
  const a = w.startVh;
  const b = w.endVh;
  if (b <= a) return 0;
  return THREE.MathUtils.clamp((vh - a) / (b - a), 0, 1);
}

/**
 * Absolute scroll position expressed in vh from the top of the scroll container.
 *
 * - If scrollContainerRef is provided:
 *    - reads el.scrollTop
 *    - uses el.clientHeight as the "vh reference"
 * - Otherwise:
 *    - reads window/document scrollTop
 *    - uses window.innerHeight
 */
export function useScrollVhAbsolute(
  scrollContainerRef?: RefObject<HTMLElement | null>,
) {
  const scrollVhRef = useRef(0);

  useEffect(() => {
    const getViewportH = () => {
      const el = scrollContainerRef?.current;
      return el ? el.clientHeight || 1 : window.innerHeight || 1;
    };

    const getScrollTop = () => {
      const el = scrollContainerRef?.current;
      if (el) return el.scrollTop || 0;
      return window.scrollY || document.documentElement.scrollTop || 0;
    };

    const update = () => {
      const vh = (getScrollTop() / getViewportH()) * 100;
      scrollVhRef.current = vh;
    };

    update();

    const target: any = scrollContainerRef?.current ?? window;
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollContainerRef]);

  return scrollVhRef;
}

/**
 * Convenience wrapper:
 * given current absolute scrollVh and a window, compute
 * - t: window progress 0..1
 * - phases: precomputed ranges
 * - phase(i): eased local progress for phase i
 */
export function useVhWindowPhases(
  scrollVhRef: RefObject<number>,
  window: VhWindow,
  phaseWeights: number[],
) {
  const phases = useMemo(() => makeRanges(phaseWeights), [phaseWeights]);

  return useMemo(() => {
    return {
      phases,
      get t() {
        return progressInVhWindow(scrollVhRef.current, window);
      },
      phase(i: number) {
        return segmentProgress(
          progressInVhWindow(scrollVhRef.current, window),
          phases,
          i,
        );
      },
    };
    // NOTE: scrollVhRef.current changes without changing ref identity,
    // so t/phase(...) are computed at call time (via getter / function).
  }, [scrollVhRef, window.startVh, window.endVh, phases]);
}
