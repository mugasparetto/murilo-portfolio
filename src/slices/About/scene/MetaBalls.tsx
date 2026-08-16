import React, { useMemo, useRef, useImperativeHandle, forwardRef } from "react";
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

export type MetaBallsHandle = {
  setPauseTarget: (target: "top" | "bottom" | null) => void;
  setVisible: (visible: boolean) => void;
  setPauseYOffset: (offset: number) => void;
};

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
  speed?: number;
  animationSize?: number;
  ballCount?: number;
  clumpFactor?: number;
  /** Base radius of a free-floating ball, in animation-space units */
  ballRadius?: number;
  /** Extra radius handed out per-ball by its hash. 0 = every ball identical */
  ballRadiusVariance?: number;
  /** Static per-ball vertical scatter (±). 0 = every ball on the same line */
  ballSpreadY?: number;
  /**
   * Iso-surface level. 1 is the classic metaball threshold; raising it shrinks
   * each ball's effective radius and snaps the thin necks between them, which
   * is what opens up holes. Anchors are unaffected.
   */
  fieldThreshold?: number;
  /** Width of the smoothstep band at the surface, as a fraction of the
   * threshold. Larger = softer, wetter-looking edge. */
  fieldEdge?: number;
  // ── Depth / volume shading ─────────────────
  /** Flat brightness multiplier. Drop below 1 on a rear layer so it reads as
   * sitting in the shadow of the one in front. */
  shade?: number;
  /** Alpha multiplier, applied on top of the field's own coverage. */
  opacity?: number;
  /** Colour multiplier where the goo is thickest. <1 shades the core. */
  coreShade?: number;
  /** Additive highlight along the silhouette. */
  rimLight?: number;
  /** Falloff exponent for the rim. Higher = tighter band at the edge. */
  rimWidth?: number;
  /** Field overshoot mapped to "fully thick". Smaller = shading ramps up
   * faster as you move inward from the silhouette. */
  thicknessRange?: number;
  enableTransparency?: boolean;
  anchors?: AnchorBall[];
  position?: [number, number, number];
  scale?: [number, number, number];
  renderOrder?: number;
  seed?: number;
  /** When set, balls gradually migrate to the top or bottom anchor */
  pauseTarget?: "top" | "bottom" | null;
  /** Lerp speed for migration (0–1, default 0.05) */
  pauseSpeed?: number;
  pauseYOffset?: number;
  ref: React.Ref<THREE.Mesh>;
  // ── Mouse interaction ──────────────────────
  /** Hard X boundary (animation-space) balls cannot be pushed past */
  mouseMinX?: number | null;
  mouseMaxX?: number | null;
  /** Radius (in animation-space units) within which the mouse disturbs balls */
  mouseRadius?: number;
  /** How strongly balls are pushed away from the cursor (negative = attracted) */
  mouseStrength?: number;
  /** How quickly the mouse disturbance lerps in/out (0–1) */
  mouseInfluenceSpeed?: number;
  // ── Holographic overrides ──────────────────
  holoTimeScale?: number;
  /**
   * Phase offset (seconds) into the holographic pattern. Two instances sharing
   * this value render the same colours regardless of their ball-motion `seed`.
   * Defaults to `seed * 10` so each instance is coloured differently.
   */
  holoTimeOffset?: number;
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
  holoZoom?: number;
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
  const r = [p * 0.1031, p * 0.103, p * 0.0973].map(fract);
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

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

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

  uniform float uFieldThreshold;
  uniform float uFieldEdge;

  uniform float uShade;
  uniform float uOpacity;
  uniform float uCoreShade;
  uniform float uRimLight;
  uniform float uRimWidth;
  uniform float uThicknessRange;

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

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float mb(vec2 c, float r, vec2 p) {
    vec2 d = p - c;
    return (r * r) / dot(d, d);
  }

  float mb_anchor(vec2 c, float r, float roundness, float strength, float yScale, vec2 p) {
    vec2 d = p - c;
    d.y /= max(yScale, 0.01);
    float k = (r * r) / dot(d, d);
    // Scaled by the threshold so anchors keep their silhouette when the
    // threshold is raised to open gaps between the free-floating balls.
    return strength * pow(k, 1.0 / max(roundness, 0.01)) * uFieldThreshold;
  }

  void main() {
    vec2 fragCoord = vUv * uResolution;
    float mr = min(uResolution.x, uResolution.y);
    vec2 uv = (fragCoord * 2.0 - uResolution.xy) / mr;
    uv /= uZoom;

    float t = uTime * uTimeScale;

    float d = -t * 0.5 + uSeed * 3.7;
    float a =  uSeed * 1.3;

    for (int i = 0; i < 16; i++) {
      if (float(i) >= uIterations) break;
      float fi = float(i);
      a += cos(fi - d - a * uv.x);
      d += sin(uv.y * fi + a);
    }
    d += t * 0.5;

    float m1 = cos(uv.x * d) * 0.5 + 0.5;
    float m2 = cos(uv.y * a) * 0.5 + 0.5;
    float m3 = sin(d + a)    * 0.5 + 0.5;

    float s = clamp(uSoftness * 0.1, 0.0, 0.9);
    m1 = mix(m1, 0.5, s);
    m2 = mix(m2, 0.5, s);
    m3 = mix(m3, 0.5, s);

    vec3 col = mix(uColor1, uColor2, m1);
    col = mix(col, uColor3, m2);
    col = mix(col, uColor4, m3 * 0.4);

    col *= uColorIntensity;
    col = pow(col, vec3(uGamma));

    float grain = hash21(gl_FragCoord.xy + floor(uTime * 6.0));
    col += (grain - 0.5) * uGrainAmount;

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

    float edgeHi = uFieldThreshold * (1.0 + uFieldEdge);
    float fAll     = smoothstep(uFieldThreshold, edgeHi, mbField);
    float fVisible = smoothstep(uFieldThreshold, edgeHi, mbVisibleField);

    col *= 0.85 + 0.15 * fAll;

    // ── Volume shading ─────────────────────────────────────────────────
    // How far the field overshoots the iso-surface stands in for how thick
    // the goo is at this pixel: 0 right at the silhouette, 1 deep inside a
    // blob. Without this the field is a flat sticker.
    float thickness = clamp(
      (mbVisibleField - uFieldThreshold) / max(uThicknessRange, 0.001),
      0.0, 1.0
    );

    // Thick core falls into shadow, thin edges stay bright — the same cue
    // that makes a soap bubble or a blob of honey read as rounded.
    col *= mix(1.0, uCoreShade, thickness);

    // Wet highlight hugging the silhouette.
    col += uRimLight * pow(1.0 - thickness, max(uRimWidth, 0.001));

    // Flat multiplier separating stacked layers front-to-back.
    col *= uShade;

    float alpha = enableTransparency > 0.5 ? fVisible : 1.0;
    gl_FragColor = vec4(col, alpha * fVisible * uOpacity);
  }
