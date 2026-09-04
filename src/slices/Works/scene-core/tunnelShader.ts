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
