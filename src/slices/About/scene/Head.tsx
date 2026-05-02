import { RefObject, useMemo } from "react";
import * as THREE from "three";
import { useTexture, Line } from "@react-three/drei";
import MetaBalls from "./MetaBalls";

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

type Props = {
  ref: RefObject<THREE.Group | null>;
};

export default function Head({ ref }: Props) {
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
      <sprite position={[0, -800, 2600]} scale={scale} renderOrder={10}>
        <spriteMaterial
          map={top}
          transparent
          depthWrite={false}
          // opacity={0.5}
        />
      </sprite>

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

      <sprite position={[0, -800, 2600]} scale={scale} renderOrder={10}>
        <spriteMaterial
          map={middle}
          transparent
          depthWrite={false}
          // opacity={0.5}
        />
      </sprite>

      <HalfCircleWithDisk
        radius={122}
        position={[5, -718, 2595]}
        scale={[1, 0.1, 1]}
        thickness={4}
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

      <sprite position={[0, -800, 2600]} scale={scale} renderOrder={999}>
        <spriteMaterial
          map={bottom}
          transparent
          depthWrite={false}
          // opacity={0.5}
        />
      </sprite>

      <HalfCircleWithDisk
        radius={122}
        position={[1, -858, 2595]}
        scale={[1, 0.1, 1]}
        thickness={4}
      />
    </group>
  );
}
