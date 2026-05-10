import { RefObject, useMemo, useState, useCallback, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useTexture, Line } from "@react-three/drei";
import MetaBalls from "./MetaBalls";
import PolygonSprite, { UV, SpriteHandle } from "./PolygonSprite";

type DiskProps = {
  radius: number;
  position: [number, number, number];
  scale: [number, number, number];
  thickness: number;
};

function HalfCircleWithDisk({ radius, position, scale, thickness }: DiskProps) {
  const segments = 100;

  const points = useMemo(() => {
    const curve = new THREE.ArcCurve(0, 0, radius, Math.PI, 0, false);
    return curve.getPoints(segments);
  }, [radius]);

  return (
    <group position={position} scale={scale}>
      {/* Black disk */}
      <mesh position={[0, 0, -1.8]}>
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial color="black" />
      </mesh>

      {/* Thick white arc */}
      <Line
        points={points}
        color="white"
        lineWidth={thickness} // thickness (in pixels)
        rotation={[0, 0, Math.PI]}
      />
    </group>
  );
}

const HEAD_POLYGON: UV[] = [
  [0.03, 0.73],
  [0.45, 0.71],
  [1, 0.72],
  [0.95, 0.84],
  [0.75, 0.96],
  [0.55, 1],
  [0.35, 0.98],
  [0.12, 0.9],
];

const EYES_POLYGON: UV[] = [
  [0.01, 0.45],
  [0.5, 0.425],
  [0.98, 0.45],
  [1, 0.67],
  [0.04, 0.67],
];

const MOUTH_POLYGON: UV[] = [
  [0.4, 0.01],
  [0.8, 0.02], // top-right
  [0.97, 0.2], // bottom-right
  [0.99, 0.38], // top-right
  [0.02, 0.38], // top-left
  [0.1, 0.15],
];

// ── SAT Helpers ───────────────────────────────────────────────────────────────

function getAxes(poly: THREE.Vector2[]): THREE.Vector2[] {
  const axes: THREE.Vector2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const edge = new THREE.Vector2(b.x - a.x, b.y - a.y);
    // Perpendicular (normal) to the edge
    axes.push(new THREE.Vector2(-edge.y, edge.x).normalize());
  }
  return axes;
}

