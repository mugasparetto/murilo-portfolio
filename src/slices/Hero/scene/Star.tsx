"use client";

import * as THREE from "three";
import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";

type InstancedStarsProps = {
  positions: [number, number, number][];
  minSize?: number;
  maxSize?: number;
  blinkSpeed?: number;
  minOpacity?: number;
  maxOpacity?: number;
  color?: THREE.ColorRepresentation;
  seed?: number;
};

// --- deterministic helpers (same idea as your Star.tsx)
const fract = (x: number) => x - Math.floor(x);
const hash1 = (x: number) => fract(Math.sin(x) * 43758.5453123);

function hashFromPosition(
  position: [number, number, number],
  salt: number,
  seed: number,
) {
  const [x, y, z] = position;
  const h =
    x * 12.9898 + y * 78.233 + z * 37.719 + salt * 19.19 + seed * 0.12345;
  return hash1(h);
}

export default function InstancedStars({
  positions,
  minSize = 0.03,
  maxSize = 0.12,
  blinkSpeed = 0.35,
  minOpacity = 0.15,
  maxOpacity = 1,
  color = "white",
  seed = 0,
}: InstancedStarsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null!);

  const count = positions.length;

  // Precompute per-instance params (radius, phase, speed) deterministically
  const params = useMemo(() => {
    const radius = new Float32Array(count);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const p = positions[i];

      const r01 = hashFromPosition(p, 1.0, seed);
      const p01 = hashFromPosition(p, 2.0, seed);
      const s01 = hashFromPosition(p, 3.0, seed);

      radius[i] = THREE.MathUtils.lerp(minSize, maxSize, r01);
      phase[i] = p01 * Math.PI * 2;
      speed[i] = blinkSpeed * THREE.MathUtils.lerp(0.6, 1.4, s01);
    }

    return { radius, phase, speed };
  }, [count, positions, minSize, maxSize, blinkSpeed, seed]);

  // One-time instanceMatrix setup: position + scale (radius)
  useEffect(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const [x, y, z] = positions[i];
      const r = params.radius[i];

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(r); // base sphere radius = 1, so scale becomes actual star radius
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [count, positions, params]);

  // Create and attach per-instance opacity attribute (updated every frame)
  const opacityAttr = useMemo(() => {
    const arr = new Float32Array(count);
    arr.fill(maxOpacity);
    return new THREE.InstancedBufferAttribute(arr, 1);
  }, [count, maxOpacity]);

  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.geometry.setAttribute("instanceOpacity", opacityAttr);
    return () => {
      meshRef.current?.geometry.deleteAttribute("instanceOpacity");
    };
  }, [opacityAttr]);

  // Patch the material shader so fragment alpha *= instanceOpacity
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    mat.onBeforeCompile = (shader) => {
      // add attribute + varying
      shader.vertexShader =
        `
attribute float instanceOpacity;
varying float vInstanceOpacity;
` + shader.vertexShader;

      // assign varying
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vInstanceOpacity = instanceOpacity;`,
      );

      shader.fragmentShader =
        `
varying float vInstanceOpacity;
` + shader.fragmentShader;

      // multiply final alpha
      shader.fragmentShader = shader.fragmentShader.replace(
        "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
        "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vInstanceOpacity );",
      );
    };

    mat.needsUpdate = true;

    // cleanup
    return () => {
      mat.onBeforeCompile = () => {};
      mat.needsUpdate = true;
    };
  }, []);

  // Animate only the opacity attribute each frame
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const arr = opacityAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const s = 0.5 + 0.5 * Math.sin(t * params.speed[i] + params.phase[i]);
      arr[i] = THREE.MathUtils.lerp(minOpacity, maxOpacity, s);
    }

    opacityAttr.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as any, undefined as any, count]}
    >
      {/* base sphere radius=1, actual radius comes from instance scale */}
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={1}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
