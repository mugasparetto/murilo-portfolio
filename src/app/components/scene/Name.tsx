import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text, useHelper, useScroll } from "@react-three/drei";
import { KeyTextField } from "@prismicio/client";

import { progressInWindow, ScrollWindow } from "./ScrollRig";
import { easeCos } from "../../helpers/math";

type Props = {
  firstName: KeyTextField;
  lastName: KeyTextField;
  totalPagesCount: number;
  scrollWindow: ScrollWindow;
};

const FIRST_NAME_PLANE_BASE = -200;
const LAST_NAME_PLANE_BASE = 100;

const POSITIONS = {
  firstName: {
    start: -1900,
    offset: 3250,
  },
  lastName: {
    start: 2450,
    offset: -5100,
  },
};

export default function Name({
  firstName = "",
  lastName = "",
  totalPagesCount = 0,
  scrollWindow = { startPage: 1, endPage: 2 },
}: Props) {
  const { camera } = useThree();
  const textRef = useRef<THREE.Mesh | null>(null);
  const firstNameRef = useRef<THREE.Mesh | null>(null);
  const lastNameRef = useRef<THREE.Mesh | null>(null);
  const portalFirstNameRef = useRef<THREE.Mesh | null>(null);
  const portalLastNameRef = useRef<THREE.Mesh | null>(null);

  // --- billboard both to camera every frame
  useFrame(() => {
    const q = camera.quaternion;
    if (textRef.current) textRef.current.quaternion.copy(q);
  });

  const scroll = useScroll();

  // Convert weights (e.g. [0.25,0.5,0.25]) into cumulative ranges in 0..1
  const makeRanges = (weights: number[]) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return weights.map((w) => {
      const start = acc;
      acc += w / sum;
      return { start, end: acc };
    });
  };

  // Local eased progress for segment i
  const segP = (
    t: number,
    ranges: { start: number; end: number }[],
    i: number
  ) => {
    const r = ranges[i];
    const local = (t - r.start) / (r.end - r.start);
    return easeCos(THREE.MathUtils.clamp(local, 0, 1));
  };

  // scroll allocation per phase (you can tweak these)
  const PHASE_WEIGHTS = [0.2, 0.6, 0.2]; // portalsIn, text, portalsOut
  const PHASES = makeRanges(PHASE_WEIGHTS);

  useFrame(() => {
    const t = progressInWindow(scroll.offset, totalPagesCount, scrollWindow); // 0..1

    const pIn = segP(t, PHASES, 0); // 0..1 in phase 0
    const pText = segP(t, PHASES, 1); // 0..1 in phase 1
    const pOut = segP(t, PHASES, 2); // 0..1 in phase 2

    // PORTALS: 0..1 then 1..0
    const portalY =
      t < PHASES[1].start ? pIn : t < PHASES[2].start ? 1 : 1 - pOut;

    if (portalFirstNameRef.current)
      portalFirstNameRef.current.scale.y = portalY;
    if (portalLastNameRef.current) portalLastNameRef.current.scale.y = portalY;

    if (firstNameRef.current)
      firstNameRef.current.position.x =
        POSITIONS.firstName.start + pText * POSITIONS.firstName.offset;
    if (lastNameRef.current)
      lastNameRef.current.position.x =
        POSITIONS.lastName.start + pText * POSITIONS.lastName.offset;
  });

  const firstNameClipPlane = useMemo(
    () =>
      new THREE.Plane(
        new THREE.Vector3(-1, 0, 0), // normal points LEFT
        FIRST_NAME_PLANE_BASE
      ),
    []
  );

  const lastNameClipPlane = useMemo(
    () =>
      new THREE.Plane(
        new THREE.Vector3(1, 0, 0), // normal points LEFT
        LAST_NAME_PLANE_BASE
      ),
    []
  );

  //   function ClippingPlaneDebug({ plane }) {
  //     const planeRef = useRef(plane);

  //     useHelper(planeRef, THREE.PlaneHelper, 5000, "hotpink");

  //     return null;
  //   }

  return (
    <>
      <mesh ref={portalFirstNameRef} position={[-180, 3750, -5750]}>
        <planeGeometry args={[30, 1850]} />
        <meshBasicMaterial color={"white"} />
      </mesh>
      <mesh ref={portalLastNameRef} position={[-130, 1850, -5100]}>
        <planeGeometry args={[30, 1850]} />
        <meshBasicMaterial color={"white"} />
      </mesh>
      <group ref={textRef}>
        {/* <ClippingPlaneDebug plane={firstNameClipPlane} /> */}
        {/* <ClippingPlaneDebug plane={lastNameClipPlane} /> */}

        <Text
          ref={firstNameRef}
          position={[POSITIONS.firstName.start, 2350, -5750]}
          font="/fonts/Morganite-Black.ttf"
          fontSize={2000}
          color="white"
          material-clippingPlanes={[firstNameClipPlane]}
          material-clipIntersection={true}
        >
          {firstName}
        </Text>

        <Text
          ref={lastNameRef}
          position={[POSITIONS.lastName.start, 600, -5650]}
          font="/fonts/Morganite-Black.ttf"
          fontSize={2000}
          color="white"
          material-clippingPlanes={[lastNameClipPlane]}
          material-clipIntersection={true}
        >
          {lastName}
        </Text>
      </group>
    </>
  );
}
