import * as THREE from "three";

import { TUNNEL } from "./presets";

/**
 * The tunnel's three materials.
 *
 * All of them carry their own distance fade rather than reading `scene.fog`,
 * and that is not a preference. The canvas is shared: a fog on the scene would
 * reach every `fog: true` material the hero and the about section own, and
 * those two are lit by hand-written shaders that have no fog term at all — so
 * the setting would darken some of their meshes and none of their shaders, at
 * every scroll position rather than only inside this section. Carrying it here
 * costs six lines and stays where it is put.
 */

const FADE_UNIFORMS = /* glsl */ `
  uniform float uFogNear;
  uniform float uFogFar;
`;

const FADE_VARYING = /* glsl */ `
  varying float vDepth;
`;

/** view-space distance, which is what a fog is a function of */
const FADE_VERTEX = /* glsl */ `
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
`;

const FADE_FACTOR = /* glsl */ `
  float fade = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
`;

/* ==========================================================================
   The wireframe
   ========================================================================== */

const GRID_VERT = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}
  varying vec3 vColor;

  void main() {
    vColor = color;
    ${FADE_VERTEX}
  }
`;

/**
 * Faded in alpha rather than mixed towards the fog colour, which is what a
 * `THREE.Fog` would do. Over a black background the two are the same picture,
 * but the lines are drawn with depth writes off and on top of the shell: a line
 * mixed to black is still *painted*, so a fogged-out ring would quietly darken
 * the wall behind it. Fading the alpha leaves it alone.
 */
const GRID_FRAG = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    ${FADE_FACTOR}
    gl_FragColor = vec4(vColor, uOpacity * fade);
  }
`;

export function makeGridMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFogNear: { value: TUNNEL.fogNear * TUNNEL.scale },
      uFogFar: { value: TUNNEL.fogFar * TUNNEL.scale },
      // 1, so that a line's rendered value over black *is* its vertex colour —
      // which is what lets {@link TUNNEL.level} be quoted as an alpha and
      // compared with the About grid's directly. The level varies along the
      // flight, so it has to live in the colour rather than here; see
      // ./geometry.
      //
      // Which leaves this free for the one thing that is a fact about the
      // whole wireframe at once: ../scene/Scene runs it up from 0 over the
      // handover, so this grid arrives exactly as the About section's copy of
      // it leaves rather than on top of it.
      uOpacity: { value: 1 },
    },
    vertexShader: GRID_VERT,
    fragmentShader: GRID_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
}

/* ==========================================================================
   The shell
   ========================================================================== */

const SHELL_VERT = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}

  void main() {
    ${FADE_VERTEX}
  }
`;

const SHELL_FRAG = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}
  uniform vec3 uColor;

  void main() {
    ${FADE_FACTOR}
    gl_FragColor = vec4(uColor * fade, 1.0);
  }
`;

/**
 * A solid shell just behind the wireframe, near the background colour.
 *
 * You never see it. It fills the depth buffer, which is what stops the grid
 * being an X-ray of the whole flight at once — without it every ring of every
 * turn behind the wall is drawn over the one in front. Offset in depth rather
 * than in space, because the surface is seen from both sides over the course of
 * the scroll and a shell pushed outward would be inside the tube for half of
 * it.
 */
export function makeShellMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFogNear: { value: TUNNEL.fogNear * TUNNEL.scale },
      uFogFar: { value: TUNNEL.fogFar * TUNNEL.scale },
      uColor: { value: new THREE.Color(TUNNEL.colorShell) },
    },
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

/* ==========================================================================
   The title
   ========================================================================== */

const TITLE_VERT = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}
  varying vec2 vUv;

  void main() {
    vUv = uv;
    ${FADE_VERTEX}
  }
