import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmitterProps {
  /** Total number of live particles. @default 1200 */
  count?: number;
  /** Half-angle of the cone in radians (~20° default). @default 0.35 */
  coneAngle?: number;
  /** Particle travel speed in units/second. @default 2.2 */
  speed?: number;
  /** Max lifetime of a particle in seconds. @default 2.0 */
  lifetime?: number;
  /** Point size at birth. @default 0.04 */
  startSize?: number;
  /** Point size at end of life. @default 0.18 */
  endSize?: number;
  /** Start color of the gradient blend. @default #00cfff */
  color1?: THREE.Color;
  /** End color of the gradient blend. @default #ff6af0 */
  color2?: THREE.Color;
  /**
   * Reverse the cone direction — particles spawn spread out at the wide end
   * and converge toward the origin point. @default false
   */
  reversed?: boolean;
}

/** Internal config with all fields required (defaults merged in). */
type EmitterConfig = Required<EmitterProps>;

// Flat particle slot layout:
// [0-2]  = unused padding
// [3-5]  = velocity (vx, vy, vz)
// [6]    = age (seconds)
// [7]    = individual lifetime (seconds)
// [8]    = color lerp t (0–1)
// [9-11] = spawn position offset (for reversed mode)
const SLOT = 12;

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: EmitterConfig = {
  count: 1200,
  coneAngle: 0.35,
  speed: 2.2,
  lifetime: 2.0,
  startSize: 0.04,
  endSize: 0.18,
  color1: new THREE.Color("#00cfff"),
  color2: new THREE.Color("#ff6af0"),
  reversed: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function initParticle(slot: Float32Array, cfg: EmitterConfig): void {
  const { coneAngle, speed, lifetime, reversed } = cfg;

  // Random direction inside the cone (axis = +Y)
  const phi = Math.random() * Math.PI * 2;
  const theta = Math.random() * coneAngle;
  const sinT = Math.sin(theta);

  if (reversed) {
    // Spawn at the wide end, travel inward toward the origin.
    // Start position is where the particle would normally end up,
    // and velocity points back toward the tip.
    const maxAge = lifetime * (0.7 + Math.random() * 0.6);
    const vx = Math.cos(phi) * sinT * speed;
    const vy = Math.cos(theta) * speed;
    const vz = Math.sin(phi) * sinT * speed;
    // Place the particle at its "final" position so it travels back to origin
    slot[3] = -vx; // vx (reversed)
    slot[4] = -vy; // vy (reversed)
    slot[5] = -vz; // vz (reversed)
    // Offset start position to the wide end
    slot[9] = vx * maxAge; // spawn x  (we store these temporarily — see below)
    slot[10] = vy * maxAge; // spawn y
    slot[11] = vz * maxAge; // spawn z
    slot[6] = Math.random() * -lifetime;
    slot[7] = maxAge;
  } else {
    // Normal: spawn at origin, travel outward
    slot[3] = Math.cos(phi) * sinT * speed;
    slot[4] = Math.cos(theta) * speed;
    slot[5] = Math.sin(phi) * sinT * speed;
    slot[9] = slot[10] = slot[11] = 0;
    slot[6] = Math.random() * -lifetime;
    slot[7] = lifetime * (0.7 + Math.random() * 0.6);
  }

  slot[8] = Math.random(); // color lerp t
}

// ─── Emitter component ───────────────────────────────────────────────────────

export default function Emitter(props: EmitterProps) {
  const cfg: EmitterConfig = { ...DEFAULTS, ...props };
  const { count, startSize, endSize, color1, color2, reversed } = cfg;

  // Flat CPU-side particle data
  const data = useMemo<Float32Array>(() => {
    const arr = new Float32Array(count * SLOT);
    for (let i = 0; i < count; i++) {
      initParticle(arr.subarray(i * SLOT, i * SLOT + SLOT), cfg);
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // GPU buffer arrays (mutated in-place each frame)
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const colors = useMemo(() => new Float32Array(count * 3), [count]);
  const sizes = useMemo(() => new Float32Array(count), [count]);

  const geoRef = useRef<THREE.BufferGeometry>(null);
  const texture = useMemo(() => buildParticleTexture(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    for (let i = 0; i < count; i++) {
      const base = i * SLOT;
      data[base + 6] += delta;

      // Respawn when expired
      if (data[base + 6] >= data[base + 7]) {
        initParticle(data.subarray(base, base + SLOT), cfg);
        data[base + 6] = 0;
      }

      const age = data[base + 6];
      const lifespan = data[base + 7];
      const t = Math.max(0, age / lifespan); // 0 → 1

      // Position = spawn offset + velocity × age
      positions[i * 3] = data[base + 9] + data[base + 3] * age;
      positions[i * 3 + 1] = data[base + 10] + data[base + 4] * age;
      positions[i * 3 + 2] = data[base + 11] + data[base + 5] * age;

      // Size: reversed shrinks toward the tip, normal grows toward the wide end
      const sizeT = reversed ? 1 - t : t;
      sizes[i] = THREE.MathUtils.lerp(startSize, endSize, sizeT);

      // Color: lerp between color1/color2, fade in first 10% and out last 20%
      tmpColor.lerpColors(color1, color2, data[base + 8]);
      const fade = t < 0.1 ? t / 0.1 : t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      colors[i * 3] = tmpColor.r * fade;
      colors[i * 3 + 1] = tmpColor.g * fade;
      colors[i * 3 + 2] = tmpColor.b * fade;
    }

    if (geoRef.current) {
      (
        geoRef.current.attributes.position as THREE.BufferAttribute
      ).needsUpdate = true;
      (geoRef.current.attributes.color as THREE.BufferAttribute).needsUpdate =
        true;
      (geoRef.current.attributes.size as THREE.BufferAttribute).needsUpdate =
        true;
    }
  });

  return (
    <points>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTexture: { value: texture } }}
        vertexShader={
          /* glsl */ `
          attribute float size;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (350.0 / -mvPos.z);
            gl_Position  = projectionMatrix * mvPos;
          }
        `
        }
        fragmentShader={
          /* glsl */ `
          uniform sampler2D uTexture;
          varying vec3 vColor;
          void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            gl_FragColor = vec4(vColor, 1.0) * tex;
          }
        `
        }
      />
    </points>
  );
}
