"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";
import { useThree, useFrame } from "@react-three/fiber";

import OutlinedSolid from "@/app/components/OutlinedSolid";
import {
  stepReflectFragment,
  stepReflectVertex,
} from "../scene-core/reflectionShader";
import { TERRAIN_GRID } from "../scene-core/gridShader";

import {
  VhWindow,
  useScrollVhAbsolute,
  progressInVhWindow,
} from "@/app/helpers/scroll"; // <- adjust path

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

import type { DoorProjection } from "../scene-core/doorProjection";

type Props = {
  params: SceneParams;
  /** the door's display material — the steps reflect it */
  doorMat: THREE.ShaderMaterial;
  /** live door quad, written by <Door /> every frame */
  doorProjectionRef: RefObject<DoorProjection>;
  children?: React.ReactNode;
  scrollWindow: VhWindow;

  /** optional: if you scroll inside an element */
  scrollContainerRef?: RefObject<HTMLElement | null>;
};

export default function Steps({
  params,
  doorMat,
  doorProjectionRef,
  children,
  scrollWindow,
  scrollContainerRef,
}: Props) {
  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();

  const stepsRoot = useRef<THREE.Group>(null);
  const stepsPivot = useRef<THREE.Group>(null);
  const steps = useRef<THREE.Group>(null);
  const humanRef = useRef<THREE.Group>(null);

  const scrollVh = useScrollVhAbsolute(scrollContainerRef);

  const { up } = useBreakpoints(BREAKPOINTS);

  const stepWidth = 800;
  const stepHeight = 40;
  const stepDepth = 350;
  const stepCount = 12;

  const stepScale = !up.md ? 1.4 : 1.6;

  // Shared geometry (fill)
  const stepGeometry = useMemo(
    () => new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth, 1, 1, 1),
    [],
  );

  // Shared fat-line material for all steps
  const stepLineMat = useMemo(() => {
    const m = new LineMaterial({
      color: 0xe8e8e0,
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

  const fillMat = useMemo(() => {
    const d = doorMat.uniforms;

    return new THREE.ShaderMaterial({
      uniforms: {
        // ⬇️ shared *objects* with the door material: same clock, same fluid
        // texture, same colors. Whatever the door shows is what we reflect,
        // and useFluidMaterials keeps updating both at once.
        iTime: d.iTime,
        iResolution: d.iResolution, // “pattern space”, not screen
        uDoorFluid: d.iFluid,
        uSeed: d.uSeed,
        uDistortionAmount: d.uDistortionAmount,
        uColor1: d.uColor1,
        uColor2: d.uColor2,
        uColor3: d.uColor3,
        uColor4: d.uColor4,
        uColorIntensity: d.uColorIntensity,
        uSoftness: d.uSoftness,

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

        // ---- grid: same columns as the terrain, same width, same colour ----
        uGridWidth: { value: params.w },
        uGrid: { value: TERRAIN_GRID },
        uGridOffset: { value: params.stepGridOffset },
        uGridLineWidth: { value: params.lineWidth * dpr },
        uGridLineColor: { value: new THREE.Color(0xe8e8e0) },
        uFillColor: { value: new THREE.Color(0x000000) },

        // inactive until something drives clipRef (see below)
        uClipPlanePoint: { value: new THREE.Vector3() },
        uClipPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
        uClipPlaneSide: { value: 0.0 },
      },
      vertexShader: stepReflectVertex,
      fragmentShader: stepReflectFragment,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorMat]);

  // keep resolution current (LineMaterial)
  useEffect(() => {
    stepLineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [stepLineMat, size.width, size.height, dpr]);

  // Shared line geometry for all steps (Edges of the box)
  const stepLineGeo = useMemo(() => {
    const edges = new THREE.EdgesGeometry(stepGeometry);
    const pos = (edges.attributes.position as THREE.BufferAttribute)
      .array as Float32Array;

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
      fillMat.dispose();
    };
  }, [stepGeometry, stepLineGeo, stepLineMat, fillMat]);

  // Recenter pivot once after mount
  useEffect(() => {
    if (!steps.current || !stepsPivot.current) return;

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

    stepsRoot.current.position.set(
      params.stepX,
      !up.md ? params.stepY - 160 : params.stepY,
      params.stepZ,
    );
    stepsPivot.current.rotation.y = params.rotY;
    stepsPivot.current.rotation.x = params.rotZ;
    stepsPivot.current.scale.setScalar(stepScale);
  }, [
    params.stepX,
    params.stepY,
    params.stepZ,
    params.rotY,
    params.rotZ,
    up.md,
    stepScale,
  ]);

  const stepGroups = useRef<THREE.Group[]>([]);
  stepGroups.current = [];
  const registerStepGroup = (el: THREE.Group | null) => {
    if (el) stepGroups.current.push(el);
  };

  // Door look/time/colors ride along on the shared uniform objects, so all we
  // have to push is where the door actually is and how it should read.
  useFrame(() => {
    const u = fillMat.uniforms;
    const door = doorProjectionRef.current;

    if (door) {
      (u.uDoorPos.value as THREE.Vector3).copy(door.position);
      (u.uDoorRight.value as THREE.Vector3).copy(door.right);
      (u.uDoorUp.value as THREE.Vector3).copy(door.up);
      (u.uDoorHalfSize.value as THREE.Vector2).copy(door.halfSize);
      u.uDoorStrength.value = door.strength;
    }

    // GUI mutates params in place, so re-read them to keep the knobs live
    u.uIntensity.value = params.reflectIntensity;
    u.uFalloff.value = params.reflectFalloff;
    u.uRoughness.value = params.reflectRoughness;
    u.uFacing.value = params.reflectFacing;
    u.uTopBoost.value = params.reflectTopBoost;
    u.uReach.value = params.reflectReach;
    u.uSpread.value = params.reflectSpread;
    u.uEdgeSoft.value = params.reflectEdgeSoft;

    // same sources as the terrain's grid, so the two can never drift apart
    u.uGridLineWidth.value = params.lineWidth * gl.getPixelRatio();
    u.uGridWidth.value = params.w;
    u.uGridOffset.value = params.stepGridOffset;
  });

  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useFrame(() => {
    const t = progressInVhWindow(scrollVh.current, scrollWindow);

    if (humanRef.current) humanRef.current.visible = t < 0.955;
    if (stepsRoot.current) stepsRoot.current.visible = t < 0.999;

    // ---- GLOBAL MOTION ----
    // how far the staircase travels overall
    const totalSteps = stepCount;
    const travel = t * totalSteps;

    const offsetY = travel * stepHeight;
    const offsetZ = travel * -stepDepth;

    stepGroups.current.forEach((step, i) => {
      // base position (static staircase)
      const baseY = i * stepHeight;
      const baseZ = -i * stepDepth;

      // everyone moves together
      step.position.set(0, baseY + offsetY, baseZ + offsetZ);
    });
  });

  // shared plane object used by LineMaterial (and optionally other materials)
  const clipPlane = useMemo(() => new THREE.Plane(), []);

  const clipRef = useRef<THREE.Object3D>(null);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpNormal = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    if (!clipRef.current) return;

    clipRef.current.getWorldPosition(tmpPos);
    clipRef.current.getWorldQuaternion(tmpQuat);
    tmpNormal.set(0, 0, 1).applyQuaternion(tmpQuat).normalize();

    // update the Three.Plane (world space)
    clipPlane.setFromNormalAndCoplanarPoint(tmpNormal, tmpPos);

    (fillMat.uniforms.uClipPlanePoint.value as THREE.Vector3).copy(tmpPos);
    (fillMat.uniforms.uClipPlaneNormal.value as THREE.Vector3).copy(tmpNormal);

    fillMat.uniforms.uClipPlaneSide.value = -1.0; // or -1.0
  });

  // useEffect(() => {
  //   stepLineMat.clippingPlanes = [clipPlane];
  //   stepLineMat.clipIntersection = false;
  //   stepLineMat.clipShadows = true;
  //   stepLineMat.needsUpdate = true;
  // }, [stepLineMat, clipPlane]);

  useEffect(() => {
    if (!clipRef.current) return;
    // clipRef.current.position.set(0, 0, -1378);
    // clipRef.current.rotation.set(0, 0, 0);
  }, []);

  return (
    <group ref={stepsRoot}>
      <group ref={stepsPivot}>
        <group ref={steps}>
          <group ref={registerStepGroup} position={[0, 0, 0]}>
            <OutlinedSolid
              geometry={stepGeometry}
              lineMaterial={stepLineMat}
              position={[0, 0, 0]}
              wireScale={1.002}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              fillMaterial={fillMat}
              scale={[1, 1, 0.98]}
            />
            <group ref={humanRef}>{children}</group>
          </group>
          {Array.from({ length: stepCount - 1 }).map((_, i) => (
            <group
              key={i}
              ref={registerStepGroup}
              position={[0, (i + 1) * stepHeight, -(i + 1) * stepDepth]}
            >
              <OutlinedSolid
                geometry={stepGeometry}
                lineMaterial={stepLineMat}
                position={[0, 0, 0]}
                wireScale={1.002}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
                fillMaterial={fillMat}
                scale={[1, 1, 0.98]}
              />
            </group>
          ))}

          {/* <group
            ref={registerStepGroup}
            position={[0, 2 * stepHeight, -2 * stepDepth]}
          >
            <OutlinedSolid
              geometry={stepGeometry}
              lineMaterial={stepLineMat}
              position={[0, 0, 0]}
              wireScale={1.002}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              fillMaterial={fillMat}
              scale={[1, 1, 0.98]}
            />
          </group>
          <group
            ref={registerStepGroup}
            position={[0, 3 * stepHeight, -3 * stepDepth]}
          >
            <OutlinedSolid
              geometry={stepGeometry}
              lineMaterial={stepLineMat}
              position={[0, 0, 0]}
              wireScale={1.002}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              fillMaterial={fillMat}
              scale={[1, 1, 0.98]}
            />
          </group>
          <group
            ref={registerStepGroup}
            position={[0, 4 * stepHeight, -4 * stepDepth]}
          >
            <OutlinedSolid
              geometry={stepGeometry}
              lineMaterial={stepLineMat}
              position={[0, 0, 0]}
              wireScale={1.002}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              fillMaterial={fillMat}
              scale={[1, 1, 0.98]}
            />
          </group> */}
          {/* <group ref={clipRef} position={[0, 0, 0]} rotation={[0, 0, 0]}> */}
          {/* <mesh renderOrder={9999}>
              <planeGeometry args={[2000, 2000]} />
              <meshBasicMaterial
                transparent
                opacity={0.15}
                depthWrite={false}
                side={THREE.DoubleSide}
                color={"yellow"}
              />
            </mesh> */}
          {/* </group> */}
        </group>
      </group>
    </group>
  );
}
