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

/**
 * Clips the field to an *outline* borrowed from one or two textures' alpha, so
 * the goo can never be seen outside the shape it is supposed to live in. The
 * plane the field renders on is almost always bigger than that shape — it has
 * to be, or the strands would be cut off before they finished — so without a
 * mask the outermost balls run off the sides and over the top.
 *
 * The mask is an outline, not a stencil of the pieces: everything inside it is
 * kept, including any gap *between* the pieces. That is the whole point when
 * the goo's job is to hang in that gap.
 *
 * `position` / `scale` describe where the mask textures sit relative to this
 * component's own `position` / `scale`; both are read in the same units, and
 * both planes are assumed to be axis-aligned siblings.
 */
export type FieldMask = {
  /** The outline, as texture alpha. */
  texture: THREE.Texture;
  /** Centre of the mask texture's plane, in the same space as `position`. */
  position: [number, number];
  /** Size of the mask texture's plane, in the same space as `scale`. */
  scale: [number, number];
  /**
   * Lowest UV row of the texture the mask will read. At and below it the mask
   * holds that row's width instead of following the alpha further down, which
   * is the whole trick: the shape can stop there — because the texture only
   * covers its top piece, or because there is a gap to the next one — without
   * punching a hole through the field hanging below.
   *
   * Set it just inside the bottom edge of the piece, with room to spare; the
   * outline barely changes over the last few rows, and reading past the edge
   * into empty alpha is what would cut the field off.
   */
  floor?: number;
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
   * Vertical stretch of each ball's *field* (not its radius). 1 = a round bead.
   * Above ~2 the field reaches much further along Y than X, so a ball fuses
   * with whatever is above and below it while staying thin sideways — which is
   * what turns a row of beads into hanging strings of goo.
   */
  ballYScale?: number;
  /** Extra Y-stretch handed out per-ball by its hash, as a fraction (±). */
  ballYScaleVariance?: number;
  /**
   * Asymmetry of that vertical stretch, 0–1. At 0 the ball is a symmetric
   * capsule; above 0 the field reaches further up than down, so the strand
   * tapers to a thin tail overhead and pools into a bulb underneath — the
   * teardrop silhouette of dripping honey.
   */
  ballTaper?: number;
  /**
   * Exponent on each ball's kernel. 1 is the classic 1/d² falloff. Below 1 the
   * tail fattens so balls bond across bigger gaps (longer, more connected
   * strings); above 1 it sharpens so they stay separate beads. Raise
   * `fieldThreshold` alongside a drop here, or everything fuses into a slab.
   */
  fieldPower?: number;
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
  /** Silhouette the field is clipped to. Omit and nothing is clipped. */
  mask?: FieldMask;
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
  uniform float uBallTaper;
  uniform float uFieldPower;

  uniform float uShade;
  uniform float uOpacity;
  uniform float uCoreShade;
  uniform float uRimLight;
  uniform float uRimWidth;
  uniform float uThicknessRange;

  uniform float iAnimationSize;
  uniform float iBallCount;
  uniform vec4  iMetaBalls[50];
  uniform float enableTransparency;
  uniform float iAnchorCount;
  uniform vec3  iAnchors[16];
  uniform float iAnchorRoundness[16];
  uniform float iAnchorStrength[16];
  uniform float iAnchorYScale[16];
  uniform float iAnchorVisible[16];

  uniform sampler2D uMaskTex;
  uniform float uMaskEnabled;
  uniform vec2  uMaskScale;
  uniform vec2  uMaskOffset;
  uniform float uMaskFloor;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  // Coverage of the outline the field is allowed to be seen through, in this
  // plane's own UV. See the FieldMask docs above for the geometry.
  float fieldMask(vec2 uv) {
    if (uMaskEnabled < 0.5) return 1.0;

    vec2 m = uv * uMaskScale + uMaskOffset;

    // Above the floor the outline is read straight off the alpha, so a shape
    // that narrows towards the top — a scalp, a crown, a dome — keeps the
    // field tucked inside it. At and below the floor the width is simply held,
    // which leaves everything under the shape's bottom edge filled rather than
    // cut away. That is the half that matters here: the goo hangs in a gap, and
    // a gap has no alpha of its own to be inside of.
    float outline = texture2D(uMaskTex, vec2(m.x, max(m.y, uMaskFloor))).a;

    // Sideways there is no held width to fall back on. Tested explicitly
    // rather than left to the sampler, because clamp-to-edge smears the border
    // column outward for ever — and a shape that runs off the side of its own
    // texture leaves that column fully opaque.
    float inside = step(0.0, m.x) * step(m.x, 1.0) * step(m.y, 1.0);

    return outline * inside;
  }

  // b = (x, y, radius, yScale)
  float mb(vec4 b, vec2 p) {
    vec2 d = p - b.xy;

    // Anisotropic falloff. Dividing d.y down before the distance test makes the
    // field reach further along Y than X, so a ball bonds with its neighbours
    // above and below while staying narrow sideways: a string, not a bead.
    //
    // The stretch is also asymmetric — smoothstep ramps it from "short" below
    // the centre to "long" above, over the ball's own radius so there's no kink
    // at d.y = 0. The result hangs: a thin tail overhead, a fat bulb beneath.
    float up = smoothstep(-b.z, b.z, d.y);
    float ys = b.w * mix(max(1.0 - uBallTaper, 0.05), 1.0 + uBallTaper, up);
    d.y /= max(ys, 0.01);

    // Below 1 the exponent fattens the kernel's tail, bonding balls across
    // wider gaps so the strings stay unbroken further from their anchor.
    return pow((b.z * b.z) / dot(d, d), uFieldPower);
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
      float k = mb(iMetaBalls[i], coord);
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
    gl_FragColor = vec4(col, alpha * fVisible * uOpacity * fieldMask(vUv));
  }
`;

// ─────────────────────────────────────────────
//  Inner mesh
// ─────────────────────────────────────────────

const MAX_ANCHORS = 16;

/** Bound to the mask samplers when there is no mask — they must point at
 *  something, and a transparent texel is the "clip nothing" identity. */
const EMPTY_MASK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
EMPTY_MASK.needsUpdate = true;

// Scratch for the per-frame pointer projection. Every instance runs that
// projection on every frame, and a fresh Ray plus two vectors each time is pure
// garbage — nothing here outlives the call that writes it.
const meshWorldPos = new THREE.Vector3();
const meshWorldScale = new THREE.Vector3();
const pointerRay = new THREE.Ray();
const pointerNdc = new THREE.Vector3();
const pointerAnim = { x: 0, y: 0 };

type MaskUniforms = {
  enabled: number;
  texture: THREE.Texture;
  scale: THREE.Vector2;
  offset: THREE.Vector2;
  floor: number;
};

/**
 * Resolve a FieldMask into the affine map from this plane's UV into the mask
 * texture's UV. A point at UV `p` on this plane sits at world
 * `centre + (p - 0.5) * size`, so pushing that through the mask plane's own
 * inverse gives `p * (size / maskSize) + (centre - maskCentre) / maskSize +
 * 0.5 * (1 - size / maskSize)`.
 */
function resolveMask(
  mask: FieldMask | undefined,
  position: [number, number, number],
  scale: [number, number, number],
): MaskUniforms {
  if (!mask) {
    return {
      enabled: 0,
      texture: EMPTY_MASK,
      scale: new THREE.Vector2(1, 1),
      offset: new THREE.Vector2(0, 0),
      floor: 0,
    };
  }

  const [mw, mh] = mask.scale;
  const kx = scale[0] / mw;
  const ky = scale[1] / mh;

  return {
    enabled: 1,
    texture: mask.texture,
    scale: new THREE.Vector2(kx, ky),
    offset: new THREE.Vector2(
      (position[0] - mask.position[0]) / mw + 0.5 * (1 - kx),
      (position[1] - mask.position[1]) / mh + 0.5 * (1 - ky),
    ),
    // 0 reads the very bottom row, so by default nothing is held and the mask
    // is just the texture's own alpha.
    floor: mask.floor ?? 0,
  };
}

type SceneProps = Required<
  Omit<HolographicMetaBallsProps, "position" | "scale" | "ref" | "mask">
> & {
  position: [number, number, number];
  scale: [number, number, number];
  renderOrder?: number;
  seed: number;
  mask?: FieldMask;
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
      () => Array.from({ length: 50 }, () => new THREE.Vector4()),
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
          // Uneven strand lengths — a row of identical strings reads as a comb.
          yScale:
            props.ballYScale * (1 + (g[1] * 2 - 1) * props.ballYScaleVariance),
        };
      });
    }, [
      props.ballCount,
      props.seed,
      props.ballRadius,
      props.ballRadiusVariance,
      props.ballSpreadY,
      props.ballYScale,
      props.ballYScaleVariance,
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

    // ── Silhouette mask ──────────────────────────
    const maskUniforms = useMemo(
      () => resolveMask(props.mask, props.position, props.scale),
      [props.mask, props.position, props.scale],
    );

    // Constant for the life of the props, but the frame loop below used to
    // rebuild all four every frame: a THREE.Color, an sRGB→linear conversion
    // (three pows) and a Vector3 apiece, which across the four instances on the
    // face came to 32 throwaway objects a frame for values that never move.
    const holoColors = useMemo(
      () => [
        hexToVec3(props.holoColor1),
        hexToVec3(props.holoColor2),
        hexToVec3(props.holoColor3),
        hexToVec3(props.holoColor4),
      ],
      [props.holoColor1, props.holoColor2, props.holoColor3, props.holoColor4],
    );

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
        uBallTaper: { value: props.ballTaper },
        uFieldPower: { value: props.fieldPower },
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
        uMaskTex: { value: maskUniforms.texture },
        uMaskEnabled: { value: maskUniforms.enabled },
        uMaskScale: { value: maskUniforms.scale.clone() },
        uMaskOffset: { value: maskUniforms.offset.clone() },
        uMaskFloor: { value: maskUniforms.floor },
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
      // A hidden field drives nothing, and Head hides the goo for good the
      // moment a piece leaves the assembled face — so without this the four
      // instances go on paying for a full uniform rewrite and a pointer
      // unprojection every frame for the rest of the session.
      if (meshRef.current && !meshRef.current.visible) return;

      // Ball motion is offset by `seed`; the holographic fill has its own phase
      // so instances can move independently but still share a colour.
      const t = clock.getElapsedTime() + props.seed * 10.0;
      uniforms.uTime.value = clock.getElapsedTime() + props.holoTimeOffset;
      uniforms.uResolution.value.set(size.width, size.height);

      uniforms.uTimeScale.value = props.holoTimeScale;
      uniforms.uSeed.value = props.holoSeed;
      uniforms.uIterations.value = props.holoIterations;
      uniforms.uColor1.value.copy(holoColors[0]);
      uniforms.uColor2.value.copy(holoColors[1]);
      uniforms.uColor3.value.copy(holoColors[2]);
      uniforms.uColor4.value.copy(holoColors[3]);
      uniforms.uColorIntensity.value = props.holoColorIntensity;
      uniforms.uSoftness.value = props.holoSoftness;
      uniforms.uGamma.value = props.holoGamma;
      uniforms.uGrainAmount.value = props.holoGrainAmount;
      uniforms.uZoom.value = props.holoZoom;
      uniforms.uFieldThreshold.value = props.fieldThreshold;
      uniforms.uFieldEdge.value = props.fieldEdge;
      uniforms.uBallTaper.value = props.ballTaper;
      uniforms.uFieldPower.value = props.fieldPower;
      uniforms.uShade.value = props.shade;
      uniforms.uOpacity.value = props.opacity;
      uniforms.uCoreShade.value = props.coreShade;
      uniforms.uRimLight.value = props.rimLight;
      uniforms.uRimWidth.value = props.rimWidth;
      uniforms.uThicknessRange.value = props.thicknessRange;

      uniforms.uMaskTex.value = maskUniforms.texture;
      uniforms.uMaskEnabled.value = maskUniforms.enabled;
      uniforms.uMaskScale.value.copy(maskUniforms.scale);
      uniforms.uMaskOffset.value.copy(maskUniforms.offset);
      uniforms.uMaskFloor.value = maskUniforms.floor;

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
      //
      // Skipped outright on a layer that doesn't react to the cursor. With
      // either `mouseStrength` or `mouseRadius` at zero the disturbance below
      // is identically zero, so the whole projection is measured and thrown
      // away — which is what every layer on the face was doing.
      let mouse: { x: number; y: number } | null = null;
      if (mouseStrength !== 0 && mouseRadius > 0 && meshRef.current) {
        meshRef.current.getWorldPosition(meshWorldPos);

        // Ray from camera through the NDC pointer position
        pointerNdc.set(pointer.x, pointer.y, 0.5).unproject(frameCamera);
        pointerRay.origin.copy(frameCamera.position);
        pointerRay.direction
          .subVectors(pointerNdc, frameCamera.position)
          .normalize();

        // Intersect with the Z=meshWorldPos.z plane
        const planeZ = meshWorldPos.z;
        const hit = (planeZ - pointerRay.origin.z) / pointerRay.direction.z;
        if (hit > 0) {
          const worldX = pointerRay.origin.x + pointerRay.direction.x * hit;
          const worldY = pointerRay.origin.y + pointerRay.direction.y * hit;

          // Convert world coords → animation-space:
          // The mesh is a unit plane, so its *world* scale is how many world
          // units the plane spans — `props.scale` only while nothing above it
          // is scaled, which the face is between `lg` and `xl` and below `lg`
          // (see <Scene />). Read off the mesh, the cursor keeps landing where
          // the cursor is at any size.
          meshRef.current.getWorldScale(meshWorldScale);
          const worldUnitsPerAnimUnit = meshWorldScale.x / props.animationSize;
          pointerAnim.x = (worldX - meshWorldPos.x) / worldUnitsPerAnimUnit;
          pointerAnim.y = (worldY - meshWorldPos.y) / worldUnitsPerAnimUnit;
          mouse = pointerAnim;
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

        metaBalls[i].set(finalX, finalY, p.radius, p.yScale);
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
    ballYScale = 1,
    ballYScaleVariance = 0,
    ballTaper = 0,
    fieldPower = 1,
    fieldThreshold = 1.0,
    fieldEdge = 0.02,
    shade = 1,
    opacity = 1,
    coreShade = 1,
    rimLight = 0,
    rimWidth = 2,
    thicknessRange = 1.5,
    enableTransparency = false,
    mask,
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
    mouseRadius = 0,
    mouseStrength = 0,
    mouseInfluenceSpeed = 0,
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
      ballYScale={ballYScale}
      ballYScaleVariance={ballYScaleVariance}
      ballTaper={ballTaper}
      fieldPower={fieldPower}
      fieldThreshold={fieldThreshold}
      fieldEdge={fieldEdge}
      shade={shade}
      opacity={opacity}
      coreShade={coreShade}
      rimLight={rimLight}
      rimWidth={rimWidth}
      thicknessRange={thicknessRange}
      enableTransparency={enableTransparency}
      mask={mask}
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
