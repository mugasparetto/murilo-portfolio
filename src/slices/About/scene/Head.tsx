import { RefObject, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

// ─── Shared vertex shader ─────────────────────────────────────────────────────
// Used by sprites (standard UVs 0→1) and circles (world-pos → UV remapped).

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Circle vertex shader: derives vUv from local XY position so the reveal
// mask aligns with the sprite stack sitting at the same world position.
// uSpriteSize  = [worldWidth, worldHeight] of the sprites
// uSpriteCenter = local offset of the circle centre relative to sprite centre
const circleVertexShader = /* glsl */ `
  uniform vec2  uSpriteSize;    // world-space [width, height] of the sprite
  uniform vec2  uSpriteOffset;  // circle centre offset from sprite centre (world units)
  varying vec2  vUv;
 
  void main() {
    // Local position of this vertex (circle is in XY plane before rotation)
    vec3 localPos = position;
 
    // Remap local XY → 0..1 UV relative to the sprite bounding box.
    // Sprite centre is at UV (0.5, 0.5).
    vUv = (localPos.xy + uSpriteOffset) / uSpriteSize + 0.5;
 
    gl_Position = projectionMatrix * modelViewMatrix * vec4(localPos, 1.0);
  }
`;

// ─── Reveal fragment shader (shared by sprites + circles) ────────────────────

const revealFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float     uProgress;
  uniform float     uTime;
  uniform bool      uUseTexture;   // false → use uBaseColor instead
  uniform vec3      uBaseColor;
  varying vec2 vUv;
 
  float hash(float n) { return fract(sin(n) * 43758.5453); }
 
  float noise1D(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
  }
 
  float jaggedEdge(float x, float seed) {
    float n  = noise1D(x * 4.0  + seed) * 0.50;
          n += noise1D(x * 9.0  + seed) * 0.28;
          n += noise1D(x * 20.0 + seed) * 0.14;
          n += noise1D(x * 45.0 + seed) * 0.08;
    return n;
  }
 
  void main() {
    // ── Base colour / texture ──────────────────────────────────────────────
    vec4 baseColor = uUseTexture
      ? texture2D(uTexture, vUv)
      : vec4(uBaseColor, 1.0);
 
    // Discard fully transparent texture pixels early
    if (uUseTexture && baseColor.a < 0.01) discard;
 
    // ── Reveal mask ────────────────────────────────────────────────────────
    float distFromCenter = abs(vUv.y - 0.5);
    float sweep = uProgress * 0.52;
 
    float tearAmt = mix(0.008, 0.05, smoothstep(0.0, 0.08, sweep));
    float tearTop = jaggedEdge(vUv.x, 3.7  + uTime * 0.3) * tearAmt;
    float tearBot = jaggedEdge(vUv.x, 11.2 + uTime * 0.3) * tearAmt;
    float tear    = (vUv.y > 0.5) ? tearTop : tearBot;
 
    float revealEdge = sweep + tear;
    float revealed   = smoothstep(revealEdge, revealEdge - 0.005, distFromCenter);
 
    // ── Streak ─────────────────────────────────────────────────────────────
    float streakHalfW = 0.008;
    float topFront = 0.5 + sweep + tearTop;
    float botFront = 0.5 - sweep - tearBot;
 
    float topStreak = pow(clamp(1.0 - abs(vUv.y - topFront) / streakHalfW, 0.0, 1.0), 1.4);
    float botStreak = pow(clamp(1.0 - abs(vUv.y - botFront) / streakHalfW, 0.0, 1.0), 1.4);
    float streak    = max(topStreak, botStreak);
 
    float shimmer = 1.35 + 0.45 * sin(uTime * 14.0 + vUv.x * 60.0);
    float colVar  = 0.3  + 0.2  * jaggedEdge(vUv.x, uTime * 0.5);
    streak *= shimmer * colVar;
 
    // ── Halo ───────────────────────────────────────────────────────────────
    float haloW   = 0.08;
    float topHalo = clamp(1.0 - abs(vUv.y - topFront) / haloW, 0.0, 1.0);
    float botHalo = clamp(1.0 - abs(vUv.y - botFront) / haloW, 0.0, 1.0);
    float halo    = pow(max(topHalo, botHalo), 2.5) * 0.45;
 
    // ── Edge glow ──────────────────────────────────────────────────────────
    float nearEdge = smoothstep(0.0, 0.01, revealEdge - distFromCenter);
    nearEdge *= (1.0 - nearEdge) * revealed * 1.4;
 
    // ── Compose ────────────────────────────────────────────────────────────
    vec3 cyan     = vec3(0.0, 0.88, 1.0);
    vec3 cyanWarm = vec3(0.1, 0.95, 0.85);
 
    vec3 finalColor = baseColor.rgb * revealed
                    + cyan     * streak   * 3.0
                    + cyanWarm * halo
                    + cyan     * nearEdge * 0.5;
 
    float vig = 1.0 - smoothstep(0.25, 0.8, length(vUv - 0.5));
    finalColor *= vig;
 
    float srcAlpha = uUseTexture ? baseColor.a : 1.0;
    float alpha    = clamp(srcAlpha * revealed + streak * 1.4 + halo * 0.1, 0.0, 1.0);
 
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ─── Uniform factories ────────────────────────────────────────────────────────

function makeSpriteUniforms(texture: THREE.Texture) {
  return {
    uTexture: { value: texture },
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uUseTexture: { value: true },
    uBaseColor: { value: new THREE.Color("hotpink") },
  };
}

function makeCircleUniforms(
  spriteSize: [number, number],
  spriteOffset: [number, number],
) {
  return {
    uTexture: { value: null },
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uUseTexture: { value: false },
    uBaseColor: { value: new THREE.Color("hotpink") },
    uSpriteSize: { value: new THREE.Vector2(...spriteSize) },
    uSpriteOffset: { value: new THREE.Vector2(...spriteOffset) },
  };
}

// ─── RevealSprite ─────────────────────────────────────────────────────────────

type SharedRefs = {
  progressRef: React.RefObject<number>;
  timeRef: React.RefObject<number>;
};

type SpriteLayerProps = SharedRefs & {
  texture: THREE.Texture;
  position: [number, number, number];
  scale: [number, number, number];
  renderOrder?: number;
};

function RevealSprite({
  texture,
  position,
  scale,
  renderOrder = 0,
  progressRef,
  timeRef,
}: SpriteLayerProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useMemo(() => makeSpriteUniforms(texture), [texture]);

  useFrame(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uProgress.value = progressRef.current;
    matRef.current.uniforms.uTime.value = timeRef.current;
  });

  return (
    <sprite position={position} scale={scale} renderOrder={renderOrder}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={revealFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </sprite>
  );
}

// ─── RevealCircle ─────────────────────────────────────────────────────────────

type CircleLayerProps = SharedRefs & {
  position: [number, number, number];
  rotation: [number, number, number];
  radius: number;
  renderOrder?: number;
  // World-space size of the sprite stack (width, height)
  spriteWorldSize: [number, number];
  // How far this circle's centre is from the sprite centre, in world units
  spriteOffset: [number, number];
};

function RevealCircle({
  position,
  rotation,
  radius,
  renderOrder = 999,
  spriteWorldSize,
  spriteOffset,
  progressRef,
  timeRef,
}: CircleLayerProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useMemo(
    () => makeCircleUniforms(spriteWorldSize, spriteOffset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame(() => {
    if (!matRef.current) return;
    matRef.current.uniforms.uProgress.value = progressRef.current;
    matRef.current.uniforms.uTime.value = timeRef.current;
  });

  return (
    <mesh position={position} rotation={rotation} renderOrder={renderOrder}>
      <circleGeometry args={[radius, 48]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={circleVertexShader}
        fragmentShader={revealFragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// ─── Head ─────────────────────────────────────────────────────────────

type Props = {
  ref: RefObject<THREE.Group | null>;
  overallProgress: RefObject<number>;
};

export default function Head({ ref, overallProgress }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  // Sprite world size derived from the bottom texture's natural aspect ratio
  const spriteWorldSize = useMemo<[number, number]>(() => {
    const size = 550;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size];
  }, [bottom]);

  const scale: [number, number, number] = [...spriteWorldSize, 1];
  const spritePos: [number, number, number] = [-380, -800, 2400];

  const circleProgress = useRef(0);
  const timeRef = useRef(0); // time is shared — same clock for both

  useFrame(({ clock }) => {
    timeRef.current = clock.getElapsedTime();
  });

  const spriteRefs = { progressRef: overallProgress, timeRef };
  const circleRefs = { progressRef: circleProgress, timeRef };

  return (
    <group ref={ref}>
      <RevealSprite
        texture={top}
        position={spritePos}
        scale={scale}
        renderOrder={2}
        {...spriteRefs}
      />

      <mesh
        position={[-369, -735, 2400]}
        rotation={[Math.PI / 2 - 0.02, 0.02, 0]}
        renderOrder={999}
      >
        <circleGeometry args={[122, 48]} />
        <meshBasicMaterial
          color={"hotpink"}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <RevealSprite
        texture={middle}
        position={spritePos}
        scale={scale}
        renderOrder={1}
        {...spriteRefs}
      />

      <mesh
        position={[-372, -860, 2400]}
        rotation={[Math.PI / 2 + 0.03, -0.03, 0]}
        renderOrder={999}
      >
        <circleGeometry args={[122, 48]} />
        <meshBasicMaterial
          color={"hotpink"}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <RevealSprite
        texture={bottom}
        position={spritePos}
        scale={scale}
        renderOrder={0}
        {...spriteRefs}
      />
    </group>
  );
}
