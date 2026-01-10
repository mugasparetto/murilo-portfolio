export type SceneParams = {
  // camera
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fov: number;

  // terrain geometry
  w: number;
  h: number;
  scl: number;

  // terrain shader
  diff: number;
  xyScale: number;
  speedMul: number;
  scrollSpeed: number;
  lineWidth: number;

  edgePower: number;
  edgePad: number;
  edgeStrength: number;

  bowlStrength: number;
  bowlPower: number;
  noiseEdgeStart: number;
  noiseEdgePower: number;

  maskNearZ: number;
  maskFarZ: number;
  maskPower: number;
  useHardClip: number;

  // steps
  stepX: number;
  stepY: number;
  stepZ: number;
  rotY: number;
  rotZ: number;

  // door
  doorX: number;
  doorY: number;
  doorZ: number;
  doorScaleX: number;
  doorScaleY: number;

  groupY: number;
};

export const defaultParams: SceneParams = {
  cameraX: 0,
  cameraY: 200,
  cameraZ: 3380,
  targetX: 0,
  targetY: 820,
  targetZ: 0,
  fov: 40,

  w: 8000,
  h: 6000,
  scl: 70,

  diff: 250,
  xyScale: 0.0015,
  speedMul: 0.2,
  scrollSpeed: 120,
  lineWidth: 0.8,

  edgePower: 2.28,
  edgePad: 1200,
  edgeStrength: 3.4,

  bowlStrength: 450,
  bowlPower: 1.94,
  noiseEdgeStart: 0.17,
  noiseEdgePower: 1,

  maskNearZ: -800,
  maskFarZ: -4700,
  maskPower: 4,
  useHardClip: 0,

  stepX: -280,
  stepY: 335,
  stepZ: -3530,
  rotY: -0.257,
  rotZ: 0.15,

  doorX: 60,
  doorY: 2160,
  doorZ: -5400,
  doorScaleX: 1.64,
  doorScaleY: 1.65,

  groupY: -50,
};
