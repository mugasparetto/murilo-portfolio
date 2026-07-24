"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import type { SceneParams } from "../scene-core/params";
import { mountainFragment, mountainVertex } from "../scene-core/mountainShader";

type Props = {
  params: SceneParams;
};

// Ridged fbm: folds noise around 0 so ridgelines form where octaves agree,
// producing the sharp, irregular peaks/valleys of a mountain range instead
// of the smooth rolling bumps a plain fbm gives.
function ridgedFbm(
  noise: SimplexNoise,
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2.1,
  gain = 0.5,
) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let prev = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noise.noise(x * freq, z * freq);
    n = 1 - Math.abs(n);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return norm > 0 ? sum / norm : 0;
}

export default function Mountains({ params }: Props) {
  const noiseRef = useRef<SimplexNoise | null>(null);
  if (!noiseRef.current) noiseRef.current = new SimplexNoise();

  const geometry = useMemo(() => {
    const segX = Math.max(2, Math.floor(params.mountainSegX));
    const segZ = Math.max(2, Math.floor(params.mountainSegZ));

    const geo = new THREE.PlaneGeometry(
      params.mountainW,
      params.mountainD,
      segX,
      segZ,
    );
    geo.rotateX(-Math.PI / 2);

    const noise = noiseRef.current!;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const halfW = params.mountainW * 0.5;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      // 1 at the center, tapering to 0 at the left/right edges
      const x01 = Math.min(Math.abs(x) / halfW, 1);
      const envelope = Math.pow(1 - x01, params.mountainFalloffPower);

      const n = ridgedFbm(
        noise,
        x * params.mountainNoiseScale,
        z * params.mountainNoiseScale,
      );

      posAttr.setY(i, n * envelope * params.mountainHeight);
    }

    posAttr.needsUpdate = true;
    return geo;
  }, [
    params.mountainW,
    params.mountainD,
    params.mountainSegX,
    params.mountainSegZ,
    params.mountainHeight,
    params.mountainFalloffPower,
    params.mountainNoiseScale,
  ]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      wireframe: true,
      uniforms: {
        uColor: { value: new THREE.Color(params.mountainColor) },
        uOpacity: { value: params.mountainOpacity },
        uFadeHeight: { value: params.mountainFadeHeight },
        uFadeNearZ: { value: params.mountainFadeNearZ },
        uFadeFarZ: { value: params.mountainFadeFarZ },
      },
      vertexShader: mountainVertex,
      fragmentShader: mountainFragment,
    });

    materialRef.current = mat;

    return () => {
      materialRef.current = null;
      mat.dispose();
    };
  }, []);

  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;

    (material.uniforms.uColor.value as THREE.Color).set(
      params.mountainColor,
    );
    material.uniforms.uOpacity.value = params.mountainOpacity;
    material.uniforms.uFadeHeight.value = params.mountainFadeHeight;
    material.uniforms.uFadeNearZ.value = params.mountainFadeNearZ;
    material.uniforms.uFadeFarZ.value = params.mountainFadeFarZ;
    material.blending = params.mountainAdditive
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
  });

  return (
    <group
      ref={groupRef}
      position={[0, params.mountainPosY, params.mountainPosZ]}
    >
      <mesh geometry={geometry} material={materialRef.current ?? undefined} />
    </group>
  );
}
