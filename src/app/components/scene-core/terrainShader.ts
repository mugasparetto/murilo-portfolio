export const terrainVertex = /* glsl */ `
  attribute vec3 barycentric;
  varying vec3 vBarycentric;

  uniform float uTime;
  uniform float uDiff;
  uniform float uXYScale;
  uniform float uScrollSpeed;
  uniform float uSpeedMul;

  uniform float uWidth;
  uniform float uEdgePower;
  uniform float uEdgePad;
  uniform float uEdgeStrength;

  uniform float uBowlStrength;
  uniform float uBowlPower;
  uniform float uNoiseEdgeStart;
  uniform float uNoiseEdgeEnd;
  uniform float uNoiseEdgePower;

  varying float vWorldZ;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187,
      0.366025403784439,
     -0.577350269189626,
      0.024390243902439
    );

    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);

    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;

    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

    vec3 m = max(
      0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
      0.0
    );
    m = m * m;
    m = m * m;

    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;

    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.y = a0.y * x12.x + h.y * x12.y;
    g.z = a0.z * x12.z + h.z * x12.w;

    return 130.0 * dot(m, g);
  }

  float normX(float x) {
    return clamp(abs(x) / (uWidth * 0.5), 0.0, 1.0);
  }

  float bowlProfile(float x01) {
    return pow(x01, uBowlPower);
  }

  float noiseRamp(float x01) {
    float r = smoothstep(uNoiseEdgeStart, uNoiseEdgeEnd, x01);
    return pow(r, uNoiseEdgePower);
  }

  void main() {
    vBarycentric = barycentric;

    vec3 pos = position;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldZ = world.z;

    float t = uTime * uScrollSpeed * uSpeedMul;
    vec2 samplePos = vec2(world.x, world.z - t) * uXYScale;

    float n = snoise(samplePos);
    float nn = n * 0.5 + 0.5;

    float x01 = normX(pos.x);

    float bowl = bowlProfile(x01) * uBowlStrength;
    float ramp = noiseRamp(x01);
    ramp *= uEdgeStrength;

    pos.y += bowl;
    pos.y += nn * uDiff * ramp;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const terrainFragment = /* glsl */ `
  varying vec3 vBarycentric;

  uniform float uLineWidth;
  uniform vec3 uLineColor;
  uniform vec3 uFillColor;

  varying float vWorldZ;

  uniform float uMaskNearZ;
  uniform float uMaskFarZ;
  uniform float uMaskPower;
  uniform float uUseHardClip;

  float edgeFactor() {
    vec3 d = fwidth(vBarycentric);
    vec3 a = smoothstep(vec3(0.0), d * uLineWidth, vBarycentric);
    return min(min(a.x, a.y), a.z);
  }

  void main() {
    float edge = edgeFactor();
    vec3 color = mix(uLineColor, uFillColor, edge);

    float t = smoothstep(uMaskNearZ, uMaskFarZ, vWorldZ);
    float fade = pow(1.0 - t, uMaskPower);

    if (uUseHardClip > 0.5) {
      if (vWorldZ < uMaskFarZ) discard;
      fade = 1.0;
    }

    gl_FragColor = vec4(color, fade);
  }
`;
