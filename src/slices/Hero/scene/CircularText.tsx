import { useRef, useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";

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
  /** Square canvas size the ring is baked into. Power of two. */
  resolution?: number;
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

const FALLBACK_FAMILY = "sans-serif";

/** One FontFace per URL, shared across every instance and remount. */
const fontFamilyCache = new Map<string, Promise<string>>();

function loadFontFamily(src: string): Promise<string> {
  // Already a family name rather than a URL — hand it straight to the canvas.
  if (!/[/.]/.test(src)) return Promise.resolve(src);

  let pending = fontFamilyCache.get(src);
  if (!pending) {
    const family = `CircularText-${src.replace(/[^\w-]/g, "_")}`;
    pending = new FontFace(family, `url(${JSON.stringify(src)})`)
      .load()
      .then((face) => {
        document.fonts.add(face);
        return family;
      })
      .catch((error) => {
        console.warn(`CircularText: could not load font "${src}"`, error);
        return FALLBACK_FAMILY;
      });
    fontFamilyCache.set(src, pending);
  }
  return pending;
}

/**
 * Draws the ring of glyphs into a canvas using the same polar layout the
 * per-letter meshes used to: letter `i` sits `i/len` of a turn clockwise from
 * the top, with its top edge on the circle and the glyph growing inward.
 */
function drawRing(
  canvas: HTMLCanvasElement,
  {
    text,
    radius,
    fontSize,
    family,
    extent,
  }: {
    text: string;
    radius: number;
    fontSize: number;
    family: string;
    extent: number;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const letters = Array.from(text);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  // Work in world units from here on, origin at the ring's centre. Canvas Y
  // points down, which flips handedness — so a positive rotation here reads
  // clockwise on screen, matching Three's negative-Z rotation.
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(canvas.width / (2 * extent), canvas.height / (2 * extent));

  ctx.font = `${fontSize}px "${family}"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  letters.forEach((letter, i) => {
    ctx.save();
    ctx.rotate((i / letters.length) * Math.PI * 2);
    ctx.fillText(letter, 0, -radius);
    ctx.restore();
  });

  ctx.restore();
}

const CircularText: React.FC<CircularTextProps> = ({
  text,
  radius = 100,
  fontSize = 24,
  font = "/fonts/PPMonumentNormal-Regular.woff2",
  color = "white",
  spinDuration = 20,
  onHover = "speedUp",
  position = [0, 0, 0],
  centerImage = "/textures/star.webp",
  centerImageSize = fontSize * 2,
  resolution = 1024,
}) => {
  const { gl } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const centerTexture = useTexture(centerImage);

  // Half-width of the baked quad — the outermost glyph edge sits on `radius`,
  // the extra `fontSize` is the same padding the hit area always used.
  const extent = radius + fontSize;

  const [family, setFamily] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFontFamily(font).then((loaded) => {
      if (!cancelled) setFamily(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [font]);

  // The whole ring is one texture, so the 31 troika text meshes this used to
  // spawn collapse into a single draw call — which matters double here, since
  // NameLayerOverlay renders the scene more than once per frame.
  const ringTexture = useMemo(() => {
    if (!family) return null;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = resolution;
    drawRing(canvas, { text, radius, fontSize, family, extent });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    return texture;
  }, [family, text, radius, fontSize, extent, resolution, gl]);

  useEffect(() => () => ringTexture?.dispose(), [ringTexture]);

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
    <group ref={groupRef} position={position}>
      {/* Hit area for the whole circle, not just the glyphs. The handlers live
          here rather than on the group because R3F raycasts an interactive
          object's descendants too — keeping them off the group means the ring
          and the sprite are never tested on pointermove. `material.visible`
          skips the draw while leaving the mesh raycastable. */}
      <mesh onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <circleGeometry args={[extent, 32]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {ringTexture && (
        <mesh>
          <planeGeometry args={[extent * 2, extent * 2]} />
          <meshBasicMaterial
            map={ringTexture}
            color={color}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}

      <sprite scale={[centerImageSize, centerImageSize, 1]}>
        <spriteMaterial map={centerTexture} transparent depthWrite={false} />
      </sprite>
    </group>
  );
};

export default CircularText;