`;

// ─────────────────────────────────────────────
//  Inner mesh
// ─────────────────────────────────────────────

const MAX_ANCHORS = 16;

type SceneProps = Required<
  Omit<HolographicMetaBallsProps, "position" | "scale" | "ref">
> & {
  position: [number, number, number];
  scale: [number, number, number];
  renderOrder?: number;
  seed: number;
};

const HolographicMetaBallsMesh = forwardRef<MetaBallsHandle, SceneProps>(
  function HolographicMetaBallsMesh(props, ref) {
    const pauseTargetRef = useRef<"top" | "bottom" | null>(props.pauseTarget);
    const pauseYOffsetRef = useRef<number>(props.pauseYOffset);

    useImperativeHandle(ref, () => ({
      setPauseTarget: (target) => {
        pauseTargetRef.current = target;
      },
      setVisible: (visible) => {
        if (meshRef.current) meshRef.current.visible = visible;
      },
      setPauseYOffset: (offset) => {
        pauseYOffsetRef.current = offset;
      },
    }));

    const metaBalls = useMemo(
      () => Array.from({ length: 50 }, () => new THREE.Vector3()),
      [],
    );

    const ballParams = useMemo(() => {
      return Array.from({ length: props.ballCount }, (_, i) => {
        const h = hash31(i + 1 + props.seed * 100.0);
        // Second sample so the static scatter doesn't correlate with size/phase
        const g = hash31(i + 501 + props.seed * 100.0);
        return {
          st: h[0] * Math.PI * 2,
          speed: 0.5 + h[1],
          amp: 4 + h[2] * 4,
          radius: props.ballRadius + h[1] * props.ballRadiusVariance,
          yOffset: (g[0] * 2 - 1) * props.ballSpreadY,
        };
      });
    }, [
      props.ballCount,
      props.seed,
      props.ballRadius,
      props.ballRadiusVariance,
      props.ballSpreadY,
    ]);

    // Tracked positions for lerping — initialised lazily on first frame
    const ballPositions = useRef<{ x: number; y: number }[] | null>(null);

    // Per-ball mouse-disturbance offsets (lerped independently)
    const mouseOffsets = useRef<{ x: number; y: number }[]>(
      Array.from({ length: 50 }, () => ({ x: 0, y: 0 })),
    );

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
    const anchorYScale = useMemo(
      () => new Float32Array(MAX_ANCHORS).fill(1),
      [],
    );
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
        uFieldThreshold: { value: props.fieldThreshold },
        uFieldEdge: { value: props.fieldEdge },
        uShade: { value: props.shade },
        uOpacity: { value: props.opacity },
        uCoreShade: { value: props.coreShade },
        uRimLight: { value: props.rimLight },
        uRimWidth: { value: props.rimWidth },
        uThicknessRange: { value: props.thicknessRange },
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

    // Ref to the mesh so we can read its world position for coordinate mapping
    const meshRef = useRef<THREE.Mesh>(null);

    // ── Animation ────────────────────────────────
    useFrame(({ clock, size, pointer, camera: frameCamera }) => {
      // Ball motion is offset by `seed`; the holographic fill has its own phase
      // so instances can move independently but still share a colour.
      const t = clock.getElapsedTime() + props.seed * 10.0;
      uniforms.uTime.value = clock.getElapsedTime() + props.holoTimeOffset;
      uniforms.uResolution.value.set(size.width, size.height);

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
      uniforms.uFieldThreshold.value = props.fieldThreshold;
      uniforms.uFieldEdge.value = props.fieldEdge;
      uniforms.uShade.value = props.shade;
      uniforms.uOpacity.value = props.opacity;
      uniforms.uCoreShade.value = props.coreShade;
      uniforms.uRimLight.value = props.rimLight;
      uniforms.uRimWidth.value = props.rimWidth;
      uniforms.uThicknessRange.value = props.thicknessRange;

      const anchors = props.anchors;
      const topAnchor = anchors[0] ?? { x: 0, y: 37.5 };
      const bottomAnchor = anchors[1] ?? { x: 0, y: -37.5 };

      const target =
        pauseTargetRef.current === "top"
          ? topAnchor
          : pauseTargetRef.current === "bottom"
            ? bottomAnchor
            : null;

      const lerpSpeed = props.pauseSpeed;
      const count = props.ballCount;

      // Lazy-init tracked positions to current natural positions
      if (!ballPositions.current) {
        ballPositions.current = Array.from({ length: count }, (_, i) => {
          const p = ballParams[i];
          const laneT = count > 1 ? i / (count - 1) : 0.5;
          return {
            x: (laneT * 2 - 1) * props.animationSize * 0.4 * props.clumpFactor,
            y:
              topAnchor.y * 1.3 +
              p.yOffset +
              Math.sin(t * props.speed * p.speed + p.st) *
                p.amp *
                props.clumpFactor,
          };
        });
      }

      const mouseRadius = props.mouseRadius;
      const mouseStrength = props.mouseStrength;
      const mouseInfluenceSpeed = props.mouseInfluenceSpeed;

      // Unproject the NDC pointer through the camera onto the mesh's Z plane,
      // then convert to animation-space by subtracting the mesh world position
      // and dividing by its scale (which maps 1 world unit → 1/scale animation unit).
      let mouse: { x: number; y: number } | null = null;
      if (meshRef.current) {
        const meshWorldPos = new THREE.Vector3();
        meshRef.current.getWorldPosition(meshWorldPos);

        // Ray from camera through the NDC pointer position
        const ray = new THREE.Ray();
        const ndcPoint = new THREE.Vector3(pointer.x, pointer.y, 0.5);
        ndcPoint.unproject(frameCamera);
        ray.origin.copy(frameCamera.position);
        ray.direction.subVectors(ndcPoint, frameCamera.position).normalize();

        // Intersect with the Z=meshWorldPos.z plane
        const planeZ = meshWorldPos.z;
        const t_intersect = (planeZ - ray.origin.z) / ray.direction.z;
        if (t_intersect > 0) {
          const worldX = ray.origin.x + ray.direction.x * t_intersect;
          const worldY = ray.origin.y + ray.direction.y * t_intersect;

          // Convert world coords → animation-space:
          // The mesh is a unit plane scaled by props.scale, so
          // animationSize world-units span props.scale[0] world-units → scale factor
          const worldUnitsPerAnimUnit = props.scale[0] / props.animationSize;
          mouse = {
            x: (worldX - meshWorldPos.x) / worldUnitsPerAnimUnit,
            y: (worldY - meshWorldPos.y) / worldUnitsPerAnimUnit,
          };
        }
      }

      for (let i = 0; i < count; i++) {
        const p = ballParams[i];
        const laneT = count > 1 ? i / (count - 1) : 0.5;

        // Natural (free-floating) position
        const naturalX =
          (laneT * 2 - 1) * props.animationSize * 0.4 * props.clumpFactor;
        const naturalY =
          topAnchor.y * 1.3 +
          p.yOffset +
          Math.sin(t * props.speed * p.speed + p.st) *
            p.amp *
            props.clumpFactor;

        let targetY = 0;

        if (target) {
          targetY =
            pauseTargetRef.current === "top"
              ? target.y + pauseYOffsetRef.current
              : target.y - pauseYOffsetRef.current;
        }

        const destX = target ? target.x : naturalX;
        const destY = target ? targetY : naturalY;

        ballPositions.current[i].x = THREE.MathUtils.lerp(
          ballPositions.current[i].x,
          destX,
          lerpSpeed,
        );
        ballPositions.current[i].y = THREE.MathUtils.lerp(
          ballPositions.current[i].y,
          destY,
          lerpSpeed,
        );

        // ── Mouse disturbance ──────────────────────
        // Compute desired offset based on current mouse position
        let wantOffX = 0;
        let wantOffY = 0;

        if (mouse && !target) {
          const bx = ballPositions.current[i].x;
          const by = ballPositions.current[i].y;
          const dx = bx - mouse.x;
          const dy = by - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < mouseRadius && dist > 0.001) {
            // Falloff: strongest at centre, zero at mouseRadius
            const falloff = 1.0 - dist / mouseRadius;
            const force = mouseStrength * falloff * falloff;
            // Normalised direction away from mouse (repel) or toward (attract)
            wantOffX = (dx / dist) * force;
            wantOffY = (dy / dist) * force;
          }
        }

        // Lerp the offset toward the desired value (snappy in, gentle decay out)
        const offRef = mouseOffsets.current[i];
        const lerpIn = mouse ? mouseInfluenceSpeed : mouseInfluenceSpeed * 0.3;
        offRef.x = THREE.MathUtils.lerp(offRef.x, wantOffX, lerpIn);
        offRef.y = THREE.MathUtils.lerp(offRef.y, wantOffY, lerpIn);

        // ── Invisible walls: clamp X within [mouseMinX, mouseMaxX] ───────────
        let finalX = ballPositions.current[i].x + offRef.x;
        const finalY = ballPositions.current[i].y + offRef.y;

        if (props.mouseMinX !== null && finalX < props.mouseMinX) {
          finalX = props.mouseMinX;
          offRef.x = finalX - ballPositions.current[i].x;
        } else if (props.mouseMaxX !== null && finalX > props.mouseMaxX) {
          finalX = props.mouseMaxX;
          offRef.x = finalX - ballPositions.current[i].x;
        }

        metaBalls[i].set(finalX, finalY, p.radius);
      }
    });

    return (
      <mesh
        position={props.position}
        scale={props.scale}
        renderOrder={props.renderOrder ?? 1}
        ref={meshRef}
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
  },
);

// ─────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────

const HolographicMetaBalls = forwardRef<
  MetaBallsHandle,
  HolographicMetaBallsProps
>(function HolographicMetaBalls(
  {
    speed = 0.5,
    animationSize = 50,
    ballCount = 20,
    clumpFactor = 0.8,
    ballRadius = 0.8,
    ballRadiusVariance = 1.2,
    ballSpreadY = 0,
    fieldThreshold = 1.0,
    fieldEdge = 0.02,
    shade = 1,
    opacity = 1,
    coreShade = 1,
    rimLight = 0,
    rimWidth = 2,
    thicknessRange = 1.5,
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
    pauseTarget = null,
    pauseSpeed = 0.2,
    pauseYOffset = 5,
    mouseRadius = 8,
    mouseStrength = 12,
    mouseInfluenceSpeed = 0.12,
    mouseMinX = null,
    mouseMaxX = null,
    holoTimeScale = HOLO.timeScale,
    holoTimeOffset = seed * 10,
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
  },
  ref,
) {
  return (
    <HolographicMetaBallsMesh
      speed={speed}
      animationSize={animationSize}
      ballCount={ballCount}
      clumpFactor={clumpFactor}
      ballRadius={ballRadius}
      ballRadiusVariance={ballRadiusVariance}
      ballSpreadY={ballSpreadY}
      fieldThreshold={fieldThreshold}
      fieldEdge={fieldEdge}
      shade={shade}
      opacity={opacity}
      coreShade={coreShade}
      rimLight={rimLight}
      rimWidth={rimWidth}
      thicknessRange={thicknessRange}
      enableTransparency={enableTransparency}
      anchors={anchors}
      position={position}
      scale={scale}
      renderOrder={renderOrder}
      seed={seed}
      pauseTarget={pauseTarget}
      pauseSpeed={pauseSpeed}
      pauseYOffset={pauseYOffset}
      ref={ref}
      mouseRadius={mouseRadius}
      mouseStrength={mouseStrength}
      mouseInfluenceSpeed={mouseInfluenceSpeed}
      mouseMinX={mouseMinX}
      mouseMaxX={mouseMaxX}
      holoTimeScale={holoTimeScale}
      holoTimeOffset={holoTimeOffset}
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
});

export default HolographicMetaBalls;
export type { HolographicMetaBallsProps };
