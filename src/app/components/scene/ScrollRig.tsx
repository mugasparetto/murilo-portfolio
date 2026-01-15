"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useScroll } from "@react-three/drei";

export type ScrollWindow = {
  /**
   * 1-based, inclusive start page.
   * Example: startPage=3 means "begin moving at the start of page 3"
   */
  startPage: number;

  /**
   * 1-based, exclusive end page.
   * Example: endPage=4 means "stop moving at the start of page 4"
   *
   * For the very last page in a N-page ScrollControls:
   * use endPage = N + 1
   */
  endPage: number;

  /**
   * How many "units" of travel this window contributes when fully scrolled through.
   * Default: 1 (one segment).
   */
  weight?: number;
};

export type ScrollRigProps = {
  /**
   * Total pages passed to <ScrollControls pages={...} />
   */
  pages: number;

  /**
   * Which page ranges should actually drive motion.
   * All other ranges are effectively "frozen" (motion holds).
   */
  windows: ScrollWindow[];

  /**
   * What to move.
   * - If you pass targetRef, it will move that object (recommended).
   * - If you don't, it will move the default R3F scene (less common).
   */
  targetRef?: React.RefObject<THREE.Object3D | null>;

  /**
   * Axis to move along (default: "y")
   */
  axis?: "x" | "y" | "z";

  /**
   * Distance per full window "weight".
   * - "viewport": distance is multiplied by viewport width/height (depending on axis)
   * - "world": distance is used directly as world units
   */
  unit?: "viewport" | "world";

  /**
   * For unit="viewport", how many viewports of travel per weight.
   * For example, 1 means each weight moves by 1 viewport (height for y, width for x).
   */
  viewportDistancePerWeight?: number;

  /**
   * For unit="world", how many world units of travel per weight.
   */
  worldDistancePerWeight?: number;

  /**
   * Direction multiplier (default: -1).
   * Typical scroll down = move scene down => -1 on Y.
   */
  direction?: number;

  /**
   * Smooth the motion (simple exponential damping).
   * 0 disables smoothing.
   */
  smoothing?: number;
};

export function progressInWindow(
  offset: number,
  pages: number,
  w: ScrollWindow
) {
  const p = 1 / pages;
  const a = (w.startPage - 1) * p;
  const b = (w.endPage - 1) * p;
  if (b <= a) return 0;
  return THREE.MathUtils.clamp((offset - a) / (b - a), 0, 1);
}

/**
 * Convert ScrollControls offset (0..1) into a piecewise-linear progress value.
 * Progress is the sum of contributions from each window:
 * - before a window: contributes 0
 * - inside a window: contributes 0..weight
 * - after a window: contributes weight
 *
 * Result range: [0 .. sum(weights)]
 */
function windowedProgress(
  offset: number,
  pages: number,
  windows: ScrollWindow[]
) {
  let total = 0;
  for (const w of windows) {
    const weight = w.weight ?? 1;
    total += progressInWindow(offset, pages, w) * weight;
  }
  return total;
}

function damp(current: number, target: number, lambda: number, dt: number) {
  // exponential smoothing; lambda ~ 8..20 feels good
  if (lambda <= 0) return target;
  const k = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * k;
}

/**
 * ScrollRig
 * Use with <ScrollControls pages={N}> and define "windows" for when motion should happen.
 *
 * Example:
 * windows={[
 *   { startPage: 3, endPage: 4 }, // scroll only on page 3
 *   { startPage: 6, endPage: 7 }, // scroll only on page 6 (endPage is N+1)
 * ]}
 */
export default function ScrollRig({
  pages,
  windows,
  targetRef,
  axis = "y",
  unit = "viewport",
  viewportDistancePerWeight = 1,
  worldDistancePerWeight = 1000,
  direction = -1,
  smoothing = 0,
}: ScrollRigProps) {
  const scroll = useScroll();
  const { viewport, scene } = useThree();

  const weightsSum = useMemo(
    () => windows.reduce((acc, w) => acc + (w.weight ?? 1), 0),
    [windows]
  );

  useFrame((state, dt) => {
    const target = targetRef?.current ?? scene;

    // Progress in [0..sum(weights)]
    const prog = windowedProgress(scroll.offset, pages, windows);

    // Convert progress -> distance
    let distPerWeight: number;
    if (unit === "viewport") {
      const v =
        axis === "x"
          ? viewport.width
          : axis === "y"
            ? viewport.height
            : viewport.height;
      distPerWeight = v * viewportDistancePerWeight;
    } else {
      distPerWeight = worldDistancePerWeight;
    }

    const desired = direction * prog * distPerWeight;

    // Apply on chosen axis
    const pos = target.position;

    if (axis === "x") {
      pos.x = smoothing > 0 ? damp(pos.x, desired, smoothing, dt) : desired;
    } else if (axis === "y") {
      pos.y = smoothing > 0 ? damp(pos.y, desired, smoothing, dt) : desired;
    } else {
      pos.z = smoothing > 0 ? damp(pos.z, desired, smoothing, dt) : desired;
    }

    // If you ever need: you can use weightsSum for debugging/normalizing
    void weightsSum;
  });

  return null;
}
