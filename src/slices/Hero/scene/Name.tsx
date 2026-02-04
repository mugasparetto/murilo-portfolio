import { useRef, useMemo, RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text, useHelper, Html } from "@react-three/drei";
import { KeyTextField } from "@prismicio/client";

import { segmentProgress, makeRanges } from "@/app/helpers/scroll";
import { useBreakpoints, BREAKPOINTS } from "@/app/hooks/breakpoints";

import {
  VhWindow,
  useScrollVhAbsolute,
  progressInVhWindow,
} from "@/app/helpers/scroll"; // <- adjust path

type Props = {
  firstName: KeyTextField;
  lastName: KeyTextField;

  scrollWindow: VhWindow;
  scrollContainerRef?: RefObject<HTMLElement | null>;
};

type Tier = keyof typeof BREAKPOINTS;

type NameProperties = {
  position: { x: number; y: number };
  portal: { x: number; y: number; scaleY: number };
  fontSize: number;
  offset: number;
  planeConstant: number;
};

const RESPONSIVE: Record<
  Tier,
  {
    firstName: NameProperties;
    lastName: NameProperties;
  }
> = {
  md: {
    firstName: {
      position: { x: -1310, y: 2600 },
      fontSize: 1300,
      offset: 2500,
      planeConstant: -320,
      portal: { x: -300, y: 3600, scaleY: 1850 },
    },
    lastName: {
      position: { x: 1600, y: 600 },
      fontSize: 1300,
      offset: -3400,
      planeConstant: 100,
      portal: { x: -130, y: 1600, scaleY: 1400 },
    },
  },
  lg: {
    firstName: {
      position: { x: -1660, y: 2500 },
      fontSize: 1650,
      offset: 2550,
      planeConstant: -380,
      portal: { x: -360, y: 3650, scaleY: 1850 },
    },
    lastName: {
      position: { x: 2100, y: 750 },
      fontSize: 1650,
      offset: -4350,
      planeConstant: 100,
      portal: { x: -130, y: 1750, scaleY: 1550 },
    },
  },
  xl: {
    firstName: {
      position: { x: -1900, y: 2450 },
      fontSize: 2000,
      offset: 3250,
      planeConstant: -200,
      portal: { x: -180, y: 3750, scaleY: 1850 },
    },
    lastName: {
      position: { x: 2450, y: 820 },
      fontSize: 2000,
      offset: -5100,
      planeConstant: 100,
      portal: { x: -130, y: 1850, scaleY: 1850 },
    },
  },
  "2xl": {
    firstName: {
      position: { x: -1900, y: 2450 },
      fontSize: 2000,
      offset: 3250,
      planeConstant: -200,
      portal: { x: -180, y: 3750, scaleY: 1850 },
    },
    lastName: {
      position: { x: 2450, y: 820 },
      fontSize: 2000,
      offset: -5100,
      planeConstant: 100,
      portal: { x: -130, y: 1850, scaleY: 1850 },
    },
  },
};

