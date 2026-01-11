"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { useFrame, useThree } from "@react-three/fiber";

import { useFluidMaterials, type FluidConfig } from "./FluidMaterial";

type Props = {
  params: SceneParams;
};

export default function Door({ params }: Props) {
  const { size, camera, gl } = useThree();
  const dpr = gl.getPixelRatio();

  const doorRef = useRef<THREE.Mesh>(null);
  const pointerUvRef = useRef<THREE.Vector2 | null>(null);
  const pointerActiveRef = useRef(false);

  const stepWidth = 800;

  // --- geometry/material (stable)
  const doorGeometry = useMemo(
    () => new THREE.BoxGeometry(stepWidth, 2 * stepWidth, 1),
    []
  );
  const { displayMat } = useFluidMaterials({
    config: {
      brushSize: params.brushSize,
      brushStrength: params.brushStrength,
      distortionAmount: params.distortionAmount,
      fluidDecay: params.fluidDecay,
      trailLength: params.trailLength,
      stopDecay: params.stopDecay,
      color1: params.color1,
      color2: params.color2,
      color3: params.color3,
      color4: params.color4,
      colorIntensity: params.colorIntensity,
      softness: params.softness,
    },
    simWidth: 256,
    simHeight: 512,
    pointerUvRef,
    pointerActiveRef,
  });

  // --- fat line material
  const lineMat = useMemo(() => {
    const m = new LineMaterial({
      color: 0xffffff,
      linewidth: 2,
      resolution: new THREE.Vector2(size.width, size.height),
    });
    m.depthTest = true;
    m.depthWrite = false;
    m.transparent = true;
    m.opacity = 1.0;
    return m;
  }, [size.width, size.height]);

  // keep resolution current (important for LineMaterial)
  useEffect(() => {
    lineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [lineMat, size.width, size.height, dpr]);

  // --- line geometry from edges
  const lineGeo = useMemo(() => {
    const edges = new THREE.EdgesGeometry(doorGeometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as any;

    const g = new LineSegmentsGeometry();
    g.setPositions(pos);

    edges.dispose();
    return g;
  }, [doorGeometry]);

  // --- create the wire ONCE (stable object identity)
  const wire = useMemo(() => {
    const w = new LineSegments2(lineGeo, lineMat);
    w.computeLineDistances();
    w.frustumCulled = false; // optional, avoids clipping surprises
    return w;
  }, [lineGeo, lineMat]);

  // --- cleanup
  useEffect(() => {
    return () => {
      doorGeometry.dispose();
      displayMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      // wire will be GC'd; it uses disposed geo/mat above
    };
  }, [doorGeometry, displayMat, lineGeo, lineMat]);

  // --- keep mesh + wire perfectly in sync
  useEffect(() => {
    const px = params.doorX;
    const py = params.doorY;
    const pz = params.doorZ;

    doorRef.current?.position.set(px, py, pz);
    wire.position.set(px, py, pz);

    doorRef.current?.scale.set(params.doorScaleX, params.doorScaleY, 1);
    wire.scale.set(params.doorScaleX, params.doorScaleY, 1);
  }, [
    params.doorX,
    params.doorY,
    params.doorZ,
    params.doorScaleX,
    params.doorScaleY,
    wire,
  ]);

  // --- billboard both to camera every frame
  useFrame(() => {
    const q = camera.quaternion;
    if (doorRef.current) doorRef.current.quaternion.copy(q);
    wire.quaternion.copy(q);
  });

  return (
    <group>
      <mesh
        ref={doorRef}
        geometry={doorGeometry}
        material={displayMat}
        onPointerMove={(e) => {
          pointerActiveRef.current = true;
          if (e.uv) pointerUvRef.current = e.uv.clone();
        }}
        onPointerOut={() => {
          pointerActiveRef.current = false;
          pointerUvRef.current = null;
        }}
        onPointerLeave={() => {
          pointerActiveRef.current = false;
          pointerUvRef.current = null;
        }}
      />

      <primitive object={wire} />
    </group>
  );
}
