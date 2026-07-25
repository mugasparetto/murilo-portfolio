export const mountainVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  varying float vWorldZ;

  void main() {
    vUv = uv;
    vHeight = position.y;

    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldZ = world.z;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const mountainFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  varying float vWorldZ;

  uniform vec3 uColor;
  uniform vec3 uFillColor;
  uniform float uOpacity;
  uniform float uFillOpacity;

  uniform vec2 uGrid;
  uniform float uLineWidth;

  uniform float uFadeHeight;
  uniform float uFadeNearZ;
  uniform float uFadeFarZ;

  // Same anti-aliased grid the terrain uses. Cells come from the UVs rather
  // than the triangulation, so the surface reads as a square grid instead of
  // the diagonal-crossed quads a wireframe draws. uGrid is fed the mesh
  // segment counts, so every line lands exactly on a row/column of vertices.
  float gridFactor(vec2 uv, vec2 grid, float lineWidth) {
    vec2 g = uv * grid;

    // distance to the nearest grid line on each axis (0 at lines)
    vec2 f = abs(fract(g) - 0.5);

    // derivative for AA
    vec2 df = fwidth(g);

    vec2 a = smoothstep(vec2(0.0), df * lineWidth, f);

    // min => a line on either axis wins
    return min(a.x, a.y);
  }

  void main() {
    // 1 on the lines, 0 inside the cells
    float line = 1.0 - gridFactor(vUv, uGrid, uLineWidth);

    float heightFade = smoothstep(0.0, uFadeHeight, vHeight);
    float depthFade = smoothstep(uFadeFarZ, uFadeNearZ, vWorldZ);

    // Cells stay see-through at uFillOpacity 0, which keeps the old
    // wireframe read; raising it fills the quads like the terrain.
    float alpha = uOpacity * heightFade * depthFade * mix(uFillOpacity, 1.0, line);

    vec3 color = mix(uFillColor, uColor, line);

    gl_FragColor = vec4(color, alpha);
  }
`;