`;

/**
 * The whole block from one line of type.
 *
 * The texture holds the word once, cap-height tall: solid in red, outlined in
 * green, each channel its own coverage. Everything else is laid out here, in
 * *cap heights* down the sheet from the top of the caps — the caps themselves
 * at 0 to 1, then every echo as the outline again, shifted down by its gap and
 * cut to the slice its reveal leaves showing above its baseline.
 *
 * Two kinds of echo. The first three are the hero name's, irregular and so
 * listed one by one. The wake after them is regular — a fixed pitch, with the
 * reveal and the brightness tapering along it — so the one echo that can cover
 * a given row is found by arithmetic rather than by looping over all of them:
 * one texture read for the wake, however long it is.
 *
 * Every read goes through `textureGrad` with the derivatives of the caps' own
 * coordinates. Each echo is the same mapping shifted, so those are its
 * derivatives too — and a read inside a branch cannot take its own, since the
 * branch is exactly what differs between neighbouring pixels at a cut.
 *
 * Faded in alpha over black, for the wireframe's reason: the sheet sits on the
 * wall and has to go into the distance with it.
 */
const TITLE_FRAG = /* glsl */ `
  ${FADE_UNIFORMS}
  ${FADE_VARYING}
  uniform sampler2D uMap;
  /** texture v at the top of the caps, and texture v per cap height */
  uniform vec2 uLine;
  /** the sheet's v as cap heights: at its top edge, and across its height */
  uniform vec2 uSpan;
  uniform float uFill;
  uniform float uStroke;
  uniform float uOpacity;
  /** how far under its baseline an echo's cut reaches, in cap heights */
  uniform float uSlop;
  /** the hero's three: gap, reveal, brightness */
  uniform vec3 uEchoes[3];
  /** the wake: first gap, pitch, count */
  uniform vec3 uWake;
  /** and its taper: reveal from, to; brightness from, to */
  uniform vec4 uTaper;
  varying vec2 vUv;

  /** coverage of the slice an echo leaves showing, antialiased at both cuts */
  float cut(float y, float reveal, float aa) {
    return clamp((y - (1.0 - reveal)) / aa + 0.5, 0.0, 1.0)
         * clamp((1.0 + uSlop - y) / aa + 0.5, 0.0, 1.0);
  }

  void main() {
    ${FADE_FACTOR}

    float y = uSpan.x + vUv.y * uSpan.y;
    vec2 at = vec2(vUv.x, uLine.x + y * uLine.y);
    vec2 dx = dFdx(at);
    vec2 dy = dFdy(at);
    float aa = max(fwidth(y), 1e-4);

    float fill = textureGrad(uMap, at, dx, dy).r
               * step(0.0, at.y) * step(at.y, 1.0);

    float stroke = 0.0;

    for (int i = 0; i < 3; i++) {
      float e = y - uEchoes[i].x;
      float m = cut(e, uEchoes[i].y, aa);
      if (m > 0.0) {
        vec2 st = vec2(vUv.x, uLine.x + e * uLine.y);
        stroke += m * uEchoes[i].z * textureGrad(uMap, st, dx, dy).g;
      }
    }

    // the first wake echo whose lower cut is still below this row
    float k = ceil((y - 1.0 - uSlop - uWake.x) / uWake.y);
    if (k >= 0.0 && k < uWake.z) {
      float t = uWake.z > 1.0 ? k / (uWake.z - 1.0) : 0.0;
      float e = y - (uWake.x + k * uWake.y);
      float m = cut(e, mix(uTaper.x, uTaper.y, t), aa);
      if (m > 0.0) {
        vec2 st = vec2(vUv.x, uLine.x + e * uLine.y);
        stroke += m * mix(uTaper.z, uTaper.w, t)
                * textureGrad(uMap, st, dx, dy).g;
      }
    }

    float a = (fill * uFill + stroke * uStroke) * uOpacity * fade;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export type TitleLayout = {
  /** the one line of type: solid in red, outlined in green */
  map: THREE.Texture;
  /** texture v at the top of the caps, and per cap height */
  line: [number, number];
  /** sheet v as cap heights: at the top edge, and across the whole sheet */
  span: [number, number];
  fill: number;
  stroke: number;
  slop: number;
  /** the hero's three echoes: gap, reveal, brightness */
  echoes: [number, number, number][];
  /** first gap, pitch, count — all in cap heights but the count */
  wake: [number, number, number];
  /** reveal from, to; brightness from, to */
  taper: [number, number, number, number];
};

export function makeTitleMaterial(layout: TitleLayout) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFogNear: { value: TUNNEL.fogNear * TUNNEL.scale },
      uFogFar: { value: TUNNEL.fogFar * TUNNEL.scale },
      uMap: { value: layout.map },
      uLine: { value: new THREE.Vector2(...layout.line) },
      uSpan: { value: new THREE.Vector2(...layout.span) },
      uFill: { value: layout.fill },
      uStroke: { value: layout.stroke },
      uOpacity: { value: 1 },
      uSlop: { value: layout.slop },
      uEchoes: {
        value: layout.echoes.map((e) => new THREE.Vector3(...e)),
      },
      uWake: { value: new THREE.Vector3(...layout.wake) },
      uTaper: { value: new THREE.Vector4(...layout.taper) },
    },
    vertexShader: TITLE_VERT,
    fragmentShader: TITLE_FRAG,
    transparent: true,
    depthWrite: false,
    // seen from the axis side all the way, but which face that is depends on
    // the winding the sheet happened to be built in — and costs nothing to
    // not care about
    side: THREE.DoubleSide,
  });
}

/* ==========================================================================
   The fluid
   ========================================================================== */

const FLUID_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Domain-warped value noise: two rounds of fbm feeding the offset of the next,
 * which is what gives it the folded, liquid look instead of the cloudy look of
 * plain fbm.
 *
 * The same shader runs on the pool surface ahead of you and on the pane that
 * covers the frame once you are through it, so crossing over does not change
 * the material — only which of the two you are looking at.
 */
const FLUID_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uAspect;
  uniform float uRim;
  uniform float uScale;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec2 p = uv * uScale;
    float t = uTime * 0.13;

    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.6));
    vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.5),
                  fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.35));
    float f = fbm(p + 3.5 * r);

    vec3 col = mix(vec3(0.012, 0.043, 0.106), vec3(0.031, 0.161, 0.361), smoothstep(0.20, 0.62, f));
    col = mix(col, vec3(0.114, 0.451, 0.741), smoothstep(0.55, 0.88, f));
    col = mix(col, vec3(0.498, 0.890, 1.000),
              smoothstep(0.74, 1.00, f) * (0.30 + 0.70 * clamp(length(r), 0.0, 1.0)));

    float d = length(uv);
    col *= 1.0 - 0.50 * smoothstep(0.25, 0.80, d);

    float a = uFade * mix(1.0, 1.0 - smoothstep(0.40, 0.50, d), uRim);
    gl_FragColor = vec4(col, a);
  }
`;

export function makeFluidMaterial(rim: number, scale: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uAspect: { value: 1 },
      uRim: { value: rim },
      uScale: { value: scale },
    },
    vertexShader: FLUID_VERT,
    fragmentShader: FLUID_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
  });
}
