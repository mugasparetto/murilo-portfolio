import { useEffect, useState, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Quad {
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
  p3: [number, number, number];
}

export interface TeleportingBillboardProps {
  quad: Quad;
  /** Path or URL to the SVG file rendered at the centre. */
  svgUrl: string;
  /** Billboard width in world units. Default: 1 */
  width?: number;
  /** Billboard height in world units. Default: 1 */
  height?: number;
  /** How large the SVG plane is relative to the billboard. 0–1. Default: 0.55 */
  svgScale?: number;
  /** Teleport interval in ms. Default: 2000 */
  intervalMs?: number;
  /** Stroke thickness in world units. Default: 0.04 */
  strokeWidth?: number;
  /** Show the quad debug overlay. Default: false */
  debug?: boolean;
  /** Debug overlay colour. Default: "#00ffcc" */
  debugColor?: string;
  /**
   * Three.js renderOrder for the billboard group — higher draws on top.
   * Increase if the billboard still appears behind other transparent objects.
   * Default: 999
   */
  renderOrder?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomPointInQuad(q: Quad): THREE.Vector3 {
  const s = Math.random();
  const t = Math.random();
  const p0 = new THREE.Vector3(...q.p0);
  const p1 = new THREE.Vector3(...q.p1);
  const p2 = new THREE.Vector3(...q.p2);
  const p3 = new THREE.Vector3(...q.p3);
  return new THREE.Vector3().lerpVectors(
    new THREE.Vector3().lerpVectors(p0, p1, s),
    new THREE.Vector3().lerpVectors(p3, p2, s),
    t,
  );
}

function quadLoop(q: Quad): [number, number, number][] {
  return [q.p0, q.p1, q.p2, q.p3, q.p0];
}

// ─── Debug overlay ────────────────────────────────────────────────────────────

function DebugQuad({ quad, color }: { quad: Quad; color: string }) {
  const corners: [number, number, number][] = [
    quad.p0,
    quad.p1,
    quad.p2,
    quad.p3,
  ];
  return (
    <group>
      <Line points={quadLoop(quad)} color={color} lineWidth={2} />
      <Line points={[quad.p0, quad.p2]} color={color} lineWidth={1} dashed />
      <Line points={[quad.p1, quad.p3]} color={color} lineWidth={1} dashed />
      {corners.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Stroke border ────────────────────────────────────────────────────────────
// Built from 4 thin planes that form a frame, each nudged slightly forward
// so they always render on top of the white background plane.

interface StrokeBorderProps {
  width: number;
  height: number;
  thickness: number; // world-unit thickness
}

function StrokeBorder({
  width,
  height,
  thickness: t,
  renderOrder,
}: StrokeBorderProps & { renderOrder: number }) {
  const Z = 1.001;

  const segments: [number, number, number, number][] = [
    [0, (height + t) / 2, width + t * 2, t],
    [0, -(height + t) / 2, width + t * 2, t],
    [-(width + t) / 2, 0, t, height],
    [(width + t) / 2, 0, t, height],
  ];

  return (
    <group>
      {segments.map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, Z]} renderOrder={renderOrder + 1}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            color="#ffffff"
            opacity={1}
            transparent
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ─── SVG layer ────────────────────────────────────────────────────────────────

function SvgLayer({
  url,
  size,
  renderOrder,
}: {
  url: string;
  size: number;
  renderOrder: number;
}) {
  const texture = useLoader(THREE.TextureLoader, url);

  // Preserve the SVG's aspect ratio
  const [planeW, planeH] = useMemo(() => {
    const img = texture.image as HTMLImageElement | undefined;
    if (!img?.naturalWidth || !img?.naturalHeight) return [size, size];
    const aspect = img.naturalWidth / img.naturalHeight;
    return aspect >= 1 ? [size, size / aspect] : [size * aspect, size];
  }, [texture, size]);

  return (
    <mesh position={[0, 0, 0.002]} renderOrder={renderOrder + 2}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        depthTest={false}
        alphaTest={0.01}
      />
    </mesh>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TeleportingBillboard({
  quad,
  svgUrl,
  width = 1,
  height = 1,
  svgScale = 0.55,
  intervalMs = 2000,
  strokeWidth = 0.04,
  debug = false,
  debugColor = "#00ffcc",
  renderOrder = 999,
}: TeleportingBillboardProps) {
  const [position, setPosition] = useState<THREE.Vector3>(() =>
    randomPointInQuad(quad),
  );

  useEffect(() => {
    setPosition(randomPointInQuad(quad));
  }, [quad]);

  useEffect(() => {
    const id = setInterval(
      () => setPosition(randomPointInQuad(quad)),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [quad, intervalMs]);

  const svgSize = Math.min(width, height) * svgScale;

  return (
    <group>
      {debug && <DebugQuad quad={quad} color={debugColor} />}

      <Billboard
        position={position}
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
        renderOrder={renderOrder}
      >
        {/* 1 — White semi-transparent background */}
        <mesh renderOrder={renderOrder}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            color="#000000"
            opacity={0.8}
            transparent
            depthWrite={false}
            depthTest={false}
          />
        </mesh>

        {/* 2 — Opaque white stroke border */}
        <StrokeBorder
          width={width}
          height={height}
          thickness={strokeWidth}
          renderOrder={renderOrder}
        />

        {/* 3 — SVG centred on top */}
        <SvgLayer url={svgUrl} size={svgSize} renderOrder={renderOrder} />
      </Billboard>
    </group>
  );
}
