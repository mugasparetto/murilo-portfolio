"use client";

import * as THREE from "three";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";

import { SMOOTH_NORMAL, bakeSmoothNormals } from "@/app/helpers/smoothNormals";

/**
 * Inverted hull: draw the parent's geometry a second time with back faces only,
 * pushed outwards by a fixed number of pixels. Everything the hull covers is
 * behind the fill and gets rejected by the depth test, so all that survives is a
 * hard-edged rim around the silhouette — no blur, no edge detection, no extra
 * scene pass. Just one draw call sharing the parent's geometry.
 *
 * The offset happens in clip space and is scaled by w, so it survives the
 * perspective divide: the rim stays exactly `thickness` pixels wide whether the
 * model is near or far.
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  uniform float thickness;
  uniform vec2 resolution;

  attribute vec3 ${SMOOTH_NORMAL};

  void main() {
    vec3 objectNormal = ${SMOOTH_NORMAL};

    #include <begin_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>

    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );
    vec4 clipNormal = projectionMatrix * vec4( normalMatrix * objectNormal, 0.0 );

    float normalLength = length( clipNormal.xy );
    vec2 direction = normalLength > 1e-6 ? clipNormal.xy / normalLength : vec2( 0.0 );

    // 2.0 / resolution is one device pixel in NDC
    clipPosition.xy += direction * thickness * 2.0 / resolution * clipPosition.w;

    gl_Position = clipPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;

  void main() {
    gl_FragColor = vec4( color, opacity );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Look = {
  color: THREE.ColorRepresentation;
  thickness: number;
  opacity: number;
};

/**
 * One material per distinct look, shared by every outlined mesh. This is the
 * whole point of the component: 68 outlines that look the same compile a single
 * shader program instead of 68 of them (three keys its program cache per
 * material, and skinned/non-skinned meshes each get their own variant of it).
 */
const materials = new Map<string, THREE.ShaderMaterial>();

function getOutlineMaterial({ color, thickness, opacity }: Look) {
  const value = new THREE.Color(color);
  const key = `${value.getHexString()}|${thickness}|${opacity}`;

  let material = materials.get(key);

  if (!material) {
    material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: opacity < 1,
      uniforms: {
        color: { value },
        opacity: { value: opacity },
        thickness: { value: thickness },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
    });

    materials.set(key, material);
  }

  return material;
}

type Props = {
  color?: THREE.ColorRepresentation;
  /** rim width in device pixels — constant at any distance */
  thickness?: number;
  opacity?: number;
  renderOrder?: number;
};

/**
 * Drop-in replacement for drei's <Outlines>: render it as a child of the mesh
 * you want outlined.
 */
export default function HullOutline({
  color = "white",
  thickness = 1.5,
  opacity = 1,
  renderOrder = 10,
}: Props) {
  const ref = useRef<THREE.Group>(null);

  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);

  const material = useMemo(
    () => getOutlineMaterial({ color, thickness, opacity }),
    [color, thickness, opacity],
  );

  useLayoutEffect(() => {
    material.uniforms.resolution.value.set(width * dpr, height * dpr);
  }, [material, width, height, dpr]);

  useLayoutEffect(() => {
    const group = ref.current;
    const parent = group?.parent as THREE.Mesh | null | undefined;

    if (!group || !parent?.geometry) return;

    bakeSmoothNormals(parent.geometry);

    let hull: THREE.Mesh;

    if ((parent as THREE.SkinnedMesh).isSkinnedMesh) {
      const source = parent as THREE.SkinnedMesh;
      const skinned = new THREE.SkinnedMesh(source.geometry, material);

      // same skeleton and bind matrix as the parent, and — since the hull is a
      // child of it — the same world matrix, so it deforms identically
      skinned.bind(source.skeleton, source.bindMatrix);
      hull = skinned;
    } else {
      hull = new THREE.Mesh(parent.geometry, material);
    }

    // drawn after the fill so the fill's depth is already there to clip it
    hull.renderOrder = renderOrder;

    // R3F raycasts the entire subtree of any object that has pointer handlers,
    // so without this the hull would double the cost of every pointer move over
    // the model — and, being BackSide, answer with the far side of the mesh.
    hull.raycast = () => {};

    group.add(hull);

    return () => {
      group.remove(hull);
    };
  }, [material, renderOrder]);

  return <group ref={ref} />;
}
