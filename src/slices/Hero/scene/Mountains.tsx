"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import type { SceneParams } from "../scene-core/params";
import { mountainFragment, mountainVertex } from "../scene-core/mountainShader";

type Props = {
  params: SceneParams;
};

// Plain fbm: octaves are summed as they come, so the field stays smooth and
// rolling. The ridged variant this replaced folded noise around 0, which is
// exactly what produced the sharp creased peaks.
function fbm(
  noise: SimplexNoise,
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise.noise(x * freq, z * freq) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return norm > 0 ? sum / norm : 0;
}

// Domain warping, the same trick the terrain shader uses: offset the sample
// position with noise so ridgelines flow and curve instead of reading as
// scattered spikes.
function warpedFbm(
  noise: SimplexNoise,
  x: number,
  z: number,
  warpStrength: number,
) {
  const qx = fbm(noise, x, z);
  const qz = fbm(noise, x + 5.2, z + 1.3);
  return fbm(noise, x + warpStrength * qx, z + warpStrength * qz);
}

// Neighbour averaging over the height grid. Removes the single-vertex spikes
// the noise shaping leaves behind, so the silhouette reads as rounded ridges
// rather than a row of needles.
function smoothHeights(
  heights: Float32Array,
  cols: number,
  rows: number,
  strength: number,
  passes = 2,
) {
  if (strength <= 0) return;

  const buf = new Float32Array(heights.length);

  for (let p = 0; p < passes; p++) {
    buf.set(heights);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let count = 0;

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            sum += buf[rr * cols + cc];
            count++;
          }
        }

        const i = r * cols + c;
        heights[i] = buf[i] + (sum / count - buf[i]) * strength;
      }
    }
  }
}

export default function Mountains({ params }: Props) {
  const noiseRef = useRef<SimplexNoise | null>(null);
  if (!noiseRef.current) noiseRef.current = new SimplexNoise();

  const { gl } = useThree();

  // One cell size for both axes (like the terrain's `scl`) so the quads come
  // out square instead of stretched.
  const segments = useMemo(() => {
    const scl = Math.max(20, params.mountainScl);
    return {
      x: Math.max(2, Math.round(params.mountainW / scl)),
      z: Math.max(2, Math.round(params.mountainD / scl)),
    };
  }, [params.mountainW, params.mountainD, params.mountainScl]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      params.mountainW,
      params.mountainD,
      segments.x,
      segments.z,
    );
    geo.rotateX(-Math.PI / 2);

    const noise = noiseRef.current!;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const halfW = params.mountainW * 0.5;

    // PlaneGeometry lays vertices out row-major, so index i maps straight
    // onto the (cols x rows) height grid the smoothing pass walks.
    const cols = segments.x + 1;
    const rows = segments.z + 1;
    const heights = new Float32Array(cols * rows);

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      // 1 at the center, tapering to 0 at the left/right edges
      const x01 = Math.min(Math.abs(x) / halfW, 1);
      const envelope = Math.pow(1 - x01, params.mountainFalloffPower);

      const n = warpedFbm(
        noise,
        x * params.mountainNoiseScale,
        z * params.mountainNoiseScale,
        params.mountainWarp,
      );

      let n01 = Math.min(Math.max(n * 0.5 + 0.5, 0), 1);
      // smoothstep: flattens the extremes so tops round off instead of
      // coming to a point
      n01 = n01 * n01 * (3 - 2 * n01);
      n01 = Math.pow(n01, params.mountainShape);

      heights[i] = n01 * envelope * params.mountainHeight;
    }

    smoothHeights(heights, cols, rows, params.mountainSmooth);

    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setY(i, heights[i]);
    }

    posAttr.needsUpdate = true;
    return geo;
  }, [
    params.mountainW,
    params.mountainD,
    segments,
    params.mountainHeight,
    params.mountainFalloffPower,
    params.mountainNoiseScale,
    params.mountainWarp,
    params.mountainShape,
    params.mountainSmooth,
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
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(params.mountainColor) },
        uFillColor: { value: new THREE.Color(params.mountainFillColor) },
        uOpacity: { value: params.mountainOpacity },
        uFillOpacity: { value: params.mountainFillOpacity },
        uGrid: { value: new THREE.Vector2(segments.x, segments.z) },
        uLineWidth: { value: params.mountainLineWidth },
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
    // create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const material = materialRef.current;
    if (!material) return;

    (material.uniforms.uColor.value as THREE.Color).set(
      params.mountainColor,
    );
    (material.uniforms.uFillColor.value as THREE.Color).set(
      params.mountainFillColor,
    );
    material.uniforms.uOpacity.value = params.mountainOpacity;
    material.uniforms.uFillOpacity.value = params.mountainFillOpacity;
    // keeps the drawn grid locked to the mesh rows/columns
    (material.uniforms.uGrid.value as THREE.Vector2).set(
      segments.x,
      segments.z,
    );
    material.uniforms.uLineWidth.value =
      params.mountainLineWidth * gl.getPixelRatio();
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
