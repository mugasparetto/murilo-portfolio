"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { swayOn } from "./diagFlags";

export type CameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

// world transform that maps the base (un-parallaxed) camera frame onto the
// live one: `cam.matrixWorld * baseCam.matrixWorld⁻¹`
const cancel = new THREE.Matrix4();
let active = false;

/**
 * Moves a world point into the frame the base (un-parallaxed) camera would see
 * it in, so `v.project(camera)` afterwards yields a screen position the pointer
 * sway can't touch. No-op when no rig is mounted (mobile).
 *
 * Same trick `lockToScreen` uses, exposed for callers that only need the
 * projected position — eg. a DOM overlay tracking the scroll.
 */
export function toBaseFrame(v: THREE.Vector3) {
  if (active) v.applyMatrix4(cancel);
  return v;
}

type Props = {
  poseRef: React.RefObject<CameraPose | null>;
  cameraRef?: React.RefObject<THREE.Camera | null>;
  strength?: number;
  damp?: number;
  targetStrength?: number;
  priority?: number;
  /**
   * <ScrollRig />'s `intensityRef`: what the pose being held this frame wants
   * `strength` to be worth, as a fraction of itself. 1 — the default when no
   * ref is passed — is the full sway; 0 stills the camera completely.
   *
   * Scaling `strength` scales the target sway with it, since `targetStrength`
   * is a ratio of the same offset, so one number dials the whole effect.
   */
  intensityRef?: React.RefObject<number>;
};

export default function CameraParallaxRig({
  poseRef,
  strength = 120,
  damp = 12,
  targetStrength = 0.15,
  priority = 10,
  cameraRef,
  intensityRef,
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
  // stand-in for the camera at the base pose; THREE.Camera so `lookAt` uses
  // the -Z convention the real camera does
  const baseCam = useMemo(() => new THREE.Camera(), []);

  useEffect(() => {
    active = true;
    return () => {
      active = false;
      cancel.identity();
    };
  }, []);

  useFrame((_, delta) => {
    const pose = poseRef.current;
    if (!pose) return;

    const cam = cameraRef?.current ?? defaultCamera;

    // pointer is normalized [-1..1]
    //
    // <Diagnostics />'s key 6 drives the sway to nothing rather than skipping
    // the frame: the settle below then lands the offset exactly on zero and
    // brings the camera — and everything projecting against it — to rest, where
    // bailing early would strand it wherever the pointer last left it. The rig
    // can't simply be unmounted either; at `md` and up it is the only thing
    // writing the camera, since <SceneManager /> hands <ScrollRig /> a false
    // `applyToCamera` there.
    const live = swayOn();
    const px = live ? pointer.x * viewport.width * 0.5 : 0;
    const py = live ? pointer.y * viewport.height * 0.5 : 0;

    // build a stable camera basis from BASE pose
    camForward.copy(pose.target).sub(pose.position).normalize();
    camRight.copy(camForward).cross(worldUp).normalize();
    camUp.copy(camRight).cross(camForward).normalize();

    // how much sway the pose being held this frame asked for
    const scale = intensityRef?.current ?? 1;

    desired.current
      .copy(camRight)
      .multiplyScalar(px)
      .addScaledVector(camUp, py)
      .multiplyScalar(
        (strength * scale) / Math.max(viewport.width, viewport.height),
      );

    // Smooth — and then land.
    //
    // The ease is exponential, so on its own it only ever *approaches* the
    // target: the offset keeps changing in the sixth decimal place long after
    // the pointer has stopped, and every frame it changes is a frame the camera
    // moves. That isn't free anywhere downstream — the scene redraws against a
    // new view matrix, and every DOM overlay that tracks the camera reprojects
    // and rewrites itself. On a display with no frame budget to spare that is
    // the difference between holding vsync and missing it.
    //
    // So snap once the remainder is too small to see. `viewport.factor` is
    // pixels per world unit at the focus distance, and every consumer of this
    // rig rounds to whole pixels before it writes anything, so a quarter of a
    // pixel is already below what any of them can resolve — but it lets the
    // offset reach the target exactly, which is what actually brings the camera
    // to rest.
    const t = 1 - Math.exp(-damp * delta);
    offset.current.lerp(desired.current, t);

    const settle = 0.25 / viewport.factor;
    if (offset.current.distanceToSquared(desired.current) < settle * settle) {
      offset.current.copy(desired.current);
    }

    // final camera transform = base + offset
    finalPos.current.copy(pose.position).add(offset.current);
    finalTgt.current
      .copy(pose.target)
      .addScaledVector(offset.current, targetStrength);

    cam.position.copy(finalPos.current);
    cam.lookAt(finalTgt.current);
    cam.updateMatrixWorld();

    // same pose without the offset, so `lockToScreen` can undo the difference
    baseCam.up.copy(cam.up);
    baseCam.position.copy(pose.position);
    baseCam.lookAt(pose.target);
    baseCam.updateMatrixWorld();

    cancel.copy(baseCam.matrixWorld).invert().premultiply(cam.matrixWorld);
  }, priority);

  return null;
}
