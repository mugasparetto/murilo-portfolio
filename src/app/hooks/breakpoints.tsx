"use client";

import { useEffect, useMemo, useState } from "react";

type BreakpointValue = number | `${number}px` | `${number}rem` | `${number}em`;
type Breakpoints = Record<string, BreakpointValue>;

type ResponsiveReturn<T extends Breakpoints> = {
  width: number;
  tier: keyof T;
  up: Record<keyof T, boolean>;
  down: Record<keyof T, boolean>;
  between: (
    from: keyof T,
    to: keyof T,
    opts?: { inclusiveEnd?: boolean },
  ) => boolean;
};

export const BREAKPOINTS: Breakpoints = {
  sm: "40rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "96rem",
} as const;

function getRootFontSize(): number {
  const fs = getComputedStyle(document.documentElement).fontSize;
  const n = Number.parseFloat(fs);
  return Number.isFinite(n) && n > 0 ? n : 16;
}

function toPx(value: BreakpointValue): number {
  if (typeof value === "number") return value;

  const v = value.trim().toLowerCase();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;

  if (v.endsWith("px")) return n;
  if (v.endsWith("rem") || v.endsWith("em")) return n * getRootFontSize();
  return n; // assume px
}

export function useBreakpoints<T extends Breakpoints>(
  screens: T,
  options?: {
    defaultTier?: keyof T;
    defaultWidth?: number; // for initial SSR-friendly state
  },
): ResponsiveReturn<T> {
  // stable deps even if screens object is inline
  const signature = useMemo(
    () =>
      Object.entries(screens)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("|"),
    [screens],
  );

  const sorted = useMemo(() => {
    // ascending min-width
    return Object.entries(screens)
      .map(([k, v]) => [k, toPx(v)] as [keyof T, number])
      .sort(([, a], [, b]) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const keys = useMemo(() => sorted.map(([k]) => k), [sorted]);

  const fallbackTier = (sorted[0]?.[0] ?? "base") as keyof T;
  const defaultTier = (options?.defaultTier ?? fallbackTier) as keyof T;

  const [width, setWidth] = useState<number>(options?.defaultWidth ?? 0);
  const [tier, setTier] = useState<keyof T>(defaultTier);
  const [up, setUp] = useState<Record<keyof T, boolean>>(() => {
    const init = {} as Record<keyof T, boolean>;
    for (const k of keys) init[k] = false;
    return init;
  });

  const [down, setDown] = useState<Record<keyof T, boolean>>(() => {
    const init = {} as Record<keyof T, boolean>;
    for (const k of keys) init[k] = false;
    return init;
  });

  useEffect(() => {
    const mins = new Map<keyof T, number>(sorted);

    const pickTier = (w: number) => {
      let current = sorted[0]?.[0] ?? defaultTier;
      for (const [k, min] of sorted) {
        if (w >= min) current = k;
        else break;
      }
      return current;
    };

    const update = () => {
      const w = window.innerWidth;

      // compute tier
      const nextTier = pickTier(w);

      // compute up/down
      const nextUp = {} as Record<keyof T, boolean>;
      const nextDown = {} as Record<keyof T, boolean>;

      // For `down`, use each tier’s max as the next tier’s min - 0.02px (CSS practice).
      // This makes ranges non-overlapping in spirit.
      for (let i = 0; i < sorted.length; i++) {
        const [k, min] = sorted[i];
        const nextMin = sorted[i + 1]?.[1];
        nextUp[k] = w >= min;
        nextDown[k] = nextMin == null ? true : w < nextMin; // “k and down”
      }

      setWidth((prev) => (prev === w ? prev : w));
      setTier((prev) => (prev === nextTier ? prev : nextTier));

      setUp((prev) => {
        for (const k of keys) if (prev[k] !== nextUp[k]) return nextUp;
        return prev;
      });

      setDown((prev) => {
        for (const k of keys) if (prev[k] !== nextDown[k]) return nextDown;
        return prev;
      });
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [sorted, keys, defaultTier]);

  const between = useMemo(() => {
    const mins = new Map<keyof T, number>(sorted);

    return (from: keyof T, to: keyof T, opts?: { inclusiveEnd?: boolean }) => {
      const fromMin = mins.get(from);
      const toMin = mins.get(to);

      if (fromMin == null || toMin == null) return false;

      const start = Math.min(fromMin, toMin);
      const end = Math.max(fromMin, toMin);

      // default: [start, end) like Tailwind ranges (end exclusive)
      if (opts?.inclusiveEnd)
        return width >= start && width >= end
          ? width >= start && width >= end
          : width >= start && width <= end;
      return width >= start && width < end;
    };
  }, [sorted, width]);

  return { width, tier, up, down, between };
}
