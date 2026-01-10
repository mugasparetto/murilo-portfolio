"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

type Props = {
  selected: THREE.Object3D[];
  visibleEdgeColor?: string;
  hiddenEdgeColor?: string;
  edgeStrength?: number;
  edgeThickness?: number;
  edgeGlow?: number;
  msaaSamples?: number; // 0, 4, 8
};

export default function Postprocessing({
  selected,
  visibleEdgeColor = "#ffffff",
  hiddenEdgeColor = "#001a1a",
  edgeStrength = 4.0,
  edgeThickness = 0.001,
  edgeGlow = 0.0,
  msaaSamples = 16,
}: Props) {
  const { gl, scene, camera, size } = useThree();

  // ✅ Create composer once, but with a render target that supports MSAA in WebGL2
  const composer = useMemo(() => {
    const isWebGL2 = gl.capabilities.isWebGL2;

    const rt = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      // depth/stencil default ok for OutlinePass
    });

    // MSAA is supported by setting samples on WebGL2
    rt.samples = isWebGL2 ? msaaSamples : 0;

    return new EffectComposer(gl, rt);
  }, [gl, msaaSamples]);

  const outlinePass = useMemo(() => {
    return new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
  }, [scene, camera]);

  // Build pass chain once
  useEffect(() => {
    composer.passes = [];
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(outlinePass);
    composer.addPass(new OutputPass());
  }, [composer, outlinePass, scene, camera]);

  // ✅ Resize composer using DPR-aware sizes
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width * dpr);
    const h = Math.floor(size.height * dpr);

    composer.setSize(w, h);
    outlinePass.setSize(w, h);
  }, [composer, outlinePass, size.width, size.height, gl]);

  // Update outline styling + selection
  useEffect(() => {
    outlinePass.selectedObjects = selected;

    outlinePass.edgeStrength = edgeStrength;
    outlinePass.edgeGlow = edgeGlow;
    outlinePass.edgeThickness = edgeThickness;
    outlinePass.visibleEdgeColor.set(visibleEdgeColor);
    outlinePass.hiddenEdgeColor.set(hiddenEdgeColor);
  }, [
    selected,
    outlinePass,
    visibleEdgeColor,
    hiddenEdgeColor,
    edgeStrength,
    edgeThickness,
    edgeGlow,
  ]);

  // Render composer after the main render
  useFrame(() => {
    composer.render();
  }, 1);

  // Cleanup render target on unmount
  useEffect(() => {
    return () => {
      const rt = composer.renderTarget1;
      rt?.dispose?.();
      composer.dispose?.();
    };
  }, [composer]);

  return null;
}
