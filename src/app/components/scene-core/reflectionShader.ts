export const stepReflectVertex = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// This reproduces the DOOR display shader’s color pattern,
// but uses the fluid texture ONLY to distort UVs.
// Also masks to top faces only.
export const stepReflectFragment = /* glsl */ `
uniform float iTime;
uniform vec2 iResolution;

// distortion field (the sim output)
uniform sampler2D uDoorFluid;

// door “display” params (same as your door shader)
uniform float uDistortionAmount;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform float uColorIntensity;
uniform float uSoftness;

// door projection (so it lines up under the door)
uniform vec3 uDoorPos;
uniform vec3 uDoorRight;
uniform vec3 uDoorUp;
uniform vec2 uDoorHalfSize;

uniform float uIntensity;
uniform float uFalloff;

// top-face mask
uniform float uTopStart;
uniform float uTopEnd;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float sat(float x){ return clamp(x,0.0,1.0); }

void main() {
  vec3 base = vec3(0.0);

  // ---- TOP FACE MASK ----
  float upDot = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
  float topMask = smoothstep(uTopStart, uTopEnd, upDot);

  // ---- Project world pos into door plane UV (0..1 over door rectangle) ----
  vec3 p = vWorldPos - uDoorPos;
  float x = dot(p, normalize(uDoorRight));
  float y = dot(p, normalize(uDoorUp));

  vec2 uv = vec2(
    x / uDoorHalfSize.x * 0.5 + 0.5,
    y / uDoorHalfSize.y * 0.5 + 0.5
  );

  // soft inside mask
  float mx = smoothstep(0.0, 0.03, uv.x) * (1.0 - smoothstep(0.97, 1.0, uv.x));
  float my = smoothstep(0.0, 0.03, uv.y) * (1.0 - smoothstep(0.97, 1.0, uv.y));
  float inside = mx * 0.15;
//   float inside = 0.15;

  // ---- Distortion field (fluid) ----
  vec2 fluidVel = texture2D(uDoorFluid, uv).xy;
  vec2 uv2 = uv + fluidVel * (0.5 * uDistortionAmount);

  // ---- Recreate the displayShader pattern (time-based, always present) ----
  vec2 fragCoord = uv2 * iResolution;
  float mr = min(iResolution.x, iResolution.y);
  vec2 tuv = (fragCoord * 2.0 - iResolution.xy) / mr;

  float d = -iTime * 0.5;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * tuv.x);
    d += sin(tuv.y * i + a);
  }
  d += iTime * 0.5;

  float mixer1 = cos(tuv.x * d) * 0.5 + 0.5;
  float mixer2 = cos(tuv.y * a) * 0.5 + 0.5;
  float mixer3 = sin(d + a) * 0.5 + 0.5;

  float smoothAmount = clamp(uSoftness * 0.1, 0.0, 0.9);
  mixer1 = mix(mixer1, 0.5, smoothAmount);
  mixer2 = mix(mixer2, 0.5, smoothAmount);
  mixer3 = mix(mixer3, 0.5, smoothAmount);

  vec3 col = mix(uColor1, uColor2, mixer1);
  col = mix(col, uColor3, mixer2);
  col = mix(col, uColor4, mixer3 * 0.4);
  col *= uColorIntensity;

  // distance fade
  float dist = length(p);
  float fade = exp(-dist * uFalloff) * 0.5;

  vec3 outCol = base + col * (uIntensity * inside * fade * topMask);
  gl_FragColor = vec4(outCol, 1.0);
}
`;
