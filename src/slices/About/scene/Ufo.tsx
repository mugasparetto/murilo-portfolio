import React, { useRef, useMemo, useEffect, RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * UFO Abduction Beam + Character
 * ------------------------------
 * KEY FIX (this revision):
 *   The beam's "top Y" and "bottom Y" used by both the beam shader and
 *   the character material are no longer hardcoded constants. They're
 *   read from the beam mesh's *actual world transform* every frame.
 *   That means you can wrap the scene in any number of <group>s with
 *   their own offsets and the gradient direction stays correct: the
 *   reveal animation always sweeps from the actual UFO down to the
 *   actual ground, no matter where you place the scene.
 *
 *   Same fix is applied to the supporting BeamLight: it slides between
 *   the beam mesh's real top and bottom world positions instead of
 *   between two literal numbers.
 */

const MODEL_URL = "/models/human.glb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharedUniforms {
  uTime: { value: number };
  uTimeScale: { value: number };
  uSeed: { value: number };
  uIterations: { value: number };

  uColor1: { value: THREE.Vector3 };
  uColor2: { value: THREE.Vector3 };
  uColor3: { value: THREE.Vector3 };
  uColor4: { value: THREE.Vector3 };
  uColorIntensity: { value: number };
  uSoftness: { value: number };
  uGamma: { value: number };
  uGrainAmount: { value: number };

  uTopWidth: { value: number };
  uBottomWidth: { value: number };
  uReveal: { value: number };
  uEdgeSoftness: { value: number };
  uTopFade: { value: number };
  uBottomFade: { value: number };
  uFrontGlow: { value: number };

  uBodyGlow: { value: number };
  uBeamHalfW: { value: number };
  uBeamTopY: { value: number };
  uBeamBottomY: { value: number };

  // Index signature required to satisfy THREE's `{ [uniform: string]: IUniform }`
  [uniform: string]: { value: unknown };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

// Shared GLSL for the holographic field (same recurrence used by beam
// and character material so they sample the exact same pattern).
const HOLO_FIELD_GLSL: string = /* glsl */ `
  vec3 holoField(vec2 beamUV, float time, float seed, float iters, float softness,
                 vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
    vec2 uv = vec2(beamUV.x * 1.5, (beamUV.y - 0.5) * 2.5);
    float t = time;
    float d = -t * 0.5 + seed * 3.7;
    float a =  seed * 1.3;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= iters) break;
      float fi = float(i);
      a += cos(fi - d - a * uv.x);
      d += sin(uv.y * fi + a);
    }
    d += t * 0.5;
    float m1 = cos(uv.x * d) * 0.5 + 0.5;
    float m2 = cos(uv.y * a) * 0.5 + 0.5;
    float m3 = sin(d + a)    * 0.5 + 0.5;
    float s = clamp(softness * 0.1, 0.0, 0.9);
    m1 = mix(m1, 0.5, s);
    m2 = mix(m2, 0.5, s);
    m3 = mix(m3, 0.5, s);
    vec3 col = mix(c1, c2, m1);
    col = mix(col, c3, m2);
    col = mix(col, c4, m3 * 0.4);
    return col;
  }
`;

// ============================================================
// BEAM SHADERS
// ============================================================

const beamVertex: string = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragment: string = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uTimeScale;
  uniform float uSeed;
  uniform float uIterations;

  uniform vec3  uColor1;
  uniform vec3  uColor2;
  uniform vec3  uColor3;
  uniform vec3  uColor4;
  uniform float uColorIntensity;
  uniform float uSoftness;
  uniform float uGamma;
  uniform float uGrainAmount;

  uniform float uTopWidth;
  uniform float uBottomWidth;
  uniform float uReveal;
  uniform float uEdgeSoftness;
  uniform float uTopFade;
  uniform float uBottomFade;
  uniform float uFrontGlow;

  ${HOLO_FIELD_GLSL}

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    // vUv.y is 0 at the bottom of the quad, 1 at the top.
    // y01 = 0 at the UFO (top), 1 at the ground (bottom).
    float y01 = 1.0 - vUv.y;
    float x01 = vUv.x;
    float halfW = mix(uTopWidth, uBottomWidth, y01);
    float dx = (x01 - 0.5) * 2.0;
    float edgeDist = abs(dx) / max(halfW, 1e-4);
    if (edgeDist > 1.0) discard;

    vec2 beamUV = vec2(dx, y01);

    vec3 col = holoField(beamUV, uTime * uTimeScale, uSeed, uIterations,
                         uSoftness, uColor1, uColor2, uColor3, uColor4);
    col *= uColorIntensity;
    col = pow(col, vec3(uGamma));

    float grain = hash21(gl_FragCoord.xy + floor(uTime * 6.0));
    col += (grain - 0.5) * uGrainAmount;

    float edgeAlpha   = smoothstep(1.0, 1.0 - uEdgeSoftness, edgeDist);
    float topAlpha    = smoothstep(0.0, uTopFade, y01);
    float bottomAlpha = smoothstep(1.0, 1.0 - uBottomFade, y01);
    float vAlpha = topAlpha * bottomAlpha;

    float frontW = 0.08;
    float revealAlpha = smoothstep(uReveal + frontW, uReveal - frontW, y01);
    float frontBump = exp(-pow((y01 - uReveal) / frontW, 2.0)) * uFrontGlow;
    col += frontBump;

    float core = smoothstep(0.7, 0.0, edgeDist) * 0.35;
    col += core;

    float alpha = edgeAlpha * vAlpha * revealAlpha;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hexToVec3 = (hex: string): THREE.Vector3 => {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
};

// Beam mesh "local" dimensions. The mesh is BEAM_HEIGHT tall and
// BEAM_WIDTH wide, and we anchor it so its top edge is at local y=0 and
// its bottom edge is at local y=-BEAM_HEIGHT (by positioning the mesh
// at y=-BEAM_HEIGHT/2). The actual world Y of those edges is computed
// from the mesh's world matrix each frame.
const BEAM_HEIGHT = 6;
const BEAM_WIDTH = 3;
const BEAM_HALF_WIDTH = BEAM_WIDTH / 2;

// Shared uniforms object — both the beam quad and the character material
// read from this. Updated once per frame from the actual beam mesh.
function makeSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uTimeScale: { value: 0.6 },
    uSeed: { value: 0.0 },
    uIterations: { value: 7 },

    uColor1: { value: hexToVec3("#15b259") },
    uColor2: { value: hexToVec3("#caffad") },
    uColor3: { value: hexToVec3("#dd2cae") },
    uColor4: { value: hexToVec3("#0091ff") },
    uColorIntensity: { value: 2.5 },
    uSoftness: { value: 2.5 },
    uGamma: { value: 1.0 },
    uGrainAmount: { value: 0.0 },

    uTopWidth: { value: 0.18 },
    uBottomWidth: { value: 0.85 },
    uReveal: { value: 0.0 },
    uEdgeSoftness: { value: 0.55 },
    uTopFade: { value: 0.05 },
    uBottomFade: { value: 0.25 },
    uFrontGlow: { value: 1.9 },

    // Character / world-space beam mapping. These are derived from the
    // beam mesh's world transform each frame, so any group hierarchy
    // works correctly.
    uBodyGlow: { value: 1.4 },
    uBeamHalfW: { value: BEAM_HALF_WIDTH },
    uBeamTopY: { value: 0 },
    uBeamBottomY: { value: -BEAM_HEIGHT },
  };
}