export default function Name({
  firstName = "",
  lastName = "",
  scrollWindow,
  scrollContainerRef,
}: Props) {
  const { camera } = useThree();

  const scrollVh = useScrollVhAbsolute(scrollContainerRef);

  const textRef = useRef<THREE.Mesh | null>(null);
  const firstNameRef = useRef<THREE.Mesh | null>(null);
  const lastNameRef = useRef<THREE.Mesh | null>(null);
  const portalFirstNameRef = useRef<THREE.Mesh | null>(null);
  const portalLastNameRef = useRef<THREE.Mesh | null>(null);
  const firstNameHtml = useRef<HTMLHeadingElement | null>(null);
  const lastNameHtml = useRef<HTMLHeadingElement | null>(null);
  const portalFirstNameHtml = useRef<HTMLDivElement | null>(null);
  const portalLastNameHtml = useRef<HTMLDivElement | null>(null);

  useFrame(() => {
    const q = camera.quaternion;
    textRef.current?.quaternion.copy(q);
  });

  const { up, tier } = useBreakpoints(
    Object.assign(BREAKPOINTS, { ["xs"]: "23.5rem" }),
    { defaultTier: "xl" },
  );

  const PHASE_WEIGHTS = [0.2, 0.6, 0.2];
  const PHASES = makeRanges(PHASE_WEIGHTS);

  useFrame(() => {
    const t = progressInVhWindow(scrollVh.current, scrollWindow);

    const pIn = segmentProgress(t, PHASES, 0);
    const pText = segmentProgress(t, PHASES, 1);
    const pOut = segmentProgress(t, PHASES, 2);

    const portalY =
      t < PHASES[1].start ? pIn : t < PHASES[2].start ? 1 : 1 - pOut;

    if (portalFirstNameRef.current)
      portalFirstNameRef.current.scale.y = portalY;
    if (portalLastNameRef.current) portalLastNameRef.current.scale.y = portalY;

    if (firstNameRef.current)
      firstNameRef.current.position.x =
        RESPONSIVE[tier]?.firstName.position.x +
        pText * RESPONSIVE[tier]?.firstName.offset;

    if (lastNameRef.current)
      lastNameRef.current.position.x =
        RESPONSIVE[tier]?.lastName.position.x +
        pText * RESPONSIVE[tier]?.lastName.offset;

    const open = 1 - THREE.MathUtils.clamp(pText, 0, 1);

    const fN = firstNameHtml.current;
    if (fN) fN.style.setProperty("--shift", `${(1 - open) * 100}%`);

    const lN = lastNameHtml.current;
    if (lN) lN.style.setProperty("--shift", `${(1 - open) * 100}%`);

    if (portalFirstNameHtml.current)
      portalFirstNameHtml.current.style.scale = `100% ${portalY * 100}%`;

    if (portalLastNameHtml.current)
      portalLastNameHtml.current.style.scale = `100% ${portalY * 100}%`;
  });

  const firstNameClipPlane = useMemo(() => {
    return new THREE.Plane(
      new THREE.Vector3(-1, 0, 0),
      RESPONSIVE[tier]?.firstName.planeConstant,
    );
  }, [tier]);

  const lastNameClipPlane = useMemo(
    () =>
      new THREE.Plane(
        new THREE.Vector3(1, 0, 0),
        RESPONSIVE[tier]?.lastName.planeConstant,
      ),
    [tier],
  );

  function ClippingPlaneDebug({ plane }) {
    const planeRef = useRef(plane);
    useHelper(planeRef, THREE.PlaneHelper, 5000, "hotpink");
    return null;
  }

  return (
    <>
      {!up.md ? (
        <Html
          fullscreen
          wrapperClass="fixed!"
          position={[0, !up.xs ? 650 : 570, 0]}
          className="px-5! lg:px-0! font-display text-8xl relative leading-22 max-w-100 left-[50%]! translate-x-[-50%]"
        >
          <div
            className="bg-white absolute w-1 h-19 left-39.25 -top-3 z-50"
            ref={portalFirstNameHtml}
          />
          <div
            className="bg-white absolute w-1 h-19 left-64 top-16 z-50"
            ref={portalLastNameHtml}
          />
          <div className="reveal absolute -top-4 left-5">
            <h1 className="reveal__text" ref={firstNameHtml}>
              {firstName}
            </h1>
          </div>

          <div className="reveal absolute top-15 left-5">
            <h1 className="reveal__text" ref={lastNameHtml}>
              {lastName}
            </h1>
          </div>
        </Html>
      ) : (
        <>
          <mesh
            ref={portalFirstNameRef}
            position={[
              RESPONSIVE[tier]?.firstName.portal.x,
              RESPONSIVE[tier]?.firstName.portal.y,
              -5750,
            ]}
          >
            <planeGeometry args={[30, 1850]} />
            <meshBasicMaterial color={"white"} />
          </mesh>

          <mesh
            ref={portalLastNameRef}
            position={[
              RESPONSIVE[tier]?.lastName.portal.x,
              RESPONSIVE[tier]?.lastName.portal.y,
              -5100,
            ]}
          >
            <planeGeometry
              args={[30, RESPONSIVE[tier]?.lastName.portal.scaleY]}
            />
            <meshBasicMaterial color={"white"} />
          </mesh>

          <group ref={textRef}>
            {/* <ClippingPlaneDebug plane={firstNameClipPlane} />
            <ClippingPlaneDebug plane={lastNameClipPlane} /> */}

            <Text
              ref={firstNameRef}
              position={[
                RESPONSIVE[tier]?.firstName.position.x,
                RESPONSIVE[tier]?.firstName.position.y,
                -5750,
              ]}
              font="/fonts/Morganite-Black.ttf"
              fontSize={RESPONSIVE[tier]?.firstName.fontSize}
              color="white"
              material-clippingPlanes={[firstNameClipPlane]}
              material-clipIntersection={true}
            >
              {firstName}
            </Text>

            <Text
              ref={lastNameRef}
              position={[
                RESPONSIVE[tier]?.lastName.position.x,
                RESPONSIVE[tier]?.lastName.position.y,
                -5650,
              ]}
              font="/fonts/Morganite-Black.ttf"
              fontSize={RESPONSIVE[tier]?.lastName.fontSize}
              color="white"
              material-clippingPlanes={[lastNameClipPlane]}
              material-clipIntersection={true}
            >
              {lastName}
            </Text>
          </group>
        </>
      )}
    </>
  );
}
