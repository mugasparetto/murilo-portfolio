import { RefObject, useMemo } from "react";
import * as THREE from "three";
import { useTexture, Line } from "@react-three/drei";
import MetaBalls from "./MetaBalls";
import PolygonSprite, { UV } from "./PolygonSprite";

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

type Props = {
  ref: RefObject<THREE.Group | null>;
  onGrabbing: (payload: null | "head" | "eyes" | "mouth") => void;
};

export default function Head({ ref, onGrabbing }: Props) {
  const bottom = useTexture("/textures/head/bottom.webp");
  const middle = useTexture("/textures/head/middle.webp");
  const top = useTexture("/textures/head/top.webp");

  const scale = useMemo<[number, number, number]>(() => {
    const size = 500;
    const img = bottom.image as HTMLImageElement;
    const aspect = img.naturalWidth / img.naturalHeight;
    return [size * aspect, size, 1];
  }, [bottom]);

  return (
    <group ref={ref}>
      <PolygonSprite
        texture={top}
        polygon={HEAD_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        // debug
        onPointerDown={() => onGrabbing("head")}
        onPointerUp={() => onGrabbing(null)}
      />

      <MetaBalls
        position={[12, -630, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        animationSize={40}
        renderOrder={5}
        ballCount={12}
        clumpFactor={0.6}
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
        position={[12, -630, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        animationSize={40}
        seed={10}
        ballCount={16}
        clumpFactor={0.85}
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
        position={[0, -800, 2600]}
        scale={scale}
        // debug
        onPointerDown={() => onGrabbing("eyes")}
        onPointerUp={() => onGrabbing(null)}
      />

      <HalfCircleWithDisk
        radius={122}
        position={[5, -718, 2595]}
        scale={[1, 0.1, 1]}
        thickness={2}
      />

      <MetaBalls
        position={[10, -830, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        seed={7}
        animationSize={40}
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
        position={[10, -830, 2605]}
        scale={[280, 280, 1]}
        enableTransparency
        seed={12}
        animationSize={40}
        renderOrder={5}
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
            y: -5.85,
            radius: 15,
            roundness: 0.6,
            yScale: 0.05,
          },
        ]}
      />

      <PolygonSprite
        texture={bottom}
        polygon={MOUTH_POLYGON}
        position={[0, -800, 2600]}
        scale={scale}
        // debug
        onPointerDown={() => onGrabbing("mouth")}
        onPointerUp={() => onGrabbing(null)}
      />

      <HalfCircleWithDisk
        radius={122}
        position={[1, -858, 2595]}
        scale={[1, 0.1, 1]}
        thickness={2}
      />
    </group>
  );
}
