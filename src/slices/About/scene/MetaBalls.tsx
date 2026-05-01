import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ─────────────────────────────────────────────
//  HOLOGRAPHIC FILL PARAMETERS
// ─────────────────────────────────────────────

const HOLO = {
  timeScale: 0.1,
  seed: 0.0,
  iterations: 7,
  color1: "#15b259",
  color2: "#caffad",
  color3: "#dd2cae",
  color4: "#0091ff",
  colorIntensity: 2,
  softness: 2.0,
  gamma: 1.0,
  grainAmount: 0.0,
  zoom: 0.5,
} as const;

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────

export type AnchorBall = {
  x: number;
  y: number;
  radius: number;
  roundness?: number;
  strength?: number;
  yScale?: number;
  visible?: boolean;
};

type HolographicMetaBallsProps = {
  /** Overall animation speed multiplier */
  speed?: number;
  /** World-space size of the metaball field */
  animationSize?: number;
  /** Number of floating metaballs */
  ballCount?: number;
  /** How tightly balls cluster (0–1) */
  clumpFactor?: number;
  /** Render with transparency outside the metaball shape */
  enableTransparency?: boolean;
  /** Fixed anchor blobs (e.g. top/bottom caps) */
  anchors?: AnchorBall[];
  position?: [number, number, number];
  scale?: [number, number, number];
  renderOrder?: number;
  seed?: number;
  // ── Holographic overrides ──────────────────
  holoTimeScale?: number;
  holoSeed?: number;
  holoIterations?: number;
  holoColor1?: string;
  holoColor2?: string;
  holoColor3?: string;
  holoColor4?: string;
  holoColorIntensity?: number;
  holoSoftness?: number;
  holoGamma?: number;
  holoGrainAmount?: number;
  holoZoom?: number; // default 1.0 — smaller = zoomed in, larger = zoomed out
};

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

function fract(x: number) {
  return x - Math.floor(x);
}

function hash31(p: number): number[] {
  let r = [p * 0.1031, p * 0.103, p * 0.0973].map(fract);
  const dot =
    r[0] * (r[1] + 33.33) + r[1] * (r[2] + 33.33) + r[2] * (r[0] + 33.33);
  return r.map((v) => fract(v + dot));
}

// ─────────────────────────────────────────────
//  Shaders
// ─────────────────────────────────────────────

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Fragment shader — holographic fill + metaball alpha mask.
 *
 * Fill: the mutual-feedback phase accumulator from HolographicPlane.
 *   a += cos(i - d - a * uv.x);
 *   d += sin(uv.y * i + a);
 * This builds organic curved lens shapes whose level sets drive four-color mixing.
 *
 * Mask: classic metaball r²/d² kernel summed over all balls + anchor blobs,
 * thresholded with smoothstep(1.0, 1.02, field) to get a smooth silhouette.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  // ── Holographic fill uniforms ──────────────
  uniform float uTime;
  uniform vec2  uResolution;
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
  uniform float uZoom;

  // ── Metaball uniforms ──────────────────────
  uniform float iAnimationSize;
  uniform float iBallCount;
  uniform vec3  iMetaBalls[50];
  uniform float enableTransparency;
  uniform float iAnchorCount;
  uniform vec3  iAnchors[16];
  uniform float iAnchorRoundness[16];
  uniform float iAnchorStrength[16];
  uniform float iAnchorYScale[16];
  uniform float iAnchorVisible[16];

  // ── Grain hash ─────────────────────────────
  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  // ── Metaball kernels ───────────────────────
  float mb(vec2 c, float r, vec2 p) {
    vec2 d = p - c;
    return (r * r) / dot(d, d);
  }

  float mb_anchor(vec2 c, float r, float roundness, float strength, float yScale, vec2 p) {
    vec2 d = p - c;
    d.y /= max(yScale, 0.01);
    float k = (r * r) / dot(d, d);
    return strength * pow(k, 1.0 / max(roundness, 0.01));
  }

  void main() {
    // ── 1. Holographic fill ────────────────────
    // Aspect-correct UV matching HolographicPlane convention:
    //   uv = (fragCoord * 2 - res) / min(res.x, res.y)
    vec2 fragCoord = vUv * uResolution;
    float mr = min(uResolution.x, uResolution.y);
    vec2 uv = (fragCoord * 2.0 - uResolution.xy) / mr;
    uv /= uZoom;

    float t = uTime * uTimeScale;

    // Mutually-recurrent phase accumulators
    float d = -t * 0.5 + uSeed * 3.7;
    float a =  uSeed * 1.3;

    for (int i = 0; i < 16; i++) {
      if (float(i) >= uIterations) break;
      float fi = float(i);
      a += cos(fi - d - a * uv.x);
      d += sin(uv.y * fi + a);
    }
    d += t * 0.5;

    // Three independent mixers in [0,1]
    float m1 = cos(uv.x * d) * 0.5 + 0.5;
    float m2 = cos(uv.y * a) * 0.5 + 0.5;
    float m3 = sin(d + a)    * 0.5 + 0.5;

    // Softness pulls mixers toward 0.5 for gentler blends
    float s = clamp(uSoftness * 0.1, 0.0, 0.9);
    m1 = mix(m1, 0.5, s);
    m2 = mix(m2, 0.5, s);
    m3 = mix(m3, 0.5, s);

    // Chained four-color blend
    vec3 col = mix(uColor1, uColor2, m1);
    col = mix(col, uColor3, m2);
    col = mix(col, uColor4, m3 * 0.4);

    col *= uColorIntensity;
    col = pow(col, vec3(uGamma));

    // Animated film grain
    float grain = hash21(gl_FragCoord.xy + floor(uTime * 6.0));
    col += (grain - 0.5) * uGrainAmount;

    // ── 2. Metaball alpha mask ─────────────────
    vec2 coord = (vUv - 0.5) * iAnimationSize;

    float mbField        = 0.0;
    float mbVisibleField = 0.0;

    for (int i = 0; i < 50; i++) {
      if (float(i) >= iBallCount) break;
      float k = mb(iMetaBalls[i].xy, iMetaBalls[i].z, coord);
      mbField        += k;
      mbVisibleField += k;
    }

    for (int i = 0; i < 16; i++) {
      if (float(i) >= iAnchorCount) break;
      float k = mb_anchor(
        iAnchors[i].xy, iAnchors[i].z,
        iAnchorRoundness[i], iAnchorStrength[i], iAnchorYScale[i],
        coord
      );
      mbField += k;
      if (iAnchorVisible[i] > 0.5) mbVisibleField += k;
    }

    float fAll     = smoothstep(1.0, 1.02, mbField);
    float fVisible = smoothstep(1.0, 1.02, mbVisibleField);

    // Subtle depth shading from field shape
    col *= 0.85 + 0.15 * fAll;

    float alpha = enableTransparency > 0.5 ? fVisible : 1.0;
    gl_FragColor = vec4(col, alpha * fVisible);
  }
