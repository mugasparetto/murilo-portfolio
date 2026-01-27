"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

type Props = {
  /** Base camera position (from params) */
  basePosition: THREE.Vector3 | [number, number, number];
  /** Base lookAt target (from params) */
  baseTarget: THREE.Vector3 | [number, number, number];

  /** Parallax strength in world units */
  strength?: number; // e.g. 120
  /** Smoothing speed (bigger = snappier). 8–14 feels good */
  damp?: number; // e.g. 12

  /** Optional: also nudge the lookAt a bit (subtle) */
  targetStrength?: number; // e.g. 0.15
};

function toVec3(
  v: THREE.Vector3 | [number, number, number],
  out: THREE.Vector3
) {
  if (Array.isArray(v)) out.set(v[0], v[1], v[2]);
  else out.copy(v);
  return out;
}

export default function CameraParallaxRig({
  basePosition,
  baseTarget,
  strength = 120,
  damp = 12,
  targetStrength = 0.15,
}: Props) {
  const { camera, pointer, viewport } = useThree();

  const basePos = useRef(new THREE.Vector3());
  const baseTgt = useRef(new THREE.Vector3());

  const offset = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());

  const camForward = useMemo(() => new THREE.Vector3(), []);
  const camRight = useMemo(() => new THREE.Vector3(), []);
  const camUp = useMemo(() => new THREE.Vector3(), []);
  const worldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // keep base pose in refs (so the parallax can be applied on top)
  useEffect(() => {
    toVec3(basePosition, basePos.current);
    toVec3(baseTarget, baseTgt.current);
  }, [basePosition, baseTarget]);

  useFrame((_, delta) => {
    // pointer is normalized [-1..1]
    // convert to a stable world-unit scale based on viewport
    const px = pointer.x * viewport.width * 0.5;
    const py = pointer.y * viewport.height * 0.5;

    // build a camera basis from base pose (not from current camera, so it’s stable)
    camForward.copy(baseTgt.current).sub(basePos.current).normalize();
    camRight.copy(camForward).cross(worldUp).normalize();
    camUp.copy(camRight).cross(camForward).normalize();

    // desired offset in camera right/up plane
    desired.current
      .copy(camRight)
      .multiplyScalar(px)
      .addScaledVector(camUp, py)
      // normalize strength so it feels similar across viewport sizes
      .multiplyScalar(strength / Math.max(viewport.width, viewport.height));

    // delta-based smoothing (frame-rate independent)
    const t = 1 - Math.exp(-damp * delta);
    offset.current.lerp(desired.current, t);

    // apply to camera position
    camera.position.copy(basePos.current).add(offset.current);

    // optionally nudge target a bit too (gives “depth” feel)
    const tgt = new THREE.Vector3()
      .copy(baseTgt.current)
      .addScaledVector(offset.current, targetStrength);

    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  });

  return null;
}
