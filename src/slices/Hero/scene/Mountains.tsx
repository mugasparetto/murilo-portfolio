"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import type { SceneParams } from "../scene-core/params";
import { mountainFragment, mountainVertex } from "../scene-core/mountainShader";
import { ABOUT_POSE, HERO_POSE } from "@/app/components/poses";

type Props = {
  params: SceneParams;
};

/** The range is stretched this much across, on top of its own width. */
const SCALE_X = 2;

/** Neighbour-averaging passes over the height grid; see `smoothHeights`. */
const SMOOTH_PASSES = 2;

/**
 * The camera's z at its farthest back. The scroll rig only ever flies it
 * between these two poses.
 */
const EYE_Z = Math.max(HERO_POSE.position[2], ABOUT_POSE.position[2]);

/**
 * How much wider than the frame the range is cut. The frame is worked out from
 * z distance alone. This slack covers what that leaves out: the camera's
 * pitch, which puts a high peak a little deeper along the view axis than its z
 * distance says, and the pointer parallax's sway from md up.
 */
const CROP_SLACK = 1.2;

/**
 * The crop's half-width goes up in steps of this many of the mesh's units, so
 * dragging a window wider rebuilds the range a few times rather than every
 * frame.
 */
const CROP_STEP = 1000;

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
  passes: number,
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

  const { gl, size } = useThree();

  // One cell size for both axes (like the terrain's `scl`) so the quads come
  // out square instead of stretched.
  const segments = useMemo(() => {
    const scl = Math.max(20, params.mountainScl);
    return {
      x: Math.max(2, Math.round(params.mountainW / scl)),
      z: Math.max(2, Math.round(params.mountainD / scl)),
    };
  }, [params.mountainW, params.mountainD, params.mountainScl]);

  // Half the width of range the frame can ever take in, in the mesh's own
  // units. The camera sits on x = 0 and never turns sideways, so this is just
  // the frustum's half-width at the far edge, which is the widest slice of the
  // range it sees.
  const cropHalfW = useMemo(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const depth = EYE_Z - (params.mountainPosZ - params.mountainD / 2);
    const half =
      (Math.tan(THREE.MathUtils.degToRad(params.fov) / 2) *
        aspect *
        depth *
        CROP_SLACK) /
      SCALE_X;

    return Math.min(
      params.mountainW / 2,
      Math.ceil(half / CROP_STEP) * CROP_STEP,
    );
  }, [
    size.width,
    size.height,
    params.fov,
    params.mountainPosZ,
    params.mountainD,
    params.mountainW,
  ]);

  // Only the columns of the range inside `cropHalfW` are built. Everything is
  // laid out on the full range's lattice: the same column positions, heights
  // and uvs it would have had uncropped. So the part on screen is the same mesh
  // it always was, and the grid shader, which counts cells off the uvs, draws
  // the same lines.
  //
  // A phone in portrait sees about a tenth of the range, and building all of it
  // cost ~278k triangles a frame plus ~1.7M noise samples on the main thread at
  // load.
  const geometry = useMemo(() => {
    const noise = noiseRef.current!;
    const halfW = params.mountainW * 0.5;
    const halfD = params.mountainD * 0.5;
    // PlaneGeometry's own spacing, so the lattice below is bit-for-bit its
    const cellX = params.mountainW / segments.x;
    const cellZ = params.mountainD / segments.z;
    const rows = segments.z + 1;

    // the full range's columns this keeps, c0..c1
    const c0 = Math.max(0, Math.floor((halfW - cropHalfW) / cellX));
    const c1 = Math.min(segments.x, Math.ceil((halfW + cropHalfW) / cellX));

    // Heights are worked out a little wider than that: each smoothing pass
    // reads one column further out, so the kept edge columns come out exactly
    // as they would in the full range rather than as a border.
    const a0 = Math.max(0, c0 - SMOOTH_PASSES);
    const a1 = Math.min(segments.x, c1 + SMOOTH_PASSES);
    const cols = a1 - a0 + 1;
    const heights = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
      // rounded to the float32 the position attribute will hold, which is
      // what the noise used to be sampled at
      const z = Math.fround(r * cellZ - halfD);

      for (let i = 0; i < cols; i++) {
        const x = Math.fround((a0 + i) * cellX - halfW);

        // 1 at the center, tapering to 0 at the left/right edges of the
        // *full* range, so cropping never changes the shape
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

        heights[r * cols + i] = n01 * envelope * params.mountainHeight;
      }
    }

    smoothHeights(heights, cols, rows, params.mountainSmooth, SMOOTH_PASSES);

    // Built at the kept width for its topology and rows, then moved onto the
    // lattice column by column. PlaneGeometry lays vertices out row-major, far
    // row first, which is the order the heights were filled in.
    const kept = c1 - c0;
    const geo = new THREE.PlaneGeometry(
      kept * cellX,
      params.mountainD,
      kept,
      segments.z,
    );
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const uvAttr = geo.attributes.uv as THREE.BufferAttribute;

    for (let r = 0; r < rows; r++) {
      for (let j = 0; j <= kept; j++) {
        const c = c0 + j;
        const v = r * (kept + 1) + j;

        posAttr.setX(v, c * cellX - halfW);
        posAttr.setY(v, heights[r * cols + (c - a0)]);
        // across the full range, as the uncropped mesh had it
        uvAttr.setX(v, c / segments.x);
      }
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    return geo;
  }, [
    params.mountainW,
    params.mountainD,
    segments,
    cropHalfW,
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

    (material.uniforms.uColor.value as THREE.Color).set(params.mountainColor);
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
      scale={[SCALE_X, 1, 1]}
    >
      <mesh geometry={geometry} material={materialRef.current ?? undefined} />
    </group>
  );
}
