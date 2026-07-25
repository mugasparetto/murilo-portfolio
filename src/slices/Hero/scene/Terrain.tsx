"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { SceneParams } from "../scene-core/params";
import { terrainFragment, terrainVertex } from "../scene-core/terrainShader";
import type { DoorProjection } from "../scene-core/doorProjection";

type Props = {
  params: SceneParams;
  /** the door's display material — the ground pool reflects it */
  doorMat: THREE.ShaderMaterial;
  /** live door quad, written by <Door /> every frame */
  doorProjectionRef: RefObject<DoorProjection>;
  tiles?: number;
};

/** grid cells across one tile, on both axes */
const GRID = 40;

export default function Terrain({
  params,
  doorMat,
  doorProjectionRef,
  tiles = 3,
}: Props) {
  const group = useRef<THREE.Group>(null);
  const { gl } = useThree();

  // geometry rebuild when w/h/scl changes
  const { geometry, rowStep } = useMemo(() => {
    const cols = Math.max(2, Math.floor(params.w / params.scl));
    const rows = Math.max(2, Math.floor(params.h / params.scl));

    const geo = new THREE.PlaneGeometry(params.w, params.h, cols - 1, rows - 1);
    geo.rotateX(-Math.PI / 2);

    // spacing between two vertex rows — the only distance the tile ring can be
    // shifted by and still land on its own lattice
    return { geometry: geo, rowStep: params.h / (rows - 1) };
  }, [params.w, params.h, params.scl]);

  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uClipZ: { value: 2200 },

        uDiff: { value: params.diff },
        uXYScale: { value: params.xyScale },
        uScroll: { value: 0 },
        uGridScroll: { value: 0 },
        uTileLength: { value: params.h },
        uGrid: { value: GRID },

        uWidth: { value: params.w },
        uEdgePower: { value: params.edgePower },
        uEdgePad: { value: params.edgePad },
        uEdgeStrength: { value: params.edgeStrength },

        uLineWidth: { value: params.lineWidth },
        uLineColor: { value: new THREE.Color(0xe8e8e0) },
        uFillColor: { value: new THREE.Color(0x000000) },

        uBowlStrength: { value: params.bowlStrength },
        uBowlPower: { value: params.bowlPower },
        uNoiseEdgeStart: { value: params.noiseEdgeStart },
        uNoiseEdgeEnd: { value: 1.0 },
        uNoiseEdgePower: { value: params.noiseEdgePower },

        uLacunarity: { value: params.noiseLacunarity },
        uGain: { value: params.noiseGain },
        uWarpStrength: { value: params.noiseWarpStrength },

        uClusterScale: { value: params.clusterScale },
        uClusterThreshold: { value: params.clusterThreshold },
        uClusterSoftness: { value: params.clusterSoftness },
        uClusterStrength: { value: params.clusterStrength },

        uHeightFalloffNearZ: { value: params.heightFalloffNearZ },
        uHeightFalloffFarZ: { value: params.heightFalloffFarZ },
        uHeightFalloffPower: { value: params.heightFalloffPower },
        uHeightFalloffMin: { value: params.heightFalloffMin },

        uMaskNearZ: { value: params.maskNearZ },
        uMaskFarZ: { value: params.maskFarZ },
        uMaskPower: { value: params.maskPower },
        uUseHardClip: { value: params.useHardClip },

        // ---- door light pool ----
        uPoolCenter: {
          value: new THREE.Vector2(params.reflectFloorX, params.reflectFloorZ),
        },
        uPoolSize: {
          value: new THREE.Vector2(
            params.reflectFloorWidth * 0.5,
            params.reflectFloorDepth * 0.5,
          ),
        },
        uPoolStrength: { value: params.reflectFloorStrength },

        // shared *objects* with the door material — see <Steps />
        iTime: doorMat.uniforms.iTime,
        iResolution: doorMat.uniforms.iResolution,
        uDoorFluid: doorMat.uniforms.iFluid,
        uSeed: doorMat.uniforms.uSeed,
        uDistortionAmount: doorMat.uniforms.uDistortionAmount,
        uColor1: doorMat.uniforms.uColor1,
        uColor2: doorMat.uniforms.uColor2,
        uColor3: doorMat.uniforms.uColor3,
        uColor4: doorMat.uniforms.uColor4,
        uColorIntensity: doorMat.uniforms.uColorIntensity,
        uSoftness: doorMat.uniforms.uSoftness,

        // door quad in world space, published by <Door /> each frame
        uDoorPos: { value: new THREE.Vector3() },
        uDoorRight: { value: new THREE.Vector3(1, 0, 0) },
        uDoorUp: { value: new THREE.Vector3(0, 1, 0) },
        uDoorHalfSize: { value: new THREE.Vector2(400, 800) },
        uDoorStrength: { value: 0 },

        uIntensity: { value: params.reflectIntensity },
        uFalloff: { value: params.reflectFalloff },
        uRoughness: { value: params.reflectRoughness },
        uFacing: { value: params.reflectFacing },
        uTopBoost: { value: params.reflectTopBoost },
        uReach: { value: params.reflectReach },
        uSpread: { value: params.reflectSpread },
        uEdgeSoft: { value: params.reflectEdgeSoft },
        uTopStart: { value: 0.25 },
        uTopEnd: { value: 1 },
      },
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
    });

    materialRef.current = mat;

    return () => {
      materialRef.current = null;
      mat.dispose();
    };
    // create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const tileLength = params.h;
  const scrollZ = useRef(0);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material) return;

    // update uniforms
    material.uniforms.uDiff.value = params.diff;
    material.uniforms.uXYScale.value = params.xyScale;

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

    material.uniforms.uLacunarity.value = params.noiseLacunarity;
    material.uniforms.uGain.value = params.noiseGain;
    material.uniforms.uWarpStrength.value = params.noiseWarpStrength;

    material.uniforms.uClusterScale.value = params.clusterScale;
    material.uniforms.uClusterThreshold.value = params.clusterThreshold;
    material.uniforms.uClusterSoftness.value = params.clusterSoftness;
    material.uniforms.uClusterStrength.value = params.clusterStrength;

    material.uniforms.uHeightFalloffNearZ.value = params.heightFalloffNearZ;
    material.uniforms.uHeightFalloffFarZ.value = params.heightFalloffFarZ;
    material.uniforms.uHeightFalloffPower.value = params.heightFalloffPower;
    material.uniforms.uHeightFalloffMin.value = params.heightFalloffMin;

    material.uniforms.uMaskNearZ.value = params.maskNearZ;
    material.uniforms.uMaskFarZ.value = params.maskFarZ;
    material.uniforms.uMaskPower.value = params.maskPower;
    material.uniforms.uUseHardClip.value = params.useHardClip;

    // ---- door light pool ----
    const u = material.uniforms;
    const door = doorProjectionRef.current;

    if (door) {
      (u.uDoorPos.value as THREE.Vector3).copy(door.position);
      (u.uDoorRight.value as THREE.Vector3).copy(door.right);
      (u.uDoorUp.value as THREE.Vector3).copy(door.up);
      (u.uDoorHalfSize.value as THREE.Vector2).copy(door.halfSize);
      u.uDoorStrength.value = door.strength;
    }

    (u.uPoolCenter.value as THREE.Vector2).set(
      params.reflectFloorX,
      params.reflectFloorZ,
    );
    (u.uPoolSize.value as THREE.Vector2).set(
      params.reflectFloorWidth * 0.5,
      params.reflectFloorDepth * 0.5,
    );
    u.uPoolStrength.value = params.reflectFloorStrength;

    u.uIntensity.value = params.reflectIntensity;
    u.uFalloff.value = params.reflectFalloff;
    u.uRoughness.value = params.reflectRoughness;
    u.uFacing.value = params.reflectFacing;
    u.uTopBoost.value = params.reflectTopBoost;
    u.uReach.value = params.reflectReach;
    u.uSpread.value = params.reflectSpread;
    u.uEdgeSoft.value = params.reflectEdgeSoft;

    // ---- scroll ----
    // One accumulator drives both the field in the shader and the tiles here,
    // so changing scrollSpeed / speedMul at runtime can never make them disagree.
    const v = params.scrollSpeed * params.speedMul;
    scrollZ.current += v * delta;

    u.uScroll.value = scrollZ.current;
    u.uGridScroll.value = scrollZ.current % (tileLength / GRID);
    u.uTileLength.value = tileLength;

    if (!group.current) return;
    const children = group.current.children;

    // Recycle a vertex row at a time, not a tile at a time. The ring still
    // travels a whole tile before it repeats, but every wrap lands the lattice
    // exactly on top of where it already was — the visible surface is
    // unchanged and only a single row enters at the far end, instead of a
    // whole tile of terrain appearing in one frame.
    const shift = scrollZ.current % rowStep;

    for (let i = 0; i < children.length; i++) {
      const m = children[i] as THREE.Mesh;
      m.position.z = -i * tileLength + shift;
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: tiles }).map((_, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={materialRef.current ?? undefined}
          position={[0, 0, -i * params.h]}
        />
      ))}
    </group>
  );
}
