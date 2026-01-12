"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SceneParams } from "../scene-core/params";
import { useThree, useFrame } from "@react-three/fiber";

import OutlinedSolid from "./OutlinedSolid";
import {
  stepReflectFragment,
  stepReflectVertex,
} from "../scene-core/reflectionShader";

import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

type Props = {
  params: SceneParams;
  doorFluidTextureRef: React.MutableRefObject<THREE.Texture | null>;
};

export default function Steps({ params, doorFluidTextureRef }: Props) {
  const { size, gl, camera } = useThree();
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

  function hexToLinearVec3(hex: string) {
    const c = new THREE.Color(hex);
    c.convertSRGBToLinear();
    return new THREE.Vector3(c.r, c.g, c.b);
  }

  const fillMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(512, 1024) }, // “pattern space”, not screen

        uDoorFluid: { value: null as THREE.Texture | null },

        uDistortionAmount: { value: params.distortionAmount },
        uColor1: { value: hexToLinearVec3(params.color1) },
        uColor2: { value: hexToLinearVec3(params.color2) },
        uColor3: { value: hexToLinearVec3(params.color3) },
        uColor4: { value: hexToLinearVec3(params.color4) },
        uColorIntensity: { value: params.colorIntensity },
        uSoftness: { value: params.softness },

        uDoorPos: { value: new THREE.Vector3() },
        uDoorRight: { value: new THREE.Vector3(1, 0, 0) },
        uDoorUp: { value: new THREE.Vector3(0, 1, 0) },
        uDoorHalfSize: { value: new THREE.Vector2(400, 800) },

        uIntensity: { value: 2 },
        uFalloff: { value: 0.001 },

        uTopStart: { value: 0.25 },
        uTopEnd: { value: 1 },
      },
      vertexShader: stepReflectVertex,
      fragmentShader: stepReflectFragment,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep resolution current (LineMaterial)
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

    stepsRoot.current.position.set(params.stepX, params.stepY, params.stepZ);
    stepsPivot.current.rotation.y = params.rotY;
    stepsPivot.current.rotation.x = params.rotZ;
    stepsPivot.current.scale.setScalar(1.6);
  }, [params.stepX, params.stepY, params.stepZ, params.rotY, params.rotZ]);

  // ✅ Update uniforms every frame (texture + door plane basis + sizes)
  useFrame(() => {
    // door center
    fillMat.uniforms.uDoorPos.value.set(
      params.doorX,
      params.doorY,
      params.doorZ
    );

    // door basis: since door billboards to camera, use camera right/up
    const q = camera.quaternion;
    (fillMat.uniforms.uDoorRight.value as THREE.Vector3)
      .set(1, 0, 0)
      .applyQuaternion(q)
      .normalize();
    (fillMat.uniforms.uDoorUp.value as THREE.Vector3)
      .set(0, 1, 0)
      .applyQuaternion(q)
      .normalize();

    // door size in world units (your door is 800 x 1600 before scale)
    const halfW = 800 * params.doorScaleX * 0.5;
    const halfH = 1600 * params.doorScaleY * 0.5;
    (fillMat.uniforms.uDoorHalfSize.value as THREE.Vector2).set(halfW, halfH);

    // latest door texture
    const tex = doorFluidTextureRef.current;
    if (tex) fillMat.uniforms.uDoorFluid.value = tex;
  });

  useFrame((state) => {
    fillMat.uniforms.iTime.value = state.clock.elapsedTime;

    // keep in sync with door look (if these are GUI params)
    fillMat.uniforms.uDistortionAmount.value = params.distortionAmount;
    fillMat.uniforms.uColorIntensity.value = params.colorIntensity;
    fillMat.uniforms.uSoftness.value = params.softness;

    (fillMat.uniforms.uColor1.value as THREE.Vector3).copy(
      hexToLinearVec3(params.color1)
    );
    (fillMat.uniforms.uColor2.value as THREE.Vector3).copy(
      hexToLinearVec3(params.color2)
    );
    (fillMat.uniforms.uColor3.value as THREE.Vector3).copy(
      hexToLinearVec3(params.color3)
    );
    (fillMat.uniforms.uColor4.value as THREE.Vector3).copy(
      hexToLinearVec3(params.color4)
    );

    // door center
    fillMat.uniforms.uDoorPos.value.set(
      params.doorX,
      params.doorY,
      params.doorZ
    );

    // door basis from camera because door is billboarded
    const q = camera.quaternion;
    (fillMat.uniforms.uDoorRight.value as THREE.Vector3)
      .set(1, 0, 0)
      .applyQuaternion(q)
      .normalize();
    (fillMat.uniforms.uDoorUp.value as THREE.Vector3)
      .set(0, 1, 0)
      .applyQuaternion(q)
      .normalize();

    // door size in world units (800 x 1600, scaled)
    const halfW = 800 * params.doorScaleX * 0.5;
    const halfH = 1600 * params.doorScaleY * 0.5;
    (fillMat.uniforms.uDoorHalfSize.value as THREE.Vector2).set(halfW, halfH);

    // latest fluid sim texture (distortion field)
    const tex = doorFluidTextureRef.current;
    if (tex) fillMat.uniforms.uDoorFluid.value = tex;
  });

  return (
    <group ref={stepsRoot}>
      <group ref={stepsPivot}>
        <group ref={steps}>
          <OutlinedSolid
            geometry={stepGeometry}
            lineMaterial={stepLineMat}
            position={[0, 0, 0]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            fillMaterial={fillMat}
          />
          <OutlinedSolid
            geometry={stepGeometry}
            lineMaterial={stepLineMat}
            position={[0, stepHeight, -stepDepth]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            fillMaterial={fillMat}
          />
          <OutlinedSolid
            geometry={stepGeometry}
            lineMaterial={stepLineMat}
            position={[0, 2 * stepHeight, -2 * stepDepth]}
            wireScale={1.002}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            fillMaterial={fillMat}
          />
        </group>
      </group>
    </group>
  );
}
