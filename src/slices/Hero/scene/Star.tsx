import * as THREE from "three";
import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";

export type StarProps = {
  position: [number, number, number];
  minSize?: number;
  maxSize?: number;
  blinkSpeed?: number;
  minOpacity?: number;
  maxOpacity?: number;
  color?: THREE.ColorRepresentation;
  /** Optional extra seed to vary stars that share the same position */
  seed?: number;
};

// Pure helpers (deterministic, no Math.random)
const fract = (x: number) => x - Math.floor(x);
const hash1 = (x: number) => fract(Math.sin(x) * 43758.5453123);

// 0..1 value derived from position + salt (pure)
function hashFromPosition(
  position: [number, number, number],
  salt: number,
  seed: number
) {
  const [x, y, z] = position;
  // Dot-like mix, then hash
  const h =
    x * 12.9898 + y * 78.233 + z * 37.719 + salt * 19.19 + seed * 0.12345;
  return hash1(h);
}

export default function Star({
  position,
  minSize = 0.03,
  maxSize = 0.12,
  blinkSpeed = 0.35,
  minOpacity = 0.15,
  maxOpacity = 1,
  color = "white",
  seed = 0,
}: StarProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  // All values are derived deterministically (pure) from props.
  const { radius, phase, speed } = useMemo(() => {
    const r01 = hashFromPosition(position, 1.0, seed);
    const p01 = hashFromPosition(position, 2.0, seed);
    const s01 = hashFromPosition(position, 3.0, seed);

    const radius = THREE.MathUtils.lerp(minSize, maxSize, r01);
    const phase = p01 * Math.PI * 2;
    const speed = blinkSpeed * THREE.MathUtils.lerp(0.6, 1.4, s01);

    return { radius, phase, speed };
  }, [position, minSize, maxSize, blinkSpeed, seed]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // 0..1 oscillation
    const s = 0.5 + 0.5 * Math.sin(t * speed + phase);

    // map to opacity range
    const opacity = THREE.MathUtils.lerp(minOpacity, maxOpacity, s);

    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity;
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[radius, 8, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={maxOpacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
