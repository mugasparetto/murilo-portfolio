"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

export type CameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

type Props = {
  poseRef: React.RefObject<CameraPose | null>;
  cameraRef?: React.RefObject<THREE.Camera | null>;
  strength?: number;
  damp?: number;
  targetStrength?: number;
  priority?: number;
};

export default function CameraParallaxRig({
  poseRef,
  strength = 120,
  damp = 12,
  targetStrength = 0.15,
  priority = 10,
  cameraRef,
}: Props) {
  const { camera: defaultCamera, pointer, viewport } = useThree();

  const offset = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  const finalPos = useRef(new THREE.Vector3());
  const finalTgt = useRef(new THREE.Vector3());

  const camForward = useMemo(() => new THREE.Vector3(), []);
  const camRight = useMemo(() => new THREE.Vector3(), []);
  const camUp = useMemo(() => new THREE.Vector3(), []);
  const worldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame((_, delta) => {
    const pose = poseRef.current;
    if (!pose) return;

    const cam = cameraRef?.current ?? defaultCamera;

    // pointer is normalized [-1..1]
    const px = pointer.x * viewport.width * 0.5;
    const py = pointer.y * viewport.height * 0.5;

    // build a stable camera basis from BASE pose
    camForward.copy(pose.target).sub(pose.position).normalize();
    camRight.copy(camForward).cross(worldUp).normalize();
    camUp.copy(camRight).cross(camForward).normalize();

    desired.current
      .copy(camRight)
      .multiplyScalar(px)
      .addScaledVector(camUp, py)
      .multiplyScalar(strength / Math.max(viewport.width, viewport.height));

    // smooth
    const t = 1 - Math.exp(-damp * delta);
    offset.current.lerp(desired.current, t);

    // final camera transform = base + offset
    finalPos.current.copy(pose.position).add(offset.current);
    finalTgt.current
      .copy(pose.target)
      .addScaledVector(offset.current, targetStrength);

    cam.position.copy(finalPos.current);
    cam.lookAt(finalTgt.current);
    cam.updateMatrixWorld();
  }, priority);

  return null;
}