function projectPolygon(axis: THREE.Vector2, poly: THREE.Vector2[]) {
  let min = Infinity,
    max = -Infinity;
  for (const v of poly) {
    const p = axis.dot(v);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

/**
 * Returns null if no collision, or { depth, axis } (MTV) if overlapping.
 * axis points from polyA toward polyB.
 */
function satCollide(
  polyA: THREE.Vector2[],
  polyB: THREE.Vector2[],
): { depth: number; axis: THREE.Vector2 } | null {
  let minDepth = Infinity;
  const minAxis = new THREE.Vector2();

  const axes = [...getAxes(polyA), ...getAxes(polyB)];

  for (const axis of axes) {
    const a = projectPolygon(axis, polyA);
    const b = projectPolygon(axis, polyB);
    const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
    if (overlap <= 0) return null; // Separating axis found — no collision
    if (overlap < minDepth) {
      minDepth = overlap;
      minAxis.copy(axis);
    }
  }

  // Ensure axis points from A to B
  const centreA = polyA
    .reduce((s, v) => s.add(v), new THREE.Vector2())
    .divideScalar(polyA.length);
  const centreB = polyB
    .reduce((s, v) => s.add(v), new THREE.Vector2())
    .divideScalar(polyB.length);
  if (
    minAxis.dot(
      new THREE.Vector2(centreB.x - centreA.x, centreB.y - centreA.y),
    ) < 0
  ) {
    minAxis.negate();
  }

  return { depth: minDepth, axis: minAxis };
}

function clampToBounds(sprite: SpriteHandle) {
  const box = sprite.getCentreBox();
  if (!box) return;
  const pos = sprite.getPosition();
  pos.clamp(box.min, box.max);
  sprite.setPosition(pos);
}

type Props = {
  ref: RefObject<THREE.Group | null>;
  onGrabbing: (payload: null | "head" | "eyes" | "mouth") => void;
  hideBillboard: (payload: "head" | "eyes" | "mouth") => void;
};

export default function Head({ ref, onGrabbing, hideBillboard }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  const headRef = useRef<SpriteHandle>(null);
  const eyesRef = useRef<SpriteHandle>(null);
  const mouthRef = useRef<SpriteHandle>(null);

  const metaBallsHeadFront = useRef<THREE.Mesh>(null);
  const metaBallsHeadBack = useRef<THREE.Mesh>(null);
  const metaBallsMouthFront = useRef<THREE.Mesh>(null);
  const metaBallsMouthBack = useRef<THREE.Mesh>(null);

  const [pause, setPause] = useState<null | "head" | "eyes" | "mouth">(null);

  const scale = useMemo<[number, number, number]>(() => {
    const size = 500;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  const handleGrab = useCallback(
    (payload: null | "head" | "eyes" | "mouth") => {
      onGrabbing(payload);
      setPause(payload);
    },
    [onGrabbing],
  );

  useFrame(() => {
    const sprites = [headRef.current, eyesRef.current, mouthRef.current];

    for (let i = 0; i < sprites.length; i++) {
      for (let j = i + 1; j < sprites.length; j++) {
        const a = sprites[i];
        const b = sprites[j];
        if (!a || !b) continue;

        const polyA = a.getWorldPolygon();
        const polyB = b.getWorldPolygon();
        const result = satCollide(polyA, polyB);
        if (!result) continue;

        const { depth, axis } = result;
        const ax2 = new THREE.Vector2(axis.x, axis.y);

        const aDragging = a.isDragging();
        const bDragging = b.isDragging();

        if (!aDragging && !bDragging) {
          const posA = a.getPosition();
          const posB = b.getPosition();
          posA.x -= ax2.x * depth * 0.5;
          posA.y -= ax2.y * depth * 0.5;
          posB.x += ax2.x * depth * 0.5;
          posB.y += ax2.y * depth * 0.5;
          a.setPosition(posA);
          b.setPosition(posB);
          clampToBounds(a); // ← clamp after push
          clampToBounds(b); // ← clamp after push
        } else if (aDragging) {
          const posB = b.getPosition();
          posB.x += ax2.x * depth;
          posB.y += ax2.y * depth;
          b.setPosition(posB);
          clampToBounds(b); // ← clamp after push
        } else {
          const posA = a.getPosition();
          posA.x -= ax2.x * depth;
          posA.y -= ax2.y * depth;
          a.setPosition(posA);
          clampToBounds(a); // ← clamp after push
        }

        // Velocity reflection — unchanged
        const velA = a.getVelocity();
        const velB = b.getVelocity();
        const relVel = new THREE.Vector2(velA.x - velB.x, velA.y - velB.y);
        const impactSpeed = relVel.dot(ax2);
        if (impactSpeed < 0) continue;

        if (!aDragging) {
          velA.x -= impactSpeed * ax2.x;
          velA.y -= impactSpeed * ax2.y;
          a.setVelocity(velA);
        }
        if (!bDragging) {
          velB.x += impactSpeed * ax2.x;
          velB.y += impactSpeed * ax2.y;
          b.setVelocity(velB);
        }
      }
    }
  });

  useFrame(() => {
    const initalPos = new THREE.Vector3(0, -800, 2600);

    if (
      headRef.current &&
      metaBallsHeadFront.current &&
      metaBallsHeadBack.current
    ) {
      if (headRef.current.getPosition().distanceTo(initalPos) > 2) {
        metaBallsHeadFront.current.visible = false;
        metaBallsHeadBack.current.visible = false;
        hideBillboard("head");
      }
    }

    if (
      eyesRef.current &&
      metaBallsHeadFront.current &&
      metaBallsHeadBack.current &&
      metaBallsMouthFront.current &&
      metaBallsMouthBack.current
    ) {
      if (eyesRef.current.getPosition().distanceTo(initalPos) > 2) {
        metaBallsHeadFront.current.visible = false;
        metaBallsHeadBack.current.visible = false;
        metaBallsMouthFront.current.visible = false;
        metaBallsMouthBack.current.visible = false;
        hideBillboard("eyes");
      }
    }

    if (
      mouthRef.current &&
      metaBallsMouthFront.current &&
      metaBallsMouthBack.current
    ) {
      if (mouthRef.current.getPosition().distanceTo(initalPos) > 4) {
        metaBallsMouthFront.current.visible = false;
        metaBallsMouthBack.current.visible = false;
        hideBillboard("mouth");
      }
    }
  });

  return (
    <group ref={ref}>
      <PolygonSprite
        texture={top}
        polygon={HEAD_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        // debug
        ref={headRef}
        draggable
        throwable
        bounds={{ min: [-550, -1100, 2559], max: [550, -500, 2601] }}
        onPointerDown={() => {
          handleGrab("head");
        }}
        onPointerUp={() => {
          handleGrab(null);
        }}
      />

      <MetaBalls
        ref={metaBallsHeadBack}
        position={[12, -630, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        animationSize={40}
        renderOrder={5}
        ballCount={12}
        clumpFactor={0.6}
        pauseTarget={
          pause === "head" ? "top" : pause === "eyes" ? "bottom" : null
        }
        seed={5}
        anchors={[
          {
            x: -1.5,
            y: -7.25,
            radius: 16,
            roundness: 0.6,
            yScale: 0.1,
          },
          {
            x: -1,
            y: -17,
            radius: 16,
            roundness: 0.6,
            yScale: 0.1,
          },
        ]}
      />

      <MetaBalls
        ref={metaBallsHeadFront}
        position={[12, -630, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        animationSize={40}
        seed={10}
        ballCount={16}
        clumpFactor={0.85}
        pauseTarget={
          pause === "head" ? "top" : pause === "eyes" ? "bottom" : null
        }
        anchors={[
          {
            x: -1.5,
            y: -7.25,
            radius: 15,
            roundness: 0.6,
            yScale: 0.1,
          },
          {
            x: -1,
            y: -17,
            radius: 15,
            roundness: 0.6,
            yScale: 0.1,
          },
        ]}
      />

      <PolygonSprite
        texture={middle}
        polygon={EYES_POLYGON}
        position={[0, -800, 2602]}
        scale={scale}
        // debug
        draggable
        ref={eyesRef}
        throwable
        bounds={{ min: [-550, -1100, 2559], max: [550, -500, 2603] }}
        onPointerDown={() => handleGrab("eyes")}
        onPointerUp={() => handleGrab(null)}
      >
        <HalfCircleWithDisk
          radius={122}
          position={[5, 82, 1]}
          scale={[1, 0.1, 1]}
          thickness={2}
        />
      </PolygonSprite>

      <MetaBalls
        ref={metaBallsMouthFront}
        position={[10, -830, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        seed={7}
        animationSize={40}
        pauseTarget={
          pause === "mouth" ? "bottom" : pause === "eyes" ? "top" : null
        }
        pauseYOffset={6}
        ballCount={18}
        anchors={[
          { x: -1.5, y: 1.5, radius: 15, roundness: 0.6, yScale: 0.1 },
          {
            x: -0.95,
            y: -6,
            radius: 15,
            roundness: 0.6,
            yScale: 0.05,
          },
        ]}
      />

      <MetaBalls
        ref={metaBallsMouthBack}
        position={[10, -830, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        seed={12}
        animationSize={40}
        renderOrder={5}
        pauseTarget={
          pause === "mouth" ? "bottom" : pause === "eyes" ? "top" : null
        }
        pauseYOffset={pause === "mouth" ? 9 : 6}
        ballCount={18}
        anchors={[
          {
            x: -1.5,
            y: 1.5,
            radius: 15,
            roundness: 0.6,
            yScale: 0.1,
          },
          {
            x: -0.95,
            y: -6,
            radius: 15,
            roundness: 0.6,
            yScale: 0.05,
          },
        ]}
      />

      <PolygonSprite
        texture={bottom}
        polygon={MOUTH_POLYGON}
        position={[0, -800, 2604]}
        scale={scale}
        // debug
        draggable
        throwable
        ref={mouthRef}
        bounds={{ min: [-550, -1100, 2559], max: [550, -500, 2605] }}
        onPointerDown={() => handleGrab("mouth")}
        onPointerUp={() => handleGrab(null)}
      >
        <HalfCircleWithDisk
          radius={122}
          position={[1, -58, -5]}
          scale={[1, 0.1, 1]}
          thickness={2}
        />
      </PolygonSprite>
    </group>
  );
}
