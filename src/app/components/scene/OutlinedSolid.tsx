"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

type LineMode = "edges" | "wireframe";

type Props = {
  geometry: THREE.BufferGeometry;
  fillMaterial?: THREE.Material;

  /** Optional precomputed line geometry (recommended for many instances) */
  lineGeometry?: LineSegmentsGeometry;

  /** Optional shared fat line material */
  lineMaterial?: LineMaterial;

  /** Only used if lineMaterial is NOT provided */
  lineColor?: THREE.ColorRepresentation;
  /** Only used if lineMaterial is NOT provided */
  lineWidth?: number;

  /**
   * How to generate lines if lineGeometry isn't provided:
   * - "edges": feature/silhouette edges via EdgesGeometry (your current look)
   * - "wireframe": all triangle edges via WireframeGeometry (internal triangles)
   */
  lineMode?: LineMode;

  /**
   * Used only in "edges" mode. Lower values include more edges.
   * 1–15 is typical. 0 shows basically everything (often too much).
   */
  edgeThresholdAngle?: number;

  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;

  wireScale?: number;
  visible?: boolean;

  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];

  renderOrder?: number;
};

export default function OutlinedSolid({
  geometry,
  fillMaterial,
  lineGeometry,
  lineMaterial,
  lineColor = 0xffffff,
  lineWidth = 2,

  lineMode = "edges",
  edgeThresholdAngle = 1, // ✅ low angle = more edges in "edges" mode

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

  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();

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

    let g3: THREE.BufferGeometry;

    if (lineMode === "wireframe") {
      // ✅ internal triangle edges everywhere
      g3 = new THREE.WireframeGeometry(geometry);
    } else {
      // ✅ "edges" (feature edges); threshold controls how much detail
      g3 = new THREE.EdgesGeometry(geometry, edgeThresholdAngle);
    }

    const pos = (g3.attributes.position as THREE.BufferAttribute).array as any;
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);

    g3.dispose();
    return g;
  }, [geometry, lineGeometry, lineMode, edgeThresholdAngle]);

  const finalLineGeo = lineGeometry ?? internalLineGeo!;

  // ---------- line object ----------
  const wire = useMemo(() => {
    const w = new LineSegments2(finalLineGeo, finalLineMat);
    w.computeLineDistances();
    w.frustumCulled = false;
    return w;
  }, [finalLineGeo, finalLineMat]);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (groupRef.current) groupRef.current.visible = visible;
  }, [visible]);

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <mesh
        geometry={geometry}
        material={finalFill}
        renderOrder={renderOrder}
      />
      <primitive object={wire} />
    </group>
  );
}
