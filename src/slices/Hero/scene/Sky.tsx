"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Stars } from "@react-three/drei";

import OutlinedSolid from "../../../app/components/OutlinedSolid"; // adjust path if needed
import InstancedStars from "./Star";
import ShootingStars from "./ShootingStars";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";

const STARS_COUNT = 200;
const DOME_RADIUS = 6000;

export default function Sky({
  scrollElement,
}: {
  scrollElement: RefObject<HTMLElement | null>;
}) {
  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();
  const { up } = useBreakpoints(BREAKPOINTS);

  // Animate groups (so both fill + outline rotate together)
  const cubeGroup = useRef<THREE.Group>(null);
  const pyramidGroup = useRef<THREE.Group>(null);

  // --- geometries
  const cubeGeometry = useMemo(() => new THREE.BoxGeometry(750, 750, 750), []);

  // Square-base pyramid: cone with 4 segments
  const pyramidGeometry = useMemo(
    () => new THREE.ConeGeometry(600, 800, 4, 1),
    [],
  );

  // --- fill materials
  const blackMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "black" }),
    [],
  );

  // --- shared fat line material (recommended)
  const lineMat = useMemo(() => {
    const m = new LineMaterial({
      color: 0xffffff,
      linewidth: 1.5,
      resolution: new THREE.Vector2(size.width * dpr, size.height * dpr),
    });
    m.depthTest = true;
    m.depthWrite = false;
    m.transparent = true;
    m.opacity = 1.0;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep resolution current (important for LineMaterial)
  useEffect(() => {
    lineMat.resolution.set(size.width * dpr, size.height * dpr);
  }, [lineMat, size.width, size.height, dpr]);

  // cleanup
  useEffect(() => {
    return () => {
      cubeGeometry.dispose();
      pyramidGeometry.dispose();
      blackMat.dispose();
      lineMat.dispose();
    };
  }, [cubeGeometry, pyramidGeometry, blackMat, lineMat]);

  // positions
  const cubePos: [number, number, number] = [-4000, 5000, -7000];
  const pyramidPos: [number, number, number] = [5700, 4000, -7000];

  const starsPositions = useMemo(() => {
    const pts: [number, number, number][] = [];

    for (let i = 0; i < STARS_COUNT; i++) {
      // random direction
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);

      const x = DOME_RADIUS * Math.sin(phi) * Math.cos(theta);
      const y = DOME_RADIUS * Math.sin(phi) * Math.sin(theta);
      const z = DOME_RADIUS * Math.cos(phi);

      pts.push([x, y, z]);
    }

    return pts;
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    if (cubeGroup.current) {
      cubeGroup.current.rotation.x += delta * 0.07;
      cubeGroup.current.rotation.z += delta * 0.09;
      cubeGroup.current.position.y = cubePos[1] + Math.sin(t * 0.5) * 100;
    }

    if (pyramidGroup.current) {
      pyramidGroup.current.rotation.y += delta * 0.1;
      pyramidGroup.current.rotation.x += delta * 0.05;
      pyramidGroup.current.position.y =
        pyramidPos[1] + Math.sin(t * 0.45 + 0.1276) * 100;
    }
  });

  return (
    <group>
      {up.md && (
        <>
          {/* Cube */}
          <group ref={cubeGroup} position={cubePos}>
            <OutlinedSolid
              geometry={cubeGeometry}
              fillMaterial={blackMat}
              lineMaterial={lineMat}
              // z-fighting + distance stability
              polygonOffset
              polygonOffsetFactor={2}
              polygonOffsetUnits={2}
              wireScale={1.002}
            />
          </group>

          {/* Pyramid (square base) */}
          <group ref={pyramidGroup} position={pyramidPos}>
            <OutlinedSolid
              geometry={pyramidGeometry}
              fillMaterial={blackMat}
              lineMaterial={lineMat}
              polygonOffset
              polygonOffsetFactor={2}
              polygonOffsetUnits={2}
              wireScale={1.002}
            />
          </group>
        </>
      )}

      <Stars
        radius={1500}
        depth={5000}
        count={9000}
        factor={200}
        saturation={0}
        fade
        speed={1}
      />

      {/* 👇 replaces the per-star <Star /> map */}
      <InstancedStars
        positions={starsPositions}
        minSize={10}
        maxSize={18}
        blinkSpeed={0.8}
        minOpacity={0.2}
        maxOpacity={1}
        seed={0}
      />

      <ShootingStars
        domeRadius={DOME_RADIUS}
        poolSize={6}
        minInterval={5}
        maxInterval={7}
        globalMinGap={8}
        scrollElement={scrollElement}
      />
    </group>
  );
}
