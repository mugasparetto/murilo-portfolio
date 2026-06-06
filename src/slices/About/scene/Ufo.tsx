import React, {
  useRef,
  useMemo,
  useEffect,
  RefObject,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

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

  [uniform: string]: { value: unknown };
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

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

const BEAM_WIDTH = 3;
const BEAM_HALF_WIDTH = BEAM_WIDTH / 2;

// Initial beam height — will be overridden dynamically each frame
const INITIAL_BEAM_HEIGHT = 6;

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

    uBodyGlow: { value: 1.4 },
    uBeamHalfW: { value: BEAM_HALF_WIDTH },
    uBeamTopY: { value: 0 },
    uBeamBottomY: { value: -INITIAL_BEAM_HEIGHT },
  };
}

// ============================================================
// BEAM — static geometry, positioned via group transform
// ============================================================

interface AbductionBeamProps {
  sharedUniforms: RefObject<SharedUniforms>;
}

// The beam mesh always spans from y=0 (top/UFO) to y=-1 (bottom/target)
// in its own local space. The parent group is scaled to the correct height
// and shifted to the correct X each frame — no geometry rebuilds needed.
const AbductionBeam = React.forwardRef<THREE.Mesh, AbductionBeamProps>(
  function AbductionBeam({ sharedUniforms }, ref) {
    return (
      // Plane spans [0..BEAM_WIDTH] × [-0.5..0.5] by default, so shift it
      // so the top edge sits at y=0 and the bottom at y=-1 after scaling.
      <mesh ref={ref} position={[0, -0.5, 0]}>
        <planeGeometry args={[BEAM_WIDTH, 1]} />
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

const Victim = React.forwardRef<THREE.Group, VictimProps>(function Victim(
  { sharedUniforms, revealProgress },
  ref,
) {
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
      ref={ref}
      object={scene}
      // Local offset so the model's feet sit at y=0 of this group.
      // Tune these values to match your GLB's pivot point.
      position={[0, 0, 0]}
      scale={0.01}
      rotation={[-Math.PI / 2, 0, Math.PI / 2]}
    />
  );
});

// ============================================================
// BEAM LIGHT
// ============================================================

interface BeamLightProps {
  revealProgress: RefObject<number>;
  beamRef: RefObject<THREE.Mesh | null>;
  // Current beam height in local space (pre-scale), updated each frame
  beamHeightRef: RefObject<number>;
}

function BeamLight({ revealProgress, beamRef, beamHeightRef }: BeamLightProps) {
  const ref = useRef<THREE.PointLight>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!ref.current || !beamRef.current) return;

    const beam = beamRef.current;
    beam.updateWorldMatrix(true, false);

    // The beam mesh sits at y=-0.5 (local), scaled by beamHeight in world
    // space. We read the world-space top/bottom from the uniforms directly
    // since they're kept up-to-date every frame in the parent useFrame.
    const center = tmp.setFromMatrixPosition(beam.matrixWorld);
    const beamHeight = beamHeightRef.current;
    const topY = center.y + beamHeight / 2;
    const bottomY = center.y - beamHeight / 2;

    const r = revealProgress.current ?? 0;
    const travelEnd = THREE.MathUtils.lerp(topY, bottomY, 0.45);
    const y = THREE.MathUtils.lerp(topY, travelEnd, r);
    ref.current.position.set(center.x, y, center.z);
    ref.current.intensity = 2.0 + 3.0 * r;
  });

  return <pointLight ref={ref} color="#7ef7d6" distance={7} decay={1.5} />;
}

// ============================================================
// UFO SCENE
// ============================================================

export interface UfoSceneHandle {
  /**
   * Start the abduction beam animation.
   * @param target  Optional world-space [x, y, z] of the abduction target.
   *                X drives horizontal beam offset; Y drives beam height.
   *                If omitted, the last known target (or the default) is used.
   */
  trigger: (target?: [number, number, number]) => void;
}

type UfoSceneProps = {
  /** World-space position of the UFO (belly = group origin). */
  position?: [number, number, number];
};

const GROUP_SCALE = 80;

