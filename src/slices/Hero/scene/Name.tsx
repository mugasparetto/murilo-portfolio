import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text, Html } from "@react-three/drei";
import { KeyTextField } from "@prismicio/client";

import { useBreakpoints, BREAKPOINTS } from "@/app/hooks/breakpoints";
import { lockToScreen } from "@/app/components/ParallaxRig";

export const NAME_LAYER = 15;

type Props = {
  firstName: KeyTextField;
  lastName: KeyTextField;
};

type Tier = keyof typeof BREAKPOINTS;

type ReflectionProperties = {
  // vertical offset from the main text's baseline, one entry per stacked copy
  gap: number[];
  strokeWidth: number;
  // percentage (0-1) of the glyph height shown, measured up from the
  // baseline, one entry per stacked copy
  reveal: number[];
};

type NameProperties = {
  position: { x: number; y: number };
  portal: { x: number; y: number; scaleY: number };
  fontSize: number;
  offset: number;
  planeConstant: number;
  reflection: ReflectionProperties;
};

const RESPONSIVE: Record<Tier, NameProperties> = {
  md: {
    position: { x: -1310, y: 2600 },
    fontSize: 1300,
    offset: 2500,
    planeConstant: -320,
    portal: { x: -300, y: 3600, scaleY: 1850 },
    reflection: {
      gap: [600, 1200, 1800],
      strokeWidth: 4,
      reveal: [0.75, 0.5, 0.25],
    },
  },
  lg: {
    position: { x: -1660, y: 2500 },
    fontSize: 1650,
    offset: 2550,
    planeConstant: -380,
    portal: { x: -360, y: 3650, scaleY: 1850 },
    reflection: {
      gap: [750, 1500, 2250],
      strokeWidth: 5,
      reveal: [0.75, 0.5, 0.25],
    },
  },
  xl: {
    position: { x: -1900, y: 2450 },
    fontSize: 2000,
    offset: 3250,
    planeConstant: -200,
    portal: { x: -180, y: 3750, scaleY: 1850 },
    reflection: {
      gap: [900, 1800, 2700],
      strokeWidth: 6,
      reveal: [0.75, 0.5, 0.25],
    },
  },
  "2xl": {
    position: { x: 0, y: 2250 },
    fontSize: 430,
    offset: 3250,
    planeConstant: -200,
    portal: { x: -180, y: 3750, scaleY: 1850 },
    reflection: {
      gap: [280, 490, 610],
      strokeWidth: 12,
      reveal: [0.75, 0.5, 0.22],
    },
  },
};

const REFLECTION_MAX = Math.max(
  ...Object.values(RESPONSIVE).map((r) => r.reflection.reveal.length),
);

export default function Name({ firstName = "", lastName = "" }: Props) {
  const { camera, gl } = useThree();

  const textRef = useRef<THREE.Mesh | null>(null);
  const anchorRefs = useRef<(THREE.Object3D | null)[]>([]);

  const clipPlanes = useMemo(
    () => Array.from({ length: REFLECTION_MAX }, () => new THREE.Plane()),
    [],
  );

  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useFrame(() => {
    if (textRef.current) lockToScreen(textRef.current, camera);
    textRef.current?.traverse((obj) => obj.layers.set(NAME_LAYER));

    anchorRefs.current.forEach((anchor, i) => {
      if (!anchor) return;
      const point = new THREE.Vector3();
      // points below the anchor (in -Y) keep a positive distance and stay
      // visible; points above it (toward the real text) get clipped away
      const normal = new THREE.Vector3(0, -1, 0);
      const rotation = new THREE.Quaternion();
      anchor.getWorldPosition(point);
      anchor.getWorldQuaternion(rotation);
      normal.applyQuaternion(rotation);
      clipPlanes[i]?.setFromNormalAndCoplanarPoint(normal, point);
    });
  });

  const { up, tier } = useBreakpoints(
    Object.assign(BREAKPOINTS, { ["xs"]: "23.5rem" }),
    { defaultTier: "xl" },
  );

  const props = RESPONSIVE[tier] ?? RESPONSIVE.xl;
  const { reflection } = props;

  return (
    <>
      {!up.md ? (
        <Html
          fullscreen
          wrapperClass="fixed!"
          position={[0, !up.xs ? 650 : 570, 0]}
          className="px-5! lg:px-0! font-display text-8xl relative leading-22 max-w-100 left-[50%]! translate-x-[-50%]"
        >
          <div className="bg-white absolute w-1 h-19 left-39.25 -top-3 z-50" />
          <div className="bg-white absolute w-1 h-19 left-64 top-16 z-50" />
          <div className="reveal absolute -top-4 left-5">
            <h1 className="reveal__text">{firstName}</h1>
          </div>

          <div className="reveal absolute top-15 left-5">
            <h1 className="reveal__text">{lastName}</h1>
          </div>
        </Html>
      ) : (
        <>
          <group ref={textRef}>
            <Text
              renderOrder={1}
              position={[
                RESPONSIVE[tier]?.position.x,
                RESPONSIVE[tier]?.position.y,
                -1500,
              ]}
              font="/fonts/PPMonumentExtended-Black.ttf"
              fontSize={RESPONSIVE[tier]?.fontSize}
              color="white"
              material-clipIntersection={true}
              material-stencilWrite={true}
              material-stencilRef={1}
              material-stencilFunc={THREE.NotEqualStencilFunc}
              material-stencilFail={THREE.KeepStencilOp}
              material-stencilZFail={THREE.KeepStencilOp}
              material-stencilZPass={THREE.KeepStencilOp}
            >
              {firstName} {lastName}
            </Text>

            {reflection.reveal.map((percent, i) => {
              const y = props.position.y - reflection.gap[i];

              return (
                <group key={i} position={[props.position.x, y, -1500]}>
                  <Text
                    renderOrder={1}
                    font="/fonts/PPMonumentExtended-Black.ttf"
                    fontSize={props.fontSize}
                    fillOpacity={0}
                    strokeWidth={reflection.strokeWidth}
                    strokeColor="white"
                    material-clippingPlanes={[clipPlanes[i]]}
                    material-clipIntersection={false}
                    material-stencilWrite={true}
                    material-stencilRef={1}
                    material-stencilFunc={THREE.NotEqualStencilFunc}
                    material-stencilFail={THREE.KeepStencilOp}
                    material-stencilZFail={THREE.KeepStencilOp}
                    material-stencilZPass={THREE.KeepStencilOp}
                    onSync={(troikaMesh) => {
                      // measure the actual glyph bounds so `percent` maps to
                      // the real letter height, not a guessed offset
                      const bounds = (
                        troikaMesh as unknown as {
                          textRenderInfo?: { visibleBounds: number[] };
                        }
                      ).textRenderInfo?.visibleBounds;
                      const anchor = anchorRefs.current[i];
                      if (!bounds || !anchor) return;

                      const [, minY, , maxY] = bounds;
                      anchor.position.y = minY + percent * (maxY - minY);
                    }}
                  >
                    {firstName} {lastName}
                  </Text>
                  <object3D
                    ref={(el) => {
                      anchorRefs.current[i] = el;
                    }}
                  />
                </group>
              );
            })}
          </group>
        </>
      )}
    </>
  );
}
