"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";

import {
  vertexShader,
  fluidShader,
  displayShader,
} from "../scene-core/fluidShader";

export type FluidConfig = {
  brushSize: number;
  brushStrength: number;
  distortionAmount: number;
  fluidDecay: number; // 0..1 (recommended)
  trailLength: number; // 0..1 (recommended)
  stopDecay: number; // 0..1 (recommended)
  color1: string;
  color2: string;
  color3: string;
  color4: string;
  colorIntensity: number;
  softness: number;
};

// utils
function hexToLinearVec3(hex: string) {
  const c = new THREE.Color(hex);
  // Convert from sRGB (hex) to linear, because ShaderMaterial expects linear
  c.convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

type Props = {
  /** Your config values */
  config: FluidConfig;

  /** Simulation resolution (pixels). 512–1024 is a good start. */
  simWidth?: number;
  simHeight?: number;

  /**
   * Provide door pointer UVs in 0..1
   * (we keep prev internally)
   */
  pointerUvRef: React.MutableRefObject<THREE.Vector2 | null>;
  pointerActiveRef: React.MutableRefObject<boolean>;
};

export function useFluidMaterials({
  config,
  simWidth = 1024,
  simHeight = 1024,
  pointerUvRef,
  pointerActiveRef,
}: Props) {
  const { gl } = useThree();

  // Choose a float type that usually works
  const texType = useMemo(() => {
    // WebGL2 usually supports float/half-float render targets more reliably
    // HalfFloat is a safer default across GPUs
    return THREE.HalfFloatType;
  }, []);

  const rtA = useFBO(simWidth, simHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: texType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const rtB = useFBO(simWidth, simHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: texType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  // ping-pong refs
  const currentRT = useRef<THREE.WebGLRenderTarget>(rtA);
  const previousRT = useRef<THREE.WebGLRenderTarget>(rtB);

  const fluidTextureRef = useRef<THREE.Texture | null>(null);

  // sim scene: full-screen quad + ortho camera
  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCam = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    []
  );

  const timeRef = useRef(0);
  const frameRef = useRef(0);

  // mouse bookkeeping in sim pixels
  const prevMousePx = useRef(new THREE.Vector2(0, 0));
  const lastMoveTime = useRef(0);

  const fluidMat = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(simWidth, simHeight) },
        iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
        iFrame: { value: 0 },
        iPreviousFrame: { value: null as THREE.Texture | null },

        uBrushSize: { value: config.brushSize },
        uBrushStrength: { value: config.brushStrength },
        uFluidDecay: { value: config.fluidDecay },
        uTrailLength: { value: config.trailLength },
        uStopDecay: { value: config.stopDecay },
      },
      vertexShader,
      fragmentShader: fluidShader,
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simWidth, simHeight]);

  // A mesh in the simScene
  const simQuad = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geo, fluidMat);
    simScene.add(mesh);
    return { geo, mesh };
  }, [fluidMat, simScene]);

  // (what you put on the mesh)
  const displayMat = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector2(simWidth, simHeight) },
        iFluid: { value: null as THREE.Texture | null },

        uDistortionAmount: { value: config.distortionAmount },
        uColor1: { value: hexToLinearVec3(config.color1) },
        uColor2: { value: hexToLinearVec3(config.color2) },
        uColor3: { value: hexToLinearVec3(config.color3) },
        uColor4: { value: hexToLinearVec3(config.color4) },
        uColorIntensity: { value: config.colorIntensity },
        uSoftness: { value: config.softness },
      },
      vertexShader,
      fragmentShader: displayShader,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simWidth, simHeight]);

  // Cleanup sim quad geometry
  useEffect(() => {
    return () => {
      simQuad.geo.dispose();
      fluidMat.dispose();
      displayMat.dispose();
    };
  }, [simQuad.geo, fluidMat, displayMat]);

  useFrame((state, delta) => {
    timeRef.current += delta;

    // Update time uniforms (delta-based, not frame-based)
    fluidMat.uniforms.iTime.value = timeRef.current;
    displayMat.uniforms.iTime.value = timeRef.current;

    // Keep iFrame only for the shader's initialization branch.
    // (Not used for animation timing)
    fluidMat.uniforms.iFrame.value = frameRef.current;

    // --- pointer -> iMouse (in sim pixel coords)
    // Only inject when pointer is active on the door.
    const now = timeRef.current;
    const uv = pointerUvRef.current;

    if (pointerActiveRef.current && uv) {
      const mx = uv.x * simWidth;
      const my = uv.y * simHeight; // shader expects origin at bottom-left-ish

      const pm = prevMousePx.current;
      fluidMat.uniforms.iMouse.value.set(mx, my, pm.x, pm.y);

      pm.set(mx, my);
      lastMoveTime.current = now;
    } else {
      // If no motion for a short time, zero out mouse (like your vanilla)
      if (now - lastMoveTime.current > 0.1) {
        fluidMat.uniforms.iMouse.value.set(0, 0, 0, 0);
        prevMousePx.current.set(0, 0);
      }
    }

    // --- time-correct decays (so they feel similar across FPS)
    // In vanilla this runs per frame. Here we convert to "per 60fps frame" equivalent.
    const frameFactor = delta * 60.0;
    const decay = Math.pow(config.fluidDecay, frameFactor);
    const trail = Math.pow(config.trailLength, frameFactor);
    const stop = Math.pow(config.stopDecay, frameFactor);

    fluidMat.uniforms.uBrushSize.value = config.brushSize;
    fluidMat.uniforms.uBrushStrength.value = config.brushStrength;
    fluidMat.uniforms.uFluidDecay.value = decay;
    fluidMat.uniforms.uTrailLength.value = trail;
    fluidMat.uniforms.uStopDecay.value = stop;

    displayMat.uniforms.uDistortionAmount.value = config.distortionAmount;
    displayMat.uniforms.uColorIntensity.value = config.colorIntensity;
    displayMat.uniforms.uSoftness.value = config.softness;
    (displayMat.uniforms.uColor1.value as THREE.Vector3).copy(
      hexToLinearVec3(config.color1)
    );
    (displayMat.uniforms.uColor2.value as THREE.Vector3).copy(
      hexToLinearVec3(config.color2)
    );
    (displayMat.uniforms.uColor3.value as THREE.Vector3).copy(
      hexToLinearVec3(config.color3)
    );
    (displayMat.uniforms.uColor4.value as THREE.Vector3).copy(
      hexToLinearVec3(config.color4)
    );

    // --- ping-pong render
    fluidMat.uniforms.iPreviousFrame.value = previousRT.current.texture;

    gl.setRenderTarget(currentRT.current);
    gl.clearColor(); // keep safe if you ever need clear
    gl.render(simScene, simCam);

    gl.setRenderTarget(null);

    fluidTextureRef.current = currentRT.current.texture;

    // feed door shader
    displayMat.uniforms.iFluid.value = currentRT.current.texture;

    // swap
    const tmp = currentRT.current;
    currentRT.current = previousRT.current;
    previousRT.current = tmp;

    frameRef.current++;
  });

  // Handle sim resolution change
  useEffect(() => {
    fluidMat.uniforms.iResolution.value.set(simWidth, simHeight);
    displayMat.uniforms.iResolution.value.set(simWidth, simHeight);
  }, [fluidMat, displayMat, simWidth, simHeight]);

  return { displayMat, fluidTextureRef };
}
