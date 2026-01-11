"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { SceneParams } from "../scene-core/params";
import { addBarycentricCoordinates } from "../scene-core/barycentric";
import { terrainFragment, terrainVertex } from "../scene-core/terrainShader";

type Props = {
  params: SceneParams;
  tiles?: number;
};

export default function Terrain({ params, tiles = 3 }: Props) {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();

  // geometry rebuild when w/h/scl changes
  const geometry = useMemo(() => {
    const cols = Math.max(2, Math.floor(params.w / params.scl));
    const rows = Math.max(2, Math.floor(params.h / params.scl));

    let geo = new THREE.PlaneGeometry(params.w, params.h, cols - 1, rows - 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [params.w, params.h, params.scl]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },

        uDiff: { value: params.diff },
        uXYScale: { value: params.xyScale },
        uScrollSpeed: { value: params.scrollSpeed },
        uSpeedMul: { value: params.speedMul },
        uGrid: { value: 40.0 },

        uWidth: { value: params.w },
        uEdgePower: { value: params.edgePower },
        uEdgePad: { value: params.edgePad },
        uEdgeStrength: { value: params.edgeStrength },

        uLineWidth: { value: params.lineWidth },
        uLineColor: { value: new THREE.Color(0xffffff) },
        uFillColor: { value: new THREE.Color(0x000000) },

        uBowlStrength: { value: params.bowlStrength },
        uBowlPower: { value: params.bowlPower },
        uNoiseEdgeStart: { value: params.noiseEdgeStart },
        uNoiseEdgeEnd: { value: 1.0 },
        uNoiseEdgePower: { value: params.noiseEdgePower },

        uMaskNearZ: { value: params.maskNearZ },
        uMaskFarZ: { value: params.maskFarZ },
        uMaskPower: { value: params.maskPower },
        uUseHardClip: { value: params.useHardClip },
      },
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
    });
  }, []); // keep stable; we update uniforms every frame

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const tileLength = params.h;
  const scrollZ = useRef(0);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // update uniforms
    material.uniforms.uTime.value = t;

    material.uniforms.uDiff.value = params.diff;
    material.uniforms.uXYScale.value = params.xyScale;
    material.uniforms.uScrollSpeed.value = params.scrollSpeed;
    material.uniforms.uSpeedMul.value = params.speedMul;

    material.uniforms.uWidth.value = params.w;
    material.uniforms.uEdgePower.value = params.edgePower;
    material.uniforms.uEdgePad.value = params.edgePad;
    material.uniforms.uEdgeStrength.value = params.edgeStrength;

    const dpr = gl.getPixelRatio();
    material.uniforms.uLineWidth.value = params.lineWidth * dpr;

    material.uniforms.uBowlStrength.value = params.bowlStrength;
    material.uniforms.uBowlPower.value = params.bowlPower;
    material.uniforms.uNoiseEdgeStart.value = params.noiseEdgeStart;
    material.uniforms.uNoiseEdgePower.value = params.noiseEdgePower;

    material.uniforms.uMaskNearZ.value = params.maskNearZ;
    material.uniforms.uMaskFarZ.value = params.maskFarZ;
    material.uniforms.uMaskPower.value = params.maskPower;
    material.uniforms.uUseHardClip.value = params.useHardClip;

    // scroll tiles
    const v = params.scrollSpeed * params.speedMul;
    scrollZ.current += v * delta;

    if (!group.current) return;
    const children = group.current.children;

    for (let i = 0; i < children.length; i++) {
      const m = children[i] as THREE.Mesh;
      m.position.z = -i * tileLength + (scrollZ.current % tileLength);
      if (m.position.z > tileLength)
        m.position.z -= tileLength * children.length;
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: tiles }).map((_, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          position={[0, 0, -i * params.h]}
        />
      ))}
    </group>
  );
}
