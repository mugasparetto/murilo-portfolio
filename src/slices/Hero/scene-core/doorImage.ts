"use client";

import { RefObject, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";

import { displayShader } from "@/app/components/fluidShader";
import type { DoorProjection } from "./doorProjection";
import { DOOR_IMAGE_RECT } from "./reflectionShader";

/**
 * The baked image's size, in texels.
 *
 * The rect it covers is 1.8 door widths by 2.5 door heights. The door is
 * twice as tall as it is wide, and the pattern stretches its uv to match, so
 * this is about 2.8 times taller than wide to keep the texels square in the
 * pattern. The reflection is blurred and mirrored, which leaves the size free
 * to be small. Against the old per-pixel version, frame-for-frame, the steps
 * and the light pool came out within 2–3/255 at the 99th percentile on both a
 * phone and a desktop viewport.
 */
const WIDTH = 128;
const HEIGHT = 360;

/**
 * The door's displayShader, laid over the rect instead of over the door: each
 * texel gets the door uv the reflection will later ask it for.
 */
const vertexShader = /* glsl */ `
uniform vec4 uDoorImageRect;
varying vec2 vUv;

void main() {
  vUv = uDoorImageRect.xy + uv * uDoorImageRect.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The uniforms a reflecting material shares — see reflectionShader.ts. */
export type DoorImage = {
  uDoorImage: THREE.IUniform<THREE.Texture>;
  uDoorImageRect: THREE.IUniform<THREE.Vector4>;
};

type Options = {
  /** the door's display material; the bake runs its shader on its uniforms */
  doorMat: THREE.ShaderMaterial;
  /** live door quad, written by <Door /> every frame */
  doorProjectionRef: RefObject<DoorProjection>;
  /** the section's visibility; see {@link useSectionOnScreenRef} */
  enabledRef?: RefObject<boolean>;
};

/**
 * Renders the door's picture into a small texture once a frame, for the
 * surfaces that reflect it: the steps and the terrain's light pool.
 *
 * It runs the door's own displayShader on the door material's own uniform
 * objects, so the clock, the fluid and the palette are the ones the door is
 * drawn with this frame. Call it after {@link useFluidMaterials} in the same
 * component. Frame callbacks run in the order they subscribe, and the bake has
 * to come after the sim has ticked the clock and swapped its field.
 */
export function useDoorImage({
  doorMat,
  doorProjectionRef,
  enabledRef,
}: Options): DoorImage {
  const { gl } = useThree();

  const target = useFBO(WIDTH, HEIGHT, {
    // the palette is lifted past 1 by `uColorIntensity`, so 8 bits would clip
    // the brightest of it
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const uniforms = useMemo<DoorImage>(
    () => ({
      uDoorImage: { value: target.texture },
      uDoorImageRect: { value: new THREE.Vector4(...DOOR_IMAGE_RECT) },
    }),
    [target],
  );

  const bake = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...doorMat.uniforms, uDoorImageRect: uniforms.uDoorImageRect },
      vertexShader,
      fragmentShader: displayShader,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return { material, geometry, scene, camera };
  }, [doorMat, uniforms]);

  useEffect(
    () => () => {
      bake.material.dispose();
      bake.geometry.dispose();
    },
    [bake],
  );

  useFrame(() => {
    if (enabledRef && !enabledRef.current) return;

    // a door this far closed reflects nothing: `doorReflectionRaw` returns
    // before it ever samples the image
    const door = doorProjectionRef.current;
    if (!door || door.strength <= 0.001) return;

    gl.setRenderTarget(target);
    gl.render(bake.scene, bake.camera);
    gl.setRenderTarget(null);
  });

  return uniforms;
}