// ============================================================
// BEAM
// ============================================================

interface AbductionBeamProps {
  sharedUniforms: RefObject<SharedUniforms>;
}

// AbductionBeam: exposes its mesh through a ref so the parent Scene can
// read the actual world position of the beam's top/bottom edges and
// feed those into the shared uniforms. This is what removes the
// "hardcoded world Y" bug.
const AbductionBeam = React.forwardRef<THREE.Mesh, AbductionBeamProps>(
  function AbductionBeam({ sharedUniforms }, ref) {
    return (
      <mesh ref={ref} position={[0, -BEAM_HEIGHT / 2, 0]}>
        <planeGeometry args={[BEAM_WIDTH, BEAM_HEIGHT]} />
        <shaderMaterial
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={sharedUniforms.current}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    );
  },
);

// ============================================================
// CHARACTER MATERIAL PATCH
// ============================================================

function patchMaterial(
  material: THREE.Material,
  sharedUniforms: SharedUniforms,
): void {
  (material as THREE.MeshStandardMaterial).onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
     varying vec3 vWorldPos;
     varying vec3 vWorldNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
     vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
     vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWorldPos;

         uniform float uTime;
         uniform float uTimeScale;
         uniform float uSeed;
         uniform float uIterations;
         uniform vec3  uColor1;
         uniform vec3  uColor2;
         uniform vec3  uColor3;
         uniform vec3  uColor4;
         uniform float uColorIntensity;
         uniform float uSoftness;
         uniform float uTopWidth;
         uniform float uBottomWidth;
         uniform float uReveal;
         uniform float uTopFade;
         uniform float uBottomFade;
         uniform float uFrontGlow;
         uniform float uBodyGlow;
         uniform float uBeamHalfW;
         uniform float uBeamTopY;
         uniform float uBeamBottomY;

         ${HOLO_FIELD_GLSL}
        `,
      )
      .replace(
        "#include <output_fragment>",
        `
        {
          float y01 = clamp((uBeamTopY - vWorldPos.y) / (uBeamTopY - uBeamBottomY), 0.0, 1.0);
          float halfW = mix(uTopWidth, uBottomWidth, y01) * uBeamHalfW;
          float dx = vWorldPos.x / max(halfW, 1e-4);
          float edgeDist = abs(dx);
        
          vec2 beamUV = vec2(clamp(dx, -1.0, 1.0), y01);
          vec3 holo = holoField(beamUV, uTime * uTimeScale, uSeed, uIterations,
                                uSoftness, uColor1, uColor2, uColor3, uColor4);
          holo *= uColorIntensity;
        
          float radial = smoothstep(1.2, 0.0, edgeDist);
          float topA   = smoothstep(0.0, uTopFade, y01);
          float botA   = smoothstep(1.0, 1.0 - uBottomFade, y01);
        
          float wavefrontPresence = 1.0 - smoothstep(0.98, 1.08, uReveal);
        
          float frontW  = 0.08;
          float revealA = smoothstep(uReveal + frontW, uReveal - frontW, y01);
          float frontBump = exp(-pow((y01 - uReveal) / frontW, 2.0))
                          * uFrontGlow
                          * wavefrontPresence;
        
          // --- FIX 2: light comes from above, so weight the holographic       ---
          // emission toward the top of the model. y01=0 (head) = full glow,    ---
          // y01=1 (feet) = ~30%. This stops the underside from looking lit.    ---
          float topBias = mix(1.0, 0.3, y01);
        
          float strength = radial * topA * botA * revealA * topBias;
        
          vec3 add = (holo + frontBump) * strength * uBodyGlow;
          gl_FragColor.rgb += add * (0.5 + 0.5 * diffuseColor.rgb);
        
          float rim = frontBump * radial * uBodyGlow * 0.5;
          gl_FragColor.rgb += vec3(rim);
        }
        #include <output_fragment>
        `,
      );
  };
  (material as THREE.MeshStandardMaterial).needsUpdate = true;
}

// ============================================================
// VICTIM (GLB)
// ============================================================

interface VictimProps {
  sharedUniforms: RefObject<SharedUniforms>;
  revealProgress: RefObject<number>;
}

function Victim({ sharedUniforms, revealProgress }: VictimProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) {
          mesh.material = (mesh.material as THREE.Material).clone();
          patchMaterial(
            mesh.material as THREE.Material,
            sharedUniforms.current,
          );
          mesh.castShadow = true;
        }
      }
    });
  }, [scene, sharedUniforms]);

  return (
    <primitive
      ref={groupRef}
      object={scene}
      position={[1, -2, 0]}
      scale={0.01}
      rotation={[-Math.PI / 2, 0, Math.PI / 2]}
    />
  );
}

// Real point light that tracks the wavefront. Position is now derived
// from the beam mesh's actual world top/bottom Y so any group offsets
// are respected.
interface BeamLightProps {
  revealProgress: RefObject<number>;
  beamRef: RefObject<THREE.Mesh | null>;
}

function BeamLight({ revealProgress, beamRef }: BeamLightProps) {
  const ref = useRef<THREE.PointLight>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!ref.current || !beamRef.current) return;

    const beam = beamRef.current;
    beam.updateWorldMatrix(true, false);

    const center = tmp.setFromMatrixPosition(beam.matrixWorld);
    const topY = center.y + BEAM_HEIGHT / 2;
    const bottomY = center.y - BEAM_HEIGHT / 2;

    const r = revealProgress.current ?? 0;
    // Travel only through the TOP HALF of the beam, never below the
    // model. This keeps the light source above the victim so the
    // chest/front (facing up) catches the highlight, not the back.
    const travelEnd = THREE.MathUtils.lerp(topY, bottomY, 0.45);
    const y = THREE.MathUtils.lerp(topY, travelEnd, r);
    ref.current.position.set(center.x, y, center.z);
    ref.current.intensity = 2.0 + 3.0 * r;
  });

  return <pointLight ref={ref} color="#7ef7d6" distance={7} decay={1.5} />;
}

export default function UfoScene({
  position = [800, 1000, 0],
}: {
  position?: [number, number, number];
}) {
  const sharedUniformsRef = useRef<SharedUniforms>(makeSharedUniforms());
  const revealProgress = useRef(0);
  const startTimeRef = useRef<number>(null);

  // Ref to the beam mesh so we can read its world transform.
  const beamRef = useRef<THREE.Mesh>(null);
  // Scratch vector used for matrix decomposition each frame.
  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const u = sharedUniformsRef.current;
    u.uTime.value = clock.getElapsedTime();

    if (beamRef.current) {
      beamRef.current.updateWorldMatrix(true, false);
      const center = tmpVec.setFromMatrixPosition(beamRef.current.matrixWorld);
      u.uBeamTopY.value = center.y + BEAM_HEIGHT / 2;
      u.uBeamBottomY.value = center.y - BEAM_HEIGHT / 2;
    }

    if (startTimeRef.current === null)
      startTimeRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startTimeRef.current;
    const revealDuration = 3.5;
    const tNorm = Math.min(1, elapsed / revealDuration);
    const eased =
      tNorm < 0.5
        ? 4 * tNorm * tNorm * tNorm
        : 1 - Math.pow(-2 * tNorm + 2, 3) / 2;
    revealProgress.current = eased;
    u.uReveal.value = eased;
  });

  return (
    <group position={position} scale={120}>
      <BeamLight revealProgress={revealProgress} beamRef={beamRef} />

      <AbductionBeam ref={beamRef} sharedUniforms={sharedUniformsRef} />
      <React.Suspense fallback={null}>
        <Victim
          sharedUniforms={sharedUniformsRef}
          revealProgress={revealProgress}
        />
      </React.Suspense>
    </group>
  );
}
