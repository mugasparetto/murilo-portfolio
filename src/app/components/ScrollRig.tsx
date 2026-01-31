"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useScrollProgress } from "@/app/hooks/ScrollProgress";
import { CameraPose } from "./SceneManager";

export type RigPose = {
  /**
   * Camera position in world space.
   */
  position: THREE.Vector3 | [number, number, number];

  /**
   * Camera look target in world space.
   */
  lookAt: THREE.Vector3 | [number, number, number];
};

export type PoseWindow = {
  /**
   * 1-based, inclusive start page.
   * Example: startPage=3 means "begin transitioning at the start of page 3"
   */
  startPage: number;

  /**
   * 1-based, exclusive end page.
   * Example: endPage=4 means "stop transitioning at the start of page 4"
   *
   * For the very last page in a N-page ScrollControls:
   * use endPage = N + 1
   */
  endPage: number;

  /**
   * Pose at the start of this window (t=0).
   */
  from: RigPose;

  /**
   * Pose at the end of this window (t=1).
   */
  to: RigPose;

  /**
   * Optional easing for this window’s interpolation (t in [0..1]).
   * Defaults to linear.
   */
  ease?: (t: number) => number;
};

export type ScrollRigProps = {
  pages: number;
  windows: PoseWindow[];
  cameraRef?: React.RefObject<THREE.Camera | null>;
  smoothing?: number;

  basePoseRef?: React.RefObject<CameraPose | null>;

  /**
   * If false, ScrollRig will NOT write to the camera, only to basePoseRef.
   * Recommended: set false when using ParallaxRig.
   */
  applyToCamera?: boolean;

  /**
   * Ensures ordering vs other camera writers (controls/effects).
   * Higher runs later.
   */
  priority?: number;
};

function toV3(v: THREE.Vector3 | [number, number, number]) {
  return Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : v;
}

export function progressInWindow(
  offset: number,
  pages: number,
  w: { startPage: number; endPage: number },
) {
  const p = 1 / pages;
  const a = (w.startPage - 1) * p;
  const b = (w.endPage - 1) * p;
  if (b <= a) return 0;
  return THREE.MathUtils.clamp((offset - a) / (b - a), 0, 1);
}

function damp(current: number, target: number, lambda: number, dt: number) {
  // exponential smoothing; lambda ~ 8..20 feels good
  if (lambda <= 0) return target;
  const k = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * k;
}

/**
 * ScrollRig (pose-based)
 *
 * Instead of moving an object by distance, this rig interpolates the camera
 * between discrete poses (position + lookAt target) across scroll windows.
 */
export default function ScrollRig({
  pages,
  windows,
  cameraRef,
  smoothing = 0,
  basePoseRef,
  applyToCamera,
}: ScrollRigProps) {
  const { camera } = useThree();
  const { scrollProgress } = useScrollProgress();

  // Sort once for deterministic behavior if user passes out-of-order windows
  const sorted = useMemo(() => {
    const w = [...windows];
    w.sort((a, b) => a.startPage - b.startPage);
    return w;
  }, [windows]);

  // Cache first/last poses for outside-window holds
  const firstFromPos = useMemo(
    () => toV3(sorted[0]?.from.position ?? [0, 0, 5]).clone(),
    [sorted],
  );
  const firstFromLook = useMemo(
    () => toV3(sorted[0]?.from.lookAt ?? [0, 0, 0]).clone(),
    [sorted],
  );

  // A reusable desired pose vector (no allocations per frame)
  const desiredPos = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());

  // Smoothed current pose (what we actually apply)
  const currentPos = useRef(new THREE.Vector3().copy(firstFromPos));
  const currentLook = useRef(new THREE.Vector3().copy(firstFromLook));

  useFrame((state, dt) => {
    const cam = cameraRef?.current ?? camera;
    const offset = scrollProgress.current;

    if (sorted.length === 0) return;

    // Determine which pose we "should" be at for this scroll offset:
    // - If inside a window: interpolate from->to for that window
    // - Else: hold previous window's to (or first window's from before it starts)
    let foundActive = false;

    // Default: before first window => first.from
    desiredPos.current.copy(firstFromPos);
    desiredLook.current.copy(firstFromLook);

    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i];

      const p = 1 / pages;
      const windowStart = (w.startPage - 1) * p;
      const windowEnd = (w.endPage - 1) * p;

      // If we're before this window starts:
      if (offset < windowStart) {
        if (i === 0) {
          // already set to first.from
        } else {
          // between windows => hold previous.to
          const prev = sorted[i - 1];
          desiredPos.current.copy(toV3(prev.to.position));
          desiredLook.current.copy(toV3(prev.to.lookAt));
        }
        foundActive = true;
        break;
      }

      // If we're inside this window:
      if (offset >= windowStart && offset <= windowEnd) {
        const rawT = progressInWindow(offset, pages, w); // 0..1
        const t = w.ease ? w.ease(rawT) : rawT;

        const fromPos = toV3(w.from.position);
        const toPos = toV3(w.to.position);
        const fromLook = toV3(w.from.lookAt);
        const toLook = toV3(w.to.lookAt);

        desiredPos.current.copy(fromPos).lerp(toPos, t);
        desiredLook.current.copy(fromLook).lerp(toLook, t);

        foundActive = true;
        break;
      }

      // Else: we're after this window; keep looping to find later windows,
      // and if none match we'll fall back to last.to below.
    }

    // After last window ends => hold last.to
    if (!foundActive) {
      const last = sorted[sorted.length - 1];
      desiredPos.current.copy(toV3(last.to.position));
      desiredLook.current.copy(toV3(last.to.lookAt));
    }

    // Smooth position + look target (optional)
    if (smoothing > 0) {
      currentPos.current.x = damp(
        currentPos.current.x,
        desiredPos.current.x,
        smoothing,
        dt,
      );
      currentPos.current.y = damp(
        currentPos.current.y,
        desiredPos.current.y,
        smoothing,
        dt,
      );
      currentPos.current.z = damp(
        currentPos.current.z,
        desiredPos.current.z,
        smoothing,
        dt,
      );

      currentLook.current.x = damp(
        currentLook.current.x,
        desiredLook.current.x,
        smoothing,
        dt,
      );
      currentLook.current.y = damp(
        currentLook.current.y,
        desiredLook.current.y,
        smoothing,
        dt,
      );
      currentLook.current.z = damp(
        currentLook.current.z,
        desiredLook.current.z,
        smoothing,
        dt,
      );
    } else {
      currentPos.current.copy(desiredPos.current);
      currentLook.current.copy(desiredLook.current);
    }

    if (basePoseRef?.current) {
      basePoseRef.current.position.copy(currentPos.current);
      basePoseRef.current.target.copy(currentLook.current);
    }

    const shouldApply = applyToCamera ?? !basePoseRef?.current; // default: if no basePoseRef, apply

    if (shouldApply) {
      cam.position.copy(currentPos.current);
      cam.lookAt(currentLook.current);
    }
  });

  return null;
}
