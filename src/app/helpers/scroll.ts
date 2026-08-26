import * as THREE from "three";
import { RefObject, useRef, useMemo, useEffect } from "react";

import { useScrollY } from "@/app/hooks/ScrollY";
import { pxToVh } from "./viewport";

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
 *    - reads el.scrollTop on the element's own `scroll` event
 *    - uses el.clientHeight as the "vh reference"
 * - Otherwise:
 *    - takes the document scroll from <ScrollYProvider />, which reads it once
 *      a frame — see there for why a `scroll` listener is the wrong source
 *    - converts with {@link pxToVh}, i.e. the CSS `vh` unit rather than
 *      `window.innerHeight`; see the helper for why those differ on iOS
 */
export function useScrollVhAbsolute(
  scrollContainerRef?: RefObject<HTMLElement | null>,
): RefObject<number> {
  // The document scroll is the shared per-frame read — see <ScrollYProvider />
  // for why a `scroll` listener is the wrong source for it on iOS. Handed back
  // as a getter rather than a cached ref so it can't be a frame stale either:
  // callers read `.current` from inside their own `useFrame`, which runs after
  // the provider's, and the value is derived at that moment rather than
  // whenever a listener last happened to fire.
  const { scrollY } = useScrollY();

  const containerVh = useRef(0);

  // A container scroller keeps the listener: nothing passes one today, and an
  // element's `scrollTop` is not reported through the compositor gap the
  // document's is.
  useEffect(() => {
    const el = scrollContainerRef?.current;
    if (!el) return;

    const update = () => {
      containerVh.current = (el.scrollTop / (el.clientHeight || 1)) * 100;
    };

    update();

    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollContainerRef]);

  return useMemo(
    () => ({
      get current() {
        return scrollContainerRef?.current
          ? containerVh.current
          : pxToVh(scrollY.current);
      },
    }),
    [scrollContainerRef, scrollY],
  );
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

export const rangeProgress = (t: number, start: number, end: number) => {
  const local = (t - start) / (end - start);
  return easeCos(THREE.MathUtils.clamp(local, 0, 1));
};
