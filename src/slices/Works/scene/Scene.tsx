"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { FACE_HOME } from "@/slices/About/scene/Head";

/**
 * Hello world: a red cube hanging in front of the About face.
 *
 * It exists to prove the wiring, not the picture — that <Works /> can put
 * geometry in the shared canvas the way the other two slices do, and that the
 * frame loop reaches it. Delete the whole `scene/` folder when the real works
 * geometry lands.
 *
 * Placed off {@link FACE_HOME} rather than at numbers typed here, so it stays
 * in front of the face wherever the face is authored. The camera holds
 * {@link ABOUT_POSE} — (0, -800, 3380), looking straight down -Z — for
 * everything past the About window, so this section is seen from exactly there
 * and +Z is towards the viewer.
 */

/** how far in front of the face, in world units — clear of it, well short of
 *  the camera's 50-unit near plane */
const CUBE_OFFSET = 300;

/** about a third of the viewport height at that depth */
const CUBE_SIZE = 120;

export default function Scene() {
  const cube = useRef<THREE.Mesh>(null);

  // spinning rather than sitting still: a still cube proves it was *drawn*, a
  // turning one proves the loop is running for this entry too
  useFrame((_, delta) => {
    const mesh = cube.current;
    if (!mesh) return;

    mesh.rotation.x += delta * 0.4;
    mesh.rotation.y += delta * 0.6;
  });

  return (
    <mesh
      ref={cube}
      position={[FACE_HOME.x, FACE_HOME.y, FACE_HOME.z + CUBE_OFFSET]}
    >
      {/* <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} /> */}
      {/* the scene carries no lights at all — everything in it is basic or a
          hand-written shader — so a standard material here would render black */}
      <meshBasicMaterial color="red" />
    </mesh>
  );
}
