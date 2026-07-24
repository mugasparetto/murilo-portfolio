export const mountainVertex = /* glsl */ `
  varying float vHeight;
  varying float vWorldZ;

  void main() {
    vHeight = position.y;

    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldZ = world.z;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const mountainFragment = /* glsl */ `
  varying float vHeight;
  varying float vWorldZ;

  uniform vec3 uColor;
  uniform float uOpacity;

  uniform float uFadeHeight;
  uniform float uFadeNearZ;
  uniform float uFadeFarZ;

  void main() {
    float heightFade = smoothstep(0.0, uFadeHeight, vHeight);
    float depthFade = smoothstep(uFadeFarZ, uFadeNearZ, vWorldZ);

    float alpha = uOpacity * heightFade * depthFade;
    gl_FragColor = vec4(uColor, alpha);
  }
`;
