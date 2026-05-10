import { useEffect, useState, useMemo } from "react";
import { Billboard, Line } from "@react-three/drei";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Quad {
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
  p3: [number, number, number];
}

export type BillboardSide = "left" | "right" | "top" | "bottom";

export interface TeleportingBillboardProps {
  quad: Quad;
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
  /** Three.js renderOrder — higher draws on top. Default: 999 */
  renderOrder?: number;
  /**
   * Static world-space anchor point the connector line starts from.
   * When omitted, no line is drawn.
   */
  lineAnchor?: [number, number, number];
  /**
   * Which edge of the billboard the connector line attaches to.
   * Default: "left"
   */
  lineAttachment?: BillboardSide;
  /** Colour of the connector line. Default: "#ffffff" */
  lineColor?: string;
  /** Width of the connector line in px. Default: 1.5 */
  lineWidth?: number;
  // In TeleportingBillboardProps
  /** 0 = hidden, 1 = fully drawn. Default: 1 */
  progress?: number;
  /** How `progress` is interpreted:
   *  - "normalized": 0–1 fraction of current line length (default, existing behaviour)
   *  - "distance":   world-unit distance from the anchor along the line
   */
  progressMode?: "normalized" | "distance";
  billboardRef?: React.Ref<THREE.Group> | null;
  divider: number;
  billboardPosition?: THREE.Vector3; // Optional fixed position for the billboard (overrides random teleporting)
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

/**
 * Given the billboard's world-space centre, its size, and the chosen side,
 * return the world-space point on that edge.
 */
function getAttachPoint(
  billboardPos: THREE.Vector3,
  width: number,
  height: number,
  side: BillboardSide,
): THREE.Vector3 {
  const offset = new THREE.Vector3(
    side === "left" ? -width / 2 - 2 : side === "right" ? width / 2 : 0,
    side === "bottom" ? -height / 2 : side === "top" ? height / 2 : 0,
    0,
  );
  return billboardPos.clone().add(offset);
}

/**
 * Build the 3-point elbow path:
 *   anchor → elbow → attachPoint
 *
 * The elbow sits on the same horizontal plane (Y) as the attach point,
 * directly above/below the anchor — mirroring the shape in the reference image.
 */
function buildDiagonalPath(
  anchor: THREE.Vector3,
  attachPoint: THREE.Vector3,
  side: BillboardSide,
  divider: number,
): THREE.Vector3[] {
  const anchorOffset = -301.5; // length of horizontal segment near anchor
  const attachOffset =
    Math.pow(
      attachPoint.distanceTo(
        new THREE.Vector3(anchor.x + anchorOffset, anchor.y, anchor.z),
      ),
      5,
    ) * divider; // length of horizontal segment near billboard

  let anchorElbow: THREE.Vector3;
  let attachElbow: THREE.Vector3;

  if (side === "left") {
    anchorElbow = anchor.clone().add(new THREE.Vector3(-anchorOffset, 0, 0));
    attachElbow = attachPoint
      .clone()
      .add(new THREE.Vector3(-attachOffset, 0, 0));
  } else if (side === "right") {
    anchorElbow = anchor.clone().add(new THREE.Vector3(anchorOffset, 0, 0));
    attachElbow = attachPoint
      .clone()
      .add(new THREE.Vector3(attachOffset, 0, 0));
  } else if (side === "top") {
    anchorElbow = anchor.clone().add(new THREE.Vector3(0, anchorOffset, 0));
    attachElbow = attachPoint
      .clone()
      .add(new THREE.Vector3(0, attachOffset, 0));
  } else {
    anchorElbow = anchor.clone().add(new THREE.Vector3(0, -anchorOffset, 0));
    attachElbow = attachPoint
      .clone()
      .add(new THREE.Vector3(0, -attachOffset, 0));
  }

  return [anchor, anchorElbow, attachElbow, attachPoint];
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

interface StrokeBorderProps {
  width: number;
  height: number;
  thickness: number;
  renderOrder: number;
}

function StrokeBorder({
  width,
  height,
  thickness: t,
  renderOrder,
}: StrokeBorderProps) {
  const Z = 0.001;
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

// Replace the SvgLayer component with this:

function CrossLayer({
  size,
  renderOrder,
}: {
  size: number;
  renderOrder: number;
}) {
  const thickness = size * 0.1; // arm thickness = 25% of the cross size

  return (
    <group position={[0, 0, 0.002]}>
      {/* Horizontal bar */}
      <mesh renderOrder={renderOrder + 2}>
        <planeGeometry args={[size, thickness]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </mesh>

      {/* Vertical bar */}
      <mesh renderOrder={renderOrder + 2}>
        <planeGeometry args={[thickness, size]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

// ─── Connector line ───────────────────────────────────────────────────────────

interface ConnectorLineProps {
  anchor: [number, number, number];
  billboardPos: THREE.Vector3;
  width: number;
  height: number;
  side: BillboardSide;
  color: string;
  lineWidth: number;
  renderOrder: number;
  progress: number;
  progressMode?: "normalized" | "distance";
  divider: number;
}

function ConnectorLine({
  anchor,
  billboardPos,
  width,
  height,
  side,
  color,
  lineWidth,
  renderOrder,
  progress,
  progressMode = "normalized",
  divider = 0.0000000000002,
}: ConnectorLineProps) {
  const points = useMemo(() => {
    if (progress <= 0) return null;

    const anchorVec = new THREE.Vector3(...anchor);
    const attachPoint = getAttachPoint(billboardPos, width, height, side);
    const controlPoints = buildDiagonalPath(
      anchorVec,
      attachPoint,
      side,
      divider,
    );

    let totalLength = 0;
    for (let i = 0; i < controlPoints.length - 1; i++) {
      totalLength += controlPoints[i].distanceTo(controlPoints[i + 1]);
    }

    const target =
      progressMode === "distance"
        ? Math.min(progress, totalLength)
        : totalLength * Math.min(progress, 1);

    const result: THREE.Vector3[] = [controlPoints[0]];
    let walked = 0;

    for (let i = 0; i < controlPoints.length - 1; i++) {
      const a = controlPoints[i];
      const b = controlPoints[i + 1];
      const segLen = a.distanceTo(b);

      if (walked + segLen >= target) {
        const t = (target - walked) / segLen;
        result.push(a.clone().lerp(b, t));
        break;
      }

      result.push(b);
      walked += segLen;
    }

    return result;
  }, [
    anchor,
    billboardPos,
    width,
    height,
    side,
    progress,
    progressMode,
    divider,
  ]);

  if (!points) return null;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={lineWidth}
      renderOrder={renderOrder}
      transparent
      depthWrite={false}
      depthTest={false}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TeleportingBillboard({
  quad,
  width = 1,
  height = 1,
  svgScale = 0.55,
  intervalMs = 2000,
  strokeWidth = 0.04,
  debug = false,
  debugColor = "#00ffcc",
  renderOrder = 999,
  lineAnchor,
  lineAttachment = "left",
  lineColor = "#ffffff",
  lineWidth = 1.5,
  progress = 1, // ← add with default
  progressMode = "normalized", // ← add with default
  divider = 0.0000000000002, // ← add with default
  billboardRef = null,
  billboardPosition,
}: TeleportingBillboardProps) {
  const [position, setPosition] = useState<THREE.Vector3>(
    () => billboardPosition || randomPointInQuad(quad),
  );

  useEffect(() => {
    if (billboardPosition) return;
    const id = setInterval(
      () => setPosition(randomPointInQuad(quad)),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [quad, intervalMs, billboardPosition]);

  const svgSize = Math.min(width, height) * svgScale;

  return (
    <group>
      {debug && <DebugQuad quad={quad} color={debugColor} />}

      {/* Connector line — drawn outside Billboard so it lives in world space */}
      {lineAnchor && (
        <ConnectorLine
          anchor={lineAnchor}
          billboardPos={position}
          width={width}
          height={height}
          side={lineAttachment}
          color={lineColor}
          lineWidth={lineWidth}
          renderOrder={renderOrder + 3}
          progress={progress} // ← pass through
          progressMode={progressMode} // ← pass through
          divider={divider} // ← pass through
        />
      )}

      <Billboard
        position={position}
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
        renderOrder={renderOrder}
        ref={billboardRef}
      >
        {/* 1 — White semi-transparent background */}
        <mesh renderOrder={renderOrder}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            color="#000000"
            opacity={0.7}
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
        <CrossLayer size={svgSize} renderOrder={renderOrder} />
      </Billboard>
    </group>
  );
}
