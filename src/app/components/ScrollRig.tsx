"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraPose } from "./SceneManager";

export type RigPose = {
  position: THREE.Vector3 | [number, number, number];
  lookAt: THREE.Vector3 | [number, number, number];
};

export type PoseWindow = {
  window: Window;
  from: RigPose;
  to: RigPose;
  ease?: (t: number) => number;
};

export type VhWindow = {
  /** Inclusive start in vh from the top of the page */
  startVh: number;
  /** Exclusive end in vh from the top of the page */
  endVh: number;
};

export type PoseWindowVh = {
  window: VhWindow;
  from: RigPose;
  to: RigPose;
  ease?: (t: number) => number;
};

export type ScrollRigProps = {
  windows: PoseWindowVh[];

  cameraRef?: React.RefObject<THREE.Camera | null>;
  basePoseRef?: React.RefObject<CameraPose | null>;

  smoothing?: number;
  applyToCamera?: boolean;
  priority?: number;

  /**
   * Optional: use a custom scroll container instead of window/document.
   * If provided, we’ll read container.scrollTop.
   */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
};

function toV3(v: THREE.Vector3 | [number, number, number]) {
  return Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : v;
}

function progressInVhWindow(vh: number, w: VhWindow) {
  const a = w.startVh;
  const b = w.endVh;
  if (b <= a) return 0;
  return THREE.MathUtils.clamp((vh - a) / (b - a), 0, 1);
}

function damp(current: number, target: number, lambda: number, dt: number) {
  if (lambda <= 0) return target;
  const k = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * k;
}

/**
 * Absolute VH Scroll Rig
 * Windows are defined in vh-from-top (like pixels-from-top but in vh).
 *
 * Example:
 *   startVh: 100, endVh: 120
 * means: camera animates while scrollTop is between 1.0 and 1.2 viewport heights.
 */
export default function ScrollRig({
  windows,
  cameraRef,
  basePoseRef,
  smoothing = 0,
  applyToCamera,
  scrollContainerRef,
}: ScrollRigProps) {
  const { camera } = useThree();

  // holds the latest absolute scroll amount in vh
  const scrollVhRef = useRef(0);

  useEffect(() => {
    const getScrollTopPx = () => {
      const el = scrollContainerRef?.current;
      if (el) return el.scrollTop;
      return window.scrollY || document.documentElement.scrollTop || 0;
    };

    const update = () => {
      const vh =
        window.innerHeight > 0
          ? (getScrollTopPx() / window.innerHeight) * 100
          : 0;
      scrollVhRef.current = vh;
    };

    update();

    // Use passive listeners for smooth scrolling libs too
    const el = scrollContainerRef?.current ?? window;
    el.addEventListener("scroll", update as any, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    return () => {
      el.removeEventListener("scroll", update as any);
      window.removeEventListener("resize", update);
    };
  }, [scrollContainerRef]);

  const sorted = useMemo(() => {
    const w = [...windows];
    w.sort((a, b) => a.window.startVh - b.window.startVh);
    return w;
  }, [windows]);

  const firstFromPos = useMemo(
    () => toV3(sorted[0]?.from.position ?? [0, 0, 5]).clone(),
    [sorted],
  );
  const firstFromLook = useMemo(
    () => toV3(sorted[0]?.from.lookAt ?? [0, 0, 0]).clone(),
    [sorted],
  );

  const desiredPos = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  const currentPos = useRef(new THREE.Vector3().copy(firstFromPos));
  const currentLook = useRef(new THREE.Vector3().copy(firstFromLook));

  useFrame((_, dt) => {
    const cam = cameraRef?.current ?? camera;
    if (sorted.length === 0) return;

    const vh = scrollVhRef.current;

    // Default: before first window => first.from
    desiredPos.current.copy(firstFromPos);
    desiredLook.current.copy(firstFromLook);

    let resolved = false;

    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i];
      const { startVh, endVh } = w.window;

      if (vh < startVh) {
        // between windows => hold previous.to
        if (i > 0) {
          const prev = sorted[i - 1];
          desiredPos.current.copy(toV3(prev.to.position));
          desiredLook.current.copy(toV3(prev.to.lookAt));
        }
        resolved = true;
        break;
      }

      if (vh >= startVh && vh <= endVh) {
        const rawT = progressInVhWindow(vh, w.window);
        const t = w.ease ? w.ease(rawT) : rawT;

        desiredPos.current
          .copy(toV3(w.from.position))
          .lerp(toV3(w.to.position), t);
        desiredLook.current
          .copy(toV3(w.from.lookAt))
          .lerp(toV3(w.to.lookAt), t);

        resolved = true;
        break;
      }
    }

    if (!resolved) {
      const last = sorted[sorted.length - 1];
      desiredPos.current.copy(toV3(last.to.position));
      desiredLook.current.copy(toV3(last.to.lookAt));
    }

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

    const shouldApply = applyToCamera ?? !basePoseRef?.current;
    if (shouldApply) {
      cam.position.copy(currentPos.current);
      cam.lookAt(currentLook.current);
    }
  });

  return null;
}
