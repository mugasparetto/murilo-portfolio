import { gridColumnCoord, gridFunctions } from "./gridShader";

/**
 * Reflection of the door onto other surfaces.
 *
 * The pattern is the *same* code as the door's displayShader, fed by the *same*
 * uniform objects (time / fluid texture / colors are shared with the door
 * material), so whatever the door shows is what gets reflected.
 *
 * Placement is a mirrored planar projection rather than a ray-traced mirror:
 * the camera sits almost level with the treads, so a true `reflect()` bounces
 * the door's image far in front of the staircase where nothing is there to
 * catch it. Instead each fragment is expressed in the door's own frame and the
 * image is flipped about the door's bottom edge -- the classic fake floor
 * reflection -- then faded by distance, surface orientation and depth.
 *
 * `doorReflectUniforms` + `doorReflectFunctions` are meant to be pasted into
 * any fragment shader that wants to catch the door (see the steps below and
 * the light pool in terrainShader.ts). Materials that include them must share
 * the door material's uniform objects -- see <Steps />.
 */
export const doorReflectUniforms = /* glsl */ `
// --- shared with the door material ---
uniform float iTime;
uniform vec2 iResolution;
uniform sampler2D uDoorFluid;   // fluid sim output, used to distort the pattern
uniform float uSeed;
uniform float uDistortionAmount;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform float uColorIntensity;
uniform float uSoftness;

// --- door quad in world space (published by <Door />) ---
uniform vec3 uDoorPos;
uniform vec3 uDoorRight;
uniform vec3 uDoorUp;
uniform vec2 uDoorHalfSize;
uniform float uDoorStrength;

// --- look ---
uniform float uIntensity;   // overall brightness of the reflection
uniform float uFalloff;     // fade per world unit away from the door
uniform float uRoughness;   // glossy blur, grows with depth below the door
uniform float uFacing;      // 0 = flat wash, 1 = only faces turned to the door
uniform float uTopBoost;    // extra brightness on up-facing surfaces
uniform float uEdgeSoft;    // softness of the footprint edges
uniform float uReach;       // how far down it stretches, in door heights
uniform float uSpread;      // how far sideways it stretches, in door widths

// up-facing mask
uniform float uTopStart;
uniform float uTopEnd;
`;