export default forwardRef<UfoSceneHandle, UfoSceneProps>(function UfoScene(
  { position = [800, 1000, 0] },
  ref,
) {
  const sharedUniformsRef = useRef<SharedUniforms>(makeSharedUniforms());
  const revealProgress = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  // The target in world space. Updated via trigger().
  // Default: directly below the UFO at a reasonable distance.
  const targetRef = useRef<[number, number, number]>([
    position[0],
    position[1] - INITIAL_BEAM_HEIGHT * GROUP_SCALE,
    position[2],
  ]);

  // Refs to the beam sub-group and victim sub-group so we can reposition
  // them in useFrame without re-rendering.
  const beamGroupRef = useRef<THREE.Group>(null);
  const victimGroupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  // Current beam height in *world* space (i.e. already multiplied by GROUP_SCALE).
  // Stored as a ref so BeamLight can read it without prop drilling.
  const beamHeightWorldRef = useRef<number>(INITIAL_BEAM_HEIGHT * GROUP_SCALE);

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  // ── Public API ────────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    trigger(overrideTarget?: [number, number, number]) {
      if (overrideTarget) {
        targetRef.current = overrideTarget;
      }
      startTimeRef.current = 0;
      revealProgress.current = 0;
      sharedUniformsRef.current.uReveal.value = 0;
    },
  }));

  // ── Per-frame update ──────────────────────────────────────────────────────
  useFrame(({ clock }) => {
    const u = sharedUniformsRef.current;
    u.uTime.value = clock.getElapsedTime();

    // ── Derive local-space beam geometry from current target ──────────────
    //
    // "Local space" = the coordinate space inside the <group scale={GROUP_SCALE}>.
    // UFO belly is always at local (0, 0, 0).
    // target world → subtract group world origin → divide by scale.
    const [tx, ty] = targetRef.current;

    // How far the target is from the UFO belly, in local units
    const beamLocalX = (tx - position[0]) / GROUP_SCALE;
    const targetLocalY = (ty - position[1]) / GROUP_SCALE; // negative = below UFO

    // Height: distance from UFO belly (local y=0) down to the target.
    // Minimum of 0.5 local units to avoid a degenerate beam.
    const beamLocalHeight = Math.max(0.5, Math.abs(targetLocalY));

    // World-space height (used by BeamLight)
    beamHeightWorldRef.current = beamLocalHeight * GROUP_SCALE;

    // ── Reposition beam group (shifts beam left/right to follow target X) ──
    if (beamGroupRef.current) {
      beamGroupRef.current.position.x = beamLocalX;
      // Scale Y so the unit-height beam mesh covers the full distance.
      // The mesh itself spans y: [-0.5 .. 0.5], so scaleY = beamLocalHeight
      // places its top at y=0 and its bottom at y=-beamLocalHeight.
      beamGroupRef.current.scale.set(1, beamLocalHeight, 1);
    }

    // ── Reposition victim group to sit at the target world position ────────
    if (victimGroupRef.current) {
      victimGroupRef.current.position.set(beamLocalX, targetLocalY, 0);
    }

    // ── Update uniforms that the shaders use for world-space gradient ──────
    if (beamRef.current) {
      beamRef.current.updateWorldMatrix(true, false);
      const center = tmpVec.setFromMatrixPosition(beamRef.current.matrixWorld);
      // The beam mesh (scale applied by parent group) sits centred at center.
      // Its top edge is half the world-height above center, bottom half below.
      const halfH = beamHeightWorldRef.current / 2;
      u.uBeamTopY.value = center.y + halfH;
      u.uBeamBottomY.value = center.y - halfH;
    }

    // ── Reveal animation ──────────────────────────────────────────────────
    if (startTimeRef.current === null) return;

    // First frame after trigger() — latch the clock
    if (startTimeRef.current === 0) {
      startTimeRef.current = clock.getElapsedTime();
    }

    const elapsed = clock.getElapsedTime() - startTimeRef.current;
    const revealDuration = 0.75;
    const tNorm = Math.min(1, elapsed / revealDuration);
    const eased =
      tNorm < 0.5
        ? 4 * tNorm * tNorm * tNorm
        : 1 - Math.pow(-2 * tNorm + 2, 3) / 2;

    revealProgress.current = eased;
    u.uReveal.value = eased;
  });

  return (
    // The group origin is the UFO belly. Everything inside is in local space.
    <group position={position} scale={GROUP_SCALE}>
      <BeamLight
        revealProgress={revealProgress}
        beamRef={beamRef}
        beamHeightRef={beamHeightWorldRef}
      />

      {/*
        beamGroupRef handles:
          - position.x  → horizontal tracking of the target
          - scale.y     → stretches the unit-height beam to the correct length
        The beam mesh itself is a unit-height plane centred at y=-0.5,
        so scale.y=N makes it span from y=0 (UFO belly) to y=-N (target).
      */}
      <group ref={beamGroupRef}>
        <AbductionBeam ref={beamRef} sharedUniforms={sharedUniformsRef} />
      </group>

      {/*
        victimGroupRef tracks the target's world position in local space.
        Add any per-model position tweaks (pivot correction etc.) inside Victim.
      */}
      <group ref={victimGroupRef}>
        <React.Suspense fallback={null}>
          <Victim
            sharedUniforms={sharedUniformsRef}
            revealProgress={revealProgress}
          />
        </React.Suspense>
      </group>
    </group>
  );
});
