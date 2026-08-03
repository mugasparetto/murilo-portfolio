import { useRef, useCallback, useMemo } from "react";
import * as THREE from "three";
import { Text, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

interface CircularTextProps {
  text: string;
  radius?: number;
  fontSize?: number;
  font?: string;
  color?: THREE.ColorRepresentation;
  spinDuration?: number;
  onHover?: "slowDown" | "speedUp" | "pause" | "goBonkers";
  position?: [number, number, number];
  centerImage?: string;
  centerImageSize?: number;
}

/** How each hover mode maps onto the base spin. */
const HOVER_STATES: Record<
  NonNullable<CircularTextProps["onHover"]>,
  { timeScale: number; scale: number }
> = {
  slowDown: { timeScale: 0.5, scale: 1 },
  speedUp: { timeScale: 4, scale: 1 },
  pause: { timeScale: 0, scale: 1 },
  goBonkers: { timeScale: 20, scale: 0.8 },
};

/** Critically-underdamped spring approximating GSAP's elastic.out(1, 0.75) bounce. */
const SCALE_SPRING = { stiffness: 170, damping: 12 };
/** Exponential decay rate for the timeScale ramp — ~95% of the way there in 0.6s, like power2.out. */
const RAMP_LAMBDA = 5;

const CircularText: React.FC<CircularTextProps> = ({
  text,
  radius = 100,
  fontSize = 24,
  font = "/fonts/PPMonumentNormal-Regular.ttf",
  color = "white",
  spinDuration = 20,
  onHover = "speedUp",
  position = [0, 0, 0],
  centerImage = "textures/star.webp",
  centerImageSize = fontSize * 2,
}) => {
  const letters = useMemo(() => Array.from(text), [text]);
  const groupRef = useRef<THREE.Group>(null);
  const centerTexture = useTexture(centerImage);

  // Current + target values driven by useFrame, so hover just retargets them.
  const timeScaleRef = useRef(1);
  const targetTimeScaleRef = useRef(1);
  const scaleRef = useRef(1);
  const targetScaleRef = useRef(1);
  const scaleVelocityRef = useRef(0);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    timeScaleRef.current = THREE.MathUtils.damp(
      timeScaleRef.current,
      targetTimeScaleRef.current,
      RAMP_LAMBDA,
      delta,
    );

    // Three's +Z rotation reads counter-clockwise on screen, the opposite of
    // CSS's clockwise spin, so go negative to keep the same spin direction.
    group.rotation.z -=
      ((Math.PI * 2) / spinDuration) * timeScaleRef.current * delta;

    // Semi-implicit Euler spring integration for the elastic hover scale.
    const displacement = scaleRef.current - targetScaleRef.current;
    const acceleration =
      -SCALE_SPRING.stiffness * displacement -
      SCALE_SPRING.damping * scaleVelocityRef.current;
    scaleVelocityRef.current += acceleration * delta;
    scaleRef.current += scaleVelocityRef.current * delta;
    group.scale.setScalar(scaleRef.current);
  });

  const applyState = useCallback((timeScale: number, scale: number) => {
    targetTimeScaleRef.current = timeScale;
    targetScaleRef.current = scale;
  }, []);

  const handlePointerOver = useCallback(() => {
    if (!onHover) return;
    const { timeScale, scale } = HOVER_STATES[onHover] ?? {
      timeScale: 1,
      scale: 1,
    };
    applyState(timeScale, scale);
  }, [onHover, applyState]);

  const handlePointerOut = useCallback(() => applyState(1, 1), [applyState]);

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* Invisible hit area so hovering anywhere inside the circle (not just
          on a glyph) triggers the effect, matching the original's full-box div. */}
      <mesh>
        <circleGeometry args={[radius + fontSize, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <sprite scale={[centerImageSize, centerImageSize, 1]}>
        <spriteMaterial map={centerTexture} transparent depthWrite={false} />
      </sprite>

      {letters.map((letter, i) => {
        const angle = (i / letters.length) * Math.PI * 2;

        return (
          <group key={i} rotation={[0, 0, -angle]}>
            <Text
              position={[0, radius, 0]}
              fontSize={fontSize}
              font={font}
              color={color}
              anchorX="center"
              anchorY="top"
            >
              {letter}
            </Text>
          </group>
        );
      })}
    </group>
  );
};

export default CircularText;