export const doorReflectFunctions = /* glsl */ `
float sat(float x){ return clamp(x, 0.0, 1.0); }

// Exactly the door's displayShader, evaluated at an arbitrary door uv.
vec3 doorColor(vec2 uv01) {
  vec2 fluidVel = texture2D(uDoorFluid, clamp(uv01, 0.0, 1.0)).xy;

  vec2 fragCoord = uv01 * iResolution;
  float mr = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / mr;

  uv += fluidVel * (0.5 * uDistortionAmount);

  float d = -iTime * 0.5 + uSeed * 3.7;
  float a = uSeed * 1.3;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  d += iTime * 0.5;

  float mixer1 = cos(uv.x * d) * 0.5 + 0.5;
  float mixer2 = cos(uv.y * a) * 0.5 + 0.5;
  float mixer3 = sin(d + a) * 0.5 + 0.5;

  float smoothAmount = clamp(uSoftness * 0.1, 0.0, 0.9);
  mixer1 = mix(mixer1, 0.5, smoothAmount);
  mixer2 = mix(mixer2, 0.5, smoothAmount);
  mixer3 = mix(mixer3, 0.5, smoothAmount);

  vec3 col = mix(uColor1, uColor2, mixer1);
  col = mix(col, uColor3, mixer2);
  col = mix(col, uColor4, mixer3 * 0.4);

  return col * uColorIntensity;
}

/**
 * Door image mirrored onto the surface at worldPos, shaped by the footprint,
 * the surface orientation and the door's own open/closed state -- but *not*
 * scaled by uIntensity or faded by distance. For surfaces that are placed and
 * weighted by hand, like the terrain pool.
 */
vec3 doorReflectionRaw(vec3 worldPos, vec3 N) {
  if (uDoorStrength <= 0.001) return vec3(0.0);

  vec3 right = normalize(uDoorRight);
  vec3 up = normalize(uDoorUp);

  // ---- FRAGMENT IN DOOR SPACE ----
  vec3 p = worldPos - uDoorPos;
  float x = dot(p, right);
  float y = dot(p, up);

  // mirror the image about the door's bottom edge: a fragment sitting 'k'
  // below the door samples the door 'k' above its own bottom edge
  float below = -uDoorHalfSize.y - y;
  float span = max(uDoorHalfSize.y * 2.0 * uReach, 1.0);
  float width = max(uDoorHalfSize.x * 2.0 * uSpread, 1.0);

  vec2 uvRef = vec2(x / width + 0.5, below / span);

  // ---- FOOTPRINT MASK ----
  float soft = max(uEdgeSoft, 0.001);
  float mx = smoothstep(0.0, soft, uvRef.x) * (1.0 - smoothstep(1.0 - soft, 1.0, uvRef.x));
  // ramps in just under the door, dies out further down
  float my = smoothstep(-0.12, 0.02, uvRef.y) * (1.0 - smoothstep(0.4, 1.15, uvRef.y));
  float footprint = mx * my;

  if (footprint <= 0.001) return vec3(0.0);

  // ---- GLOSSY BLUR (stretches the further it travels) ----
  float blur = uRoughness * (0.08 + sat(uvRef.y)) * 0.5;
  vec3 col = doorColor(uvRef);
  col += doorColor(uvRef + vec2( blur * 0.35,  blur));
  col += doorColor(uvRef + vec2(-blur * 0.35, -blur));
  col /= 3.0;

  // ---- SHAPING ----
  // surfaces turned towards the door catch more of it, but never nothing:
  // a wrapped lambert keeps the risers lit instead of going flat black
  vec3 L = normalize(-p);
  float wrap = dot(N, L) * 0.5 + 0.5;
  float facing = mix(1.0, wrap, sat(uFacing));

  // the treads are the surfaces that would actually mirror the door
  float topMask = smoothstep(uTopStart, uTopEnd, dot(N, vec3(0.0, 1.0, 0.0)));
  float boost = 1.0 + uTopBoost * topMask;

  return col * (footprint * facing * boost * uDoorStrength);
}

/** doorReflectionRaw scaled by the global intensity and faded with distance. */
vec3 doorReflection(vec3 worldPos, vec3 N) {
  float atten = exp(-length(worldPos - uDoorPos) * uFalloff);
  return doorReflectionRaw(worldPos, N) * (uIntensity * atten);
}
`;

export const stepReflectVertex = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
// which face we are on, in box space, so the answer survives the staircase
// being rotated
varying vec3 vLocalNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;

  // the step scale is axis aligned, so there is no shear to correct for
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vLocalNormal = normal;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const stepReflectFragment = /* glsl */ `
${doorReflectUniforms}

// --- optional oriented clip plane (inactive while uClipPlaneSide == 0) ---
uniform vec3 uClipPlanePoint;
uniform vec3 uClipPlaneNormal;
uniform float uClipPlaneSide;

// --- grid, matching the terrain's (see gridShader.ts) ---
uniform float uGridLineWidth;
uniform vec3 uGridLineColor;
uniform vec3 uFillColor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalNormal;

${doorReflectFunctions}
${gridColumnCoord}
${gridFunctions}

void main() {
  // ---- OPTIONAL CLIP PLANE ----
  if (uClipPlaneSide != 0.0) {
    float dPlane = dot(normalize(uClipPlaneNormal), vWorldPos - uClipPlanePoint);
    if (dPlane * uClipPlaneSide > 0.0) discard;
  }

  // ---- GRID ----
  // Columns only: planes of constant world x, so the lines run straight up the
  // risers and away over the treads, and are the *same* planes the terrain draws
  // -- built from gridColumn(), not from the step's own width, which is what
  // makes them continue the ground's lattice instead of merely resembling it.
  float grid = 1.0;   // 1 => no line

  // The outer sides lie in a plane of constant x, so a column either misses
  // them or floods the whole face. Skip them; their outline carries the edge.
  if (abs(vLocalNormal.x) < 0.5) {
    grid = gridLineFactor(gridColumn(vWorldPos.x), uGridLineWidth);
  }

  // On lines => grid~0 => lineColor. Inside => grid~1 => fillColor.
  vec3 base = mix(uGridLineColor, uFillColor, grid);
  vec3 outCol = base + doorReflection(vWorldPos, normalize(vWorldNormal));

  gl_FragColor = vec4(outCol, 1.0);
}
`;