`;

// ─────────────────────────────────────────────
//  Inner mesh
// ─────────────────────────────────────────────

const MAX_ANCHORS = 16;

type SceneProps = Required<
  Omit<HolographicMetaBallsProps, "position" | "scale">
> & {
  position: [number, number, number];
  scale: [number, number, number];
  renderOrder?: number;
  seed: number;
};

function HolographicMetaBallsMesh(props: SceneProps) {
  const metaBalls = useMemo(
    () => Array.from({ length: 50 }, () => new THREE.Vector3()),
    [],
  );

  const ballParams = useMemo(() => {
    return Array.from({ length: props.ballCount }, (_, i) => {
      const h = hash31(i + 1 + props.seed * 100.0);
      return {
        st: h[0] * Math.PI * 2,
        speed: 0.5 + h[1],
        amp: 4 + h[2] * 4,
        radius: 0.8 + h[1] * 1.2,
      };
    });
  }, [props.ballCount, props.seed]);

  // ── Anchor arrays ────────────────────────────
  const anchorPositions = useMemo(
    () => Array.from({ length: MAX_ANCHORS }, () => new THREE.Vector3()),
    [],
  );
  const anchorRoundness = useMemo(
    () => new Float32Array(MAX_ANCHORS).fill(1),
    [],
  );
  const anchorStrength = useMemo(
    () => new Float32Array(MAX_ANCHORS).fill(1),
    [],
  );
  const anchorYScale = useMemo(() => new Float32Array(MAX_ANCHORS).fill(1), []);
  const anchorVisible = useMemo(
    () => new Float32Array(MAX_ANCHORS).fill(1),
    [],
  );

  useMemo(() => {
    const list = props.anchors.slice(0, MAX_ANCHORS);
    list.forEach((a, i) => {
      anchorPositions[i].set(a.x, a.y, a.radius);
      anchorRoundness[i] = a.roundness ?? 1.0;
      anchorStrength[i] = a.strength ?? 1.0;
      anchorYScale[i] = a.yScale ?? 1.0;
      anchorVisible[i] = (a.visible ?? true) ? 1.0 : 0.0;
    });
    for (let i = list.length; i < MAX_ANCHORS; i++) {
      anchorPositions[i].set(0, 0, 0);
      anchorRoundness[i] = 1;
      anchorStrength[i] = 1;
      anchorYScale[i] = 1;
      anchorVisible[i] = 1;
    }
  }, [props.anchors]);

  // ── Uniforms ─────────────────────────────────
  const uniforms = useMemo(
    () => ({
      // Holographic fill
      uTime: { value: 0 },
      uResolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
      uTimeScale: { value: props.holoTimeScale },
      uSeed: { value: props.holoSeed },
      uIterations: { value: props.holoIterations },
      uColor1: { value: hexToVec3(props.holoColor1) },
      uColor2: { value: hexToVec3(props.holoColor2) },
      uColor3: { value: hexToVec3(props.holoColor3) },
      uColor4: { value: hexToVec3(props.holoColor4) },
      uColorIntensity: { value: props.holoColorIntensity },
      uSoftness: { value: props.holoSoftness },
      uGamma: { value: props.holoGamma },
      uGrainAmount: { value: props.holoGrainAmount },
      uZoom: { value: props.holoZoom ?? 1.0 },
      // Metaballs
      iAnimationSize: { value: props.animationSize },
      iBallCount: { value: props.ballCount },
      iMetaBalls: { value: metaBalls },
      enableTransparency: { value: props.enableTransparency ? 1.0 : 0.0 },
      iAnchorCount: { value: Math.min(props.anchors.length, MAX_ANCHORS) },
      iAnchors: { value: anchorPositions },
      iAnchorRoundness: { value: anchorRoundness },
      iAnchorStrength: { value: anchorStrength },
      iAnchorYScale: { value: anchorYScale },
      iAnchorVisible: { value: anchorVisible },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const uniformsRef = useRef(uniforms);
  useMemo(() => {
    uniformsRef.current.iAnchorCount.value = Math.min(
      props.anchors.length,
      MAX_ANCHORS,
    );
  }, [props.anchors]);

  // ── Animation ────────────────────────────────
  useFrame(({ clock, size }) => {
    const t = clock.getElapsedTime() + props.seed * 10.0;
    uniforms.uTime.value = t;
    uniforms.uResolution.value.set(size.width, size.height);

    // Live holo uniform sync (supports runtime prop changes)
    uniforms.uTimeScale.value = props.holoTimeScale;
    uniforms.uSeed.value = props.holoSeed;
    uniforms.uIterations.value = props.holoIterations;
    uniforms.uColor1.value.copy(hexToVec3(props.holoColor1));
    uniforms.uColor2.value.copy(hexToVec3(props.holoColor2));
    uniforms.uColor3.value.copy(hexToVec3(props.holoColor3));
    uniforms.uColor4.value.copy(hexToVec3(props.holoColor4));
    uniforms.uColorIntensity.value = props.holoColorIntensity;
    uniforms.uSoftness.value = props.holoSoftness;
    uniforms.uGamma.value = props.holoGamma;
    uniforms.uGrainAmount.value = props.holoGrainAmount;
    uniforms.uZoom.value = props.holoZoom;

    // Animate metaballs
    const anchors = props.anchors;
    const a = anchors[0] ?? { x: 0, y: 37.5 };
    const count = props.ballCount;
    for (let i = 0; i < count; i++) {
      const p = ballParams[i];
      const laneT = count > 1 ? i / (count - 1) : 0.5;
      const x = (laneT * 2 - 1) * props.animationSize * 0.4 * props.clumpFactor;
      const y =
        a.y * 1.3 +
        Math.sin(t * props.speed * p.speed + p.st) * p.amp * props.clumpFactor;
      metaBalls[i].set(x, y, p.radius);
    }
  });

  return (
    <mesh
      position={props.position}
      scale={props.scale}
      renderOrder={props.renderOrder ?? 1}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        fragmentShader={fragmentShader}
        vertexShader={vertexShader}
        uniforms={uniforms}
        transparent={props.enableTransparency}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────

const HolographicMetaBalls: React.FC<HolographicMetaBallsProps> = ({
  speed = 0.5,
  animationSize = 50,
  ballCount = 20,
  clumpFactor = 0.8,
  enableTransparency = false,
  anchors = [
    {
      x: 0,
      y: 37.5,
      radius: 20,
      roundness: 1,
      strength: 1,
      yScale: 1,
      visible: true,
    },
    {
      x: 0,
      y: -37.5,
      radius: 20,
      roundness: 1,
      strength: 1,
      yScale: 1,
      visible: true,
    },
  ],
  position = [0, 0, 0],
  scale = [1, 1, 1],
  renderOrder = 1,
  seed = 0,
  // Holographic fill defaults (match HOLO const above)
  holoTimeScale = HOLO.timeScale,
  holoSeed = HOLO.seed,
  holoIterations = HOLO.iterations,
  holoColor1 = HOLO.color1,
  holoColor2 = HOLO.color2,
  holoColor3 = HOLO.color3,
  holoColor4 = HOLO.color4,
  holoColorIntensity = HOLO.colorIntensity,
  holoSoftness = HOLO.softness,
  holoGamma = HOLO.gamma,
  holoGrainAmount = HOLO.grainAmount,
  holoZoom = HOLO.zoom,
}) => (
  <HolographicMetaBallsMesh
    speed={speed}
    animationSize={animationSize}
    ballCount={ballCount}
    clumpFactor={clumpFactor}
    enableTransparency={enableTransparency}
    anchors={anchors}
    position={position}
    scale={scale}
    renderOrder={renderOrder}
    seed={seed}
    holoTimeScale={holoTimeScale}
    holoSeed={holoSeed}
    holoIterations={holoIterations}
    holoColor1={holoColor1}
    holoColor2={holoColor2}
    holoColor3={holoColor3}
    holoColor4={holoColor4}
    holoColorIntensity={holoColorIntensity}
    holoSoftness={holoSoftness}
    holoGamma={holoGamma}
    holoGrainAmount={holoGrainAmount}
    holoZoom={holoZoom}
  />
);

export default HolographicMetaBalls;
export type { HolographicMetaBallsProps };
