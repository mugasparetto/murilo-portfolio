"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";
import { useThree } from "@react-three/fiber";

import OutlinedSolid from "./OutlinedSolid";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

type Props = { params: SceneParams };

export default function Steps({ params }: Props) {
  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();

  const stepsRoot = useRef<THREE.Group>(null);
  const stepsPivot = useRef<THREE.Group>(null);
  const steps = useRef<THREE.Group>(null);

  const stepWidth = 800;
  const stepHeight = 100;
  const stepDepth = 550;

  // Shared geometry (fill)
  const stepGeometry = useMemo(
    () => new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth, 1, 1, 1),
    []
  );

  // Shared fat-line material for all steps
  const stepLineMat = useMemo(() => {
    const m = new LineMaterial({
      color: 0xffffff,
      linewidth: 2,
      resolution: new THREE.Vector2(size.width * dpr, size.height * dpr),
    });
    m.depthTest = true;
    m.depthWrite = false;
    m.transparent = true;
    m.opacity = 1.0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stepLineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [stepLineMat, size.width, size.height, dpr]);

  // Shared line geometry for all steps (Edges of the box)
  const stepLineGeo = useMemo(() => {
    const edges = new THREE.EdgesGeometry(stepGeometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as any;

    const g = new LineSegmentsGeometry();
    g.setPositions(pos);

    edges.dispose();
    return g;
  }, [stepGeometry]);

  // Cleanup shared resources
  useEffect(() => {
    return () => {
      stepGeometry.dispose();
      stepLineGeo.dispose();
      stepLineMat.dispose();
    };
  }, [stepGeometry, stepLineGeo, stepLineMat]);

  // Recenter pivot once after mount
  useEffect(() => {
    if (!steps.current || !stepsPivot.current) return;

    // ensure no extra offset
    steps.current.position.set(0, 0, 0);

    const box = new THREE.Box3().setFromObject(steps.current);
    const center = new THREE.Vector3();
    box.getCenter(center);

    stepsPivot.current.position.copy(center);
    steps.current.position.sub(center);
  }, []);

  // Update transform when params change
  useEffect(() => {
    if (!stepsRoot.current || !stepsPivot.current) return;

    stepsRoot.current.position.set(params.stepX, params.stepY, params.stepZ);
    stepsPivot.current.rotation.y = params.rotY;
    stepsPivot.current.rotation.x = params.rotZ;
    stepsPivot.current.scale.setScalar(1.6);
  }, [params.stepX, params.stepY, params.stepZ, params.rotY, params.rotZ]);

  return (
    <group ref={stepsRoot}>
      <group ref={stepsPivot}>
        <group ref={steps}>
          {/* local layout only */}
          <OutlinedSolid
            geometry={stepGeometry}
            lineGeometry={stepLineGeo}
            lineMaterial={stepLineMat}
            position={[0, 0, 0]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
          <OutlinedSolid
            geometry={stepGeometry}
            lineGeometry={stepLineGeo}
            lineMaterial={stepLineMat}
            position={[0, stepHeight, -stepDepth]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
          <OutlinedSolid
            geometry={stepGeometry}
            lineGeometry={stepLineGeo}
            lineMaterial={stepLineMat}
            position={[0, 2 * stepHeight, -2 * stepDepth]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </group>
      </group>
    </group>
  );
}
