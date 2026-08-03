"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";

import { useFrame, useThree } from "@react-three/fiber";

import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

import {
  VhWindow,
  useScrollVhAbsolute,
  progressInVhWindow,
} from "@/app/helpers/scroll"; // <- adjust path

import type { DoorProjection } from "../scene-core/doorProjection";

type Props = {
  params: SceneParams;
  displayMat: THREE.ShaderMaterial;
  pointerUvRef: React.RefObject<THREE.Vector2 | null>;
  pointerActiveRef: React.RefObject<boolean>;

  scrollWindow: VhWindow;

  /** written every frame so <Steps /> can reflect this door */
  doorProjectionRef?: RefObject<DoorProjection>;

  /** optional: if you scroll inside an element */
  scrollContainerRef?: RefObject<HTMLElement | null>;
};

const BLOOM_LAYER = 1;

const DOOR_WIDTH = 800;
const DOOR_HEIGHT = 1600;

export default function Door({
  params,
  displayMat,
  pointerUvRef,
  pointerActiveRef,
  scrollWindow,
  doorProjectionRef,
  scrollContainerRef,
}: Props) {
  const { size, camera, gl } = useThree();
  const dpr = gl.getPixelRatio();
  const { up } = useBreakpoints(BREAKPOINTS);
  const doorRef = useRef<THREE.Mesh>(null);

  const scrollVh = useScrollVhAbsolute(scrollContainerRef);

  const doorGeometry = useMemo(
    () => new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, 1),
    [],
  );

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

  useEffect(() => {
    lineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [lineMat, size.width, size.height, dpr]);

  useEffect(() => {
    if (!doorRef.current) return;
    doorRef.current.layers.enable(BLOOM_LAYER);
    // draw before anything that should be maskable by the door's silhouette
    doorRef.current.renderOrder = -1;
  }, []);

  // stamp the door's on-screen shape into the stencil buffer so other
  // objects (eg. <Name />) can be clipped by it regardless of their own Z
  useEffect(() => {
    displayMat.stencilWrite = true;
    displayMat.stencilRef = 1;
    displayMat.stencilFunc = THREE.AlwaysStencilFunc;
    displayMat.stencilFail = THREE.KeepStencilOp;
    displayMat.stencilZFail = THREE.KeepStencilOp;
    displayMat.stencilZPass = THREE.ReplaceStencilOp;
  }, [displayMat]);

  const lineGeo = useMemo(() => {
    const edges = new THREE.EdgesGeometry(doorGeometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as Float32Array;

    const g = new LineSegmentsGeometry();
    g.setPositions(pos);

    edges.dispose();
    return g;
  }, [doorGeometry]);

  const wire = useMemo(() => {
    const w = new LineSegments2(lineGeo, lineMat);
    w.computeLineDistances();
    w.frustumCulled = false;
    return w;
  }, [lineGeo, lineMat]);

  useEffect(() => {
    return () => {
      doorGeometry.dispose();
      displayMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    };
  }, [doorGeometry, displayMat, lineGeo, lineMat]);

  const scale = useMemo(() => {
    return !up.md
      ? { x: 1.16, y: 1.1 }
      : { x: params.doorScaleX, y: params.doorScaleY };
  }, [up.md, params.doorScaleX, params.doorScaleY]);

  useEffect(() => {
    const px = params.doorX;
    const py = params.doorY;
    const pz = params.doorZ;

    doorRef.current?.position.set(!up.md ? 0 : px, !up.md ? 1510 : py, pz);
    wire.position.set(!up.md ? 0 : px, !up.md ? 1510 : py, pz + 3);

    doorRef.current?.scale.set(scale.x, scale.y, 1);
    wire.scale.set(scale.x, scale.y, 1);
  }, [params.doorX, params.doorY, params.doorZ, wire, scale.x, scale.y, up.md]);

  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const mesh = doorRef.current;
    if (!mesh) return;

    // scroll squeezes the door shut
    const t = progressInVhWindow(scrollVh.current, scrollWindow); // 0..1 in this vh window
    const openness = 1 - t;
    const visible = t < 0.999;

    mesh.scale.set(scale.x, scale.y * openness, 1);
    mesh.visible = visible;
    wire.scale.set(scale.x, scale.y * openness, 1);
    wire.visible = visible;

    // publish the live quad so <Steps /> can reflect this material.
    // taken from the world matrix, so the group offset, the mobile overrides
    // and the shrink above are all baked in.
    const proj = doorProjectionRef?.current;
    if (!proj) return;

    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(proj.position, tmpQuat, tmpScale);

    proj.right.set(1, 0, 0).applyQuaternion(tmpQuat).normalize();
    proj.up.set(0, 1, 0).applyQuaternion(tmpQuat).normalize();
    proj.normal.set(0, 0, 1).applyQuaternion(tmpQuat).normalize();
    proj.halfSize.set(
      DOOR_WIDTH * Math.abs(tmpScale.x) * 0.5,
      DOOR_HEIGHT * Math.abs(tmpScale.y) * 0.5,
    );
    proj.strength = visible ? openness : 0;
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
