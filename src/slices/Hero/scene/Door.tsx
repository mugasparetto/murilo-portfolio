"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { useFrame, useThree } from "@react-three/fiber";

import { progressInWindow, ScrollWindow } from "@/app/components/ScrollRig";
import { makeRanges, segmentProgress } from "../../../app/helpers/scroll";
import { useScrollProgress } from "@/app/hooks/ScrollProgress";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

type Props = {
  params: SceneParams;
  displayMat: THREE.ShaderMaterial;
  pointerUvRef: React.MutableRefObject<THREE.Vector2 | null>;
  pointerActiveRef: React.MutableRefObject<boolean>;
  totalPagesCount: number;
  scrollWindow: ScrollWindow;
};

const BLOOM_LAYER = 1;

export default function Door({
  params,
  displayMat,
  pointerUvRef,
  pointerActiveRef,
  totalPagesCount = 0,
  scrollWindow = { startPage: 1, endPage: 2 },
}: Props) {
  const { size, camera, gl } = useThree();
  const dpr = gl.getPixelRatio();
  const { up } = useBreakpoints(BREAKPOINTS);
  const doorRef = useRef<THREE.Mesh>(null);

  const stepWidth = 800;

  // --- geometry/material (stable)
  const doorGeometry = useMemo(
    () => new THREE.BoxGeometry(stepWidth, 2 * stepWidth, 1),
    [],
  );

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

  useEffect(() => {
    if (!doorRef.current) return;
    doorRef.current.layers.enable(BLOOM_LAYER);
  }, []);

  // --- line geometry from edges
  const lineGeo = useMemo(() => {
    const edges = new THREE.EdgesGeometry(doorGeometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as Float32Array;

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

  const scale = useMemo(() => {
    return !up.md
      ? { x: 1.15, y: 1.1 }
      : { x: params.doorScaleX, y: params.doorScaleY };
  }, [up.md, params.doorScaleX, params.doorScaleY]);

  // --- keep mesh + wire perfectly in sync
  useEffect(() => {
    const px = params.doorX;
    const py = params.doorY;
    const pz = params.doorZ;

    doorRef.current?.position.set(!up.md ? 0 : px, !up.md ? 1510 : py, pz);
    wire.position.set(!up.md ? 0 : px, !up.md ? 1510 : py, pz + 3);

    doorRef.current?.scale.set(scale.x, scale.y, 1);
    wire.scale.set(scale.x, scale.y, 1);
  }, [
    params.doorX,
    params.doorY,
    params.doorZ,
    params.doorScaleX,
    params.doorScaleY,
    wire,
    scale.x,
    scale.y,
    up.md,
  ]);

  // --- billboard both to camera every frame
  useFrame(() => {
    const q = camera.quaternion;
    if (doorRef.current) doorRef.current.quaternion.copy(q);
    wire.quaternion.copy(q);
  });

  const { scrollProgress } = useScrollProgress();

  // scroll allocation per phase (you can tweak these)
  const PHASE_WEIGHTS = [0.4, 0.6]; // portalsIn, text, portalsOut
  const PHASES = makeRanges(PHASE_WEIGHTS);

  useFrame(() => {
    const t = progressInWindow(
      scrollProgress.current,
      totalPagesCount,
      scrollWindow,
    );

    const progressDoor = segmentProgress(t, PHASES, 1); // 0..1 in phase 1

    if (doorRef.current) {
      doorRef.current.scale.y = scale.y * (1 - progressDoor);
      doorRef.current.visible = t < 0.999;
    }

    wire.scale.y = scale.y * (1 - progressDoor);
    wire.visible = t < 0.999;
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
