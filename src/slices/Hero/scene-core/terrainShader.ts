import {
  doorReflectFunctions,
  doorReflectUniforms,
} from "./reflectionShader";

export const terrainVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vWorldZ;
  varying vec3 vWorldPos;

  uniform float uTime;
  uniform float uDiff;
  uniform float uXYScale;
  uniform float uScrollSpeed;
  uniform float uSpeedMul;

  uniform float uWidth;
  uniform float uEdgeStrength;

  uniform float uBowlStrength;
  uniform float uBowlPower;
  uniform float uNoiseEdgeStart;
  uniform float uNoiseEdgeEnd;
  uniform float uNoiseEdgePower;

  // fbm / domain-warp controls
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uWarpStrength;

  // low-frequency mask that breaks the border ridge into separate clusters
  uniform float uClusterScale;
  uniform float uClusterThreshold;
  uniform float uClusterSoftness;
  uniform float uClusterStrength;

  // depth-based height falloff: taller near the camera, lower far away
  uniform float uHeightFalloffNearZ;
  uniform float uHeightFalloffFarZ;
  uniform float uHeightFalloffPower;
  uniform float uHeightFalloffMin;

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

  // Sum of 4 octaves (gain 0.5, lacunarity 2) is layered, low-frequency-
  // dominant noise -- this alone is already much smoother than a single
  // raw snoise() call, which is what was producing the chaotic spikes.
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 4; i++) {
      sum += amp * snoise(p * freq);
      freq *= uLacunarity;
      amp *= uGain;
    }
    return sum;
  }

  // Domain warping: use noise to offset the *input* of another noise call.
  // This is what turns generic bumps into the smooth, flowing, dune-like
  // ridges you see in the reference -- the ridge lines curve and drift
  // instead of looking like random scattered peaks.
  float warpedFbm(vec2 p) {
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0)),
      fbm(p + vec2(5.2, 1.3))
    );
    vec2 r = p + uWarpStrength * q;
    return fbm(r);
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

  // Low-frequency 2D noise gating the border ramp into distinct blobs
  // instead of one unbroken wall. Sampling on signed world.x (not the
  // symmetric x01 used above) means the left and right sides land on
  // unrelated parts of the noise field, so their clusters don't mirror
  // each other -- each side gets its own independent layout.
  float clusterMask(vec2 worldXZ) {
    float c = snoise(worldXZ * uClusterScale);
    return smoothstep(
      uClusterThreshold - uClusterSoftness,
      uClusterThreshold + uClusterSoftness,
      c
    );
  }

  // 1 near uHeightFalloffNearZ (close to camera), fading to
  // uHeightFalloffMin by uHeightFalloffFarZ (far into the distance).
  float heightFalloff(float worldZ) {
    float t = smoothstep(uHeightFalloffNearZ, uHeightFalloffFarZ, worldZ);
    float f = pow(1.0 - t, uHeightFalloffPower);
    return mix(uHeightFalloffMin, 1.0, f);
  }

  void main() {
    vUv = uv;

    vec3 pos = position;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldZ = world.z;

    float t = uTime * uScrollSpeed * uSpeedMul;
    vec2 samplePos = vec2(world.x, world.z - t) * uXYScale;

    float n = warpedFbm(samplePos);
    float nn = clamp(n * 0.5 + 0.5, 0.0, 1.0);

    float x01 = normX(pos.x);

    float bowl = bowlProfile(x01) * uBowlStrength;
    float ramp = noiseRamp(x01);
    ramp *= uEdgeStrength;

    float clusters = clusterMask(vec2(world.x, world.z - t));
    ramp *= mix(1.0, clusters, uClusterStrength);

    float depthScale = heightFalloff(world.z);

    pos.y += bowl * depthScale;
    pos.y += nn * uDiff * ramp * depthScale;

    // after displacement, so the door's light pool sits on the actual surface
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const terrainFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vWorldZ;
  varying vec3 vWorldPos;
  uniform float uClipZ;

  uniform float uLineWidth;
  uniform vec3 uLineColor;
  uniform vec3 uFillColor;

  uniform float uMaskNearZ;
  uniform float uMaskFarZ;
  uniform float uMaskPower;
  uniform float uUseHardClip;

  // ✅ new: grid density (cells per 1.0 UV)
  uniform float uGrid;

  // --- door light pool: the patch of ground just before the first step ---
  uniform vec2 uPoolCenter;   // world XZ
  uniform vec2 uPoolSize;     // world half extents
  uniform float uPoolStrength;

${doorReflectUniforms}
${doorReflectFunctions}

  // Anti-aliased grid line factor:
  // returns 0 on lines, 1 in cell interiors (so it matches your mix())
  float gridFactor(vec2 uv, float grid, float lineWidth) {
    vec2 g = uv * grid;

    // distance to nearest grid line in each axis (0 at lines)
    vec2 f = abs(fract(g) - 0.5);

    // derivative for AA
    vec2 df = fwidth(g);

    // line thickness in "grid space"
    vec2 a = smoothstep(vec2(0.0), df * lineWidth, f);

    // min => lines on either axis become lines
    return min(a.x, a.y);
  }

  void main() {
    if (vWorldZ > uClipZ) discard;
    
    float grid = gridFactor(vUv, uGrid, uLineWidth);

    // On lines => grid~0 => lineColor. Inside => grid~1 => fillColor.
    vec3 color = mix(uLineColor, uFillColor, grid);

    // ---- DOOR LIGHT POOL ----
    // Soft blob in world XZ, so it stays put while the terrain tiles scroll
    // through it. Placed to cover the ground right in front of the first step.
    if (uPoolStrength > 0.001) {
      vec2 q = (vWorldPos.xz - uPoolCenter) / max(uPoolSize, vec2(1.0));
      float pool = 1.0 - smoothstep(0.35, 1.0, length(q));

      if (pool > 0.001) {
        // raw: the pool is placed and weighted by hand, so it skips the
        // distance falloff that would otherwise crush it this far from the door
        color += doorReflectionRaw(vWorldPos, vec3(0.0, 1.0, 0.0))
               * (pool * uPoolStrength);
      }
    }

    float t = smoothstep(uMaskNearZ, uMaskFarZ, vWorldZ);
    float fade = pow(1.0 - t, uMaskPower);

    if (uUseHardClip > 0.5) {
      if (vWorldZ < uMaskFarZ) discard;
      fade = 1.0;
    }

    gl_FragColor = vec4(color, fade);
  }
`;
