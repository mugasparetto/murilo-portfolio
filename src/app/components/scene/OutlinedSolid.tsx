"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

type Props = {
  /** Fill geometry (required) */
  geometry: THREE.BufferGeometry;

  /** Fill material (optional). If omitted, a black MeshBasicMaterial is used. */
  fillMaterial?: THREE.Material;

  /**
   * If you pass a precomputed line geometry (recommended for many instances),
   * OutlinedSolid will use it instead of building EdgesGeometry itself.
   */
  lineGeometry?: LineSegmentsGeometry;

  /**
   * If you pass a shared LineMaterial (recommended for many instances),
   * OutlinedSolid will use it. Otherwise it creates its own.
   */
  lineMaterial?: LineMaterial;

  /** Only used if lineMaterial is NOT provided */
  lineColor?: THREE.ColorRepresentation;
  /** Only used if lineMaterial is NOT provided */
  lineWidth?: number;

  /** Helps prevent fill/line depth fighting at distance */
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;

  /** Slightly scales wire outward to avoid depth overlap */
  wireScale?: number;

  /** Render toggles */
  visible?: boolean;

  /** Transform props */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];

  /** Useful if you want the wire on top */
  renderOrder?: number;
};

export default function OutlinedSolid({
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
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const fillRef = useRef<THREE.Mesh>(null);

  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();

  // ---------- fill material ----------
  const internalFill = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color: "black" });
    return m;
  }, []);

  const finalFill = fillMaterial ?? internalFill;

  // apply polygon offset if supported by the material
  useEffect(() => {
    const m = finalFill as any;
    if (!polygonOffset) return;

    // many Three materials support these fields
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
  }, []); // create once

  const finalLineMat = lineMaterial ?? internalLineMat!;
  // keep shared or internal material resolution DPR-correct
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

  // ---------- line object (stable) ----------
  const wire = useMemo(() => {
    const w = new LineSegments2(finalLineGeo, finalLineMat);
    w.computeLineDistances();
    w.frustumCulled = false;
    return w;
  }, [finalLineGeo, finalLineMat]);

  // apply wire scale + render order
  useEffect(() => {
    wire.scale.setScalar(wireScale);
    if (typeof renderOrder === "number") wire.renderOrder = renderOrder;
  }, [wire, wireScale, renderOrder]);

  // cleanup ONLY internals
  useEffect(() => {
    return () => {
      if (!fillMaterial) internalFill.dispose();
      if (!lineMaterial) internalLineMat?.dispose();
      if (!lineGeometry) internalLineGeo?.dispose();
      // wire uses those resources; disposing them is enough
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep visibility consistent
  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible;
  }, [visible]);

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <mesh
        ref={fillRef}
        geometry={geometry}
        material={finalFill}
        renderOrder={renderOrder}
      />
      <primitive object={wire} />
    </group>
  );
}
