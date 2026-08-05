import { Fragment, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { Html, Text } from "@react-three/drei";
import * as THREE from "three";
import { KeyTextField } from "@prismicio/client";
import { useBreakpoints, BREAKPOINTS } from "@/app/hooks/breakpoints";
import { lockToScreen } from "@/app/components/ParallaxRig";

type Props = {
  tagline: KeyTextField;
  description: KeyTextField;
};

type Tier = keyof typeof BREAKPOINTS;

const RESPONSIVE: Record<
  Tier,
  {
    position: { x: number; y: number };
    fontSize: number;
  }
> = {
  md: {
    position: { x: -3000, y: 2400 },
    fontSize: 200,
  },
  lg: {
    position: { x: -3400, y: 2255 },
    fontSize: 200,
  },
  xl: {
    position: { x: -3660, y: 2150 },
    fontSize: 200,
  },
  "2xl": {
    position: { x: -2400, y: 1270 },
    fontSize: 120,
  },
};

export default function Headline({ tagline = "", description = "" }: Props) {
  const { up, tier } = useBreakpoints(BREAKPOINTS);
  const { camera } = useThree();
  const textRef = useRef<THREE.Mesh | null>(null);

  useFrame(() => {
    if (textRef.current) lockToScreen(textRef.current, camera);
  });

  return (
    // <Html
    //   // fullscreen={!up.md}
    //   // transform
    //   distanceFactor={4000}
    //   wrapperClass="fixed!"
    //   position={[-1600, 1000, -9700]}
    //   className="w-[22rem] md:w-[16rem] xl:w-[38rem] opacity-75 md:opacity-100 px-5! md:px-0! left-[50%]! md:left-0! translate-x-[-50%] md:translate-x-0 select-none"
    // >
    //   <div className="flex flex-col pointer-events-none">
    //     <span className="font-display font-bold text-white uppercase md:text-xl xl:text-3xl text-lg relative flex items-center gap-4 md:gap-6">
    //       {tagline?.split(" ").map((word, i, words) => (
    //         <Fragment key={i}>
    //           <span>{word}</span>
    //           {i < words.length - 1 && (
    //             <span className="h-[2px] flex-1 min-w-6 md:min-w-12 bg-white" />
    //           )}
    //         </Fragment>
    //       ))}
    //     </span>
    //     <span
    //       className="uppercase xl:w-[32rem] text-white/90 text-sm md:text-sm xl:text-base"
    //       style={{ letterSpacing: !up.md ? -0.2 : undefined }}
    //     >
    //       {description}
    //     </span>
    //   </div>
    // </Html>
    <group ref={textRef}>
      <Text
        position={[
          RESPONSIVE[tier]?.position.x,
          RESPONSIVE[tier]?.position.y,
          -1500,
        ]}
        font="/fonts/PPMonumentExtended-Black.ttf"
        fontSize={RESPONSIVE[tier]?.fontSize}
        color="white"
        material-clipIntersection={true}
      >
        {tagline?.toUpperCase()}
      </Text>
      <Text
        position={[
          RESPONSIVE[tier]?.position.x + 270,
          RESPONSIVE[tier]?.position.y - 200,
          -1500,
        ]}
        font="/fonts/PPMonumentNormal-Regular.ttf"
        fontSize={RESPONSIVE[tier]?.fontSize - 50}
        color="white"
        maxWidth={RESPONSIVE[tier]?.fontSize * 20}
        textAlign="left"
      >
        {description?.toUpperCase()}
      </Text>
    </group>
  );
}
