"use client";

import React, { forwardRef, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

type Props = {
  geometry: THREE.BufferGeometry;
  fillMaterial?: THREE.Material;

  lineGeometry?: LineSegmentsGeometry;
  lineMaterial?: LineMaterial;

  lineColor?: THREE.ColorRepresentation;
  lineWidth?: number;

  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;

  wireScale?: number;
  visible?: boolean;

  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];

  renderOrder?: number; // fill uses this, wire uses +1
};

const OutlinedSolid = forwardRef<THREE.Group, Props>(function OutlinedSolid(
  {
    geometry,
    fillMaterial,
    lineGeometry,
    lineMaterial,
    lineColor = 0xffffff,
    lineWidth = 2,

    polygonOffset = true,
    polygonOffsetFactor = 1,
    polygonOffsetUnits = 1,

    wireScale = 1.001,
    visible = true,

    position,
    rotation,
    scale,

    renderOrder,
  },
  forwardedRef
) {
  const localGroupRef = useRef<THREE.Group>(null);
  const wireRef = useRef<LineSegments2>(null);

  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();

  // Merge forwarded ref + local ref
  useEffect(() => {
    if (!forwardedRef) return;
    const node = localGroupRef.current;
    if (!node) return;

    if (typeof forwardedRef === "function") forwardedRef(node);
    else forwardedRef.current = node;
  }, [forwardedRef]);

  // ---------- fill material ----------
  const internalFill = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "black" }),
    []
  );
  const finalFill = fillMaterial ?? internalFill;

  useEffect(() => {
    if (!polygonOffset) return;
    const m = finalFill as any;
    m.polygonOffset = true;
    m.polygonOffsetFactor = polygonOffsetFactor;
    m.polygonOffsetUnits = polygonOffsetUnits;
  }, [finalFill, polygonOffset, polygonOffsetFactor, polygonOffsetUnits]);

  // ---------- line material ----------
  const internalLineMat = useMemo(() => {
    if (lineMaterial) return null;
    const m = new LineMaterial({
      color: new THREE.Color(lineColor as any),
      linewidth: lineWidth,
      resolution: new THREE.Vector2(size.width * dpr, size.height * dpr),
    });
    m.depthTest = true;
    m.depthWrite = false;
    m.transparent = true;
    m.opacity = 1.0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalLineMat = lineMaterial ?? internalLineMat!;

  useEffect(() => {
    finalLineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [finalLineMat, size.width, size.height, dpr]);

  // ---------- line geometry ----------
  const internalLineGeo = useMemo(() => {
    if (lineGeometry) return null;

    const edges = new THREE.EdgesGeometry(geometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as any;

    const g = new LineSegmentsGeometry();
    g.setPositions(pos);

    edges.dispose();
    return g;
  }, [geometry, lineGeometry]);

  const finalLineGeo = lineGeometry ?? internalLineGeo!;

  const fillOrder = typeof renderOrder === "number" ? renderOrder : 0;
  const wireOrder = fillOrder + 1;

  // wire instance (stable per component)
  const wireObj = useMemo(() => {
    const w = new LineSegments2(finalLineGeo, finalLineMat);
    w.frustumCulled = false;
    w.computeLineDistances();
    return w;
  }, [finalLineGeo, finalLineMat]);

  useEffect(() => {
    wireObj.scale.setScalar(wireScale);
    wireObj.renderOrder = wireOrder;
  }, [wireObj, wireScale, wireOrder]);

  useEffect(() => {
    if (localGroupRef.current) localGroupRef.current.visible = visible;
  }, [visible]);

  useEffect(() => {
    return () => {
      if (!fillMaterial) internalFill.dispose();
      if (!lineMaterial) internalLineMat?.dispose();
      if (!lineGeometry) internalLineGeo?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group
      ref={localGroupRef}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      <mesh geometry={geometry} material={finalFill} renderOrder={fillOrder} />
      <primitive ref={wireRef} object={wireObj} />
    </group>
  );
});

export default OutlinedSolid;
