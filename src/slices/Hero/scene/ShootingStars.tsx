"use client";

import { useMemo, useRef, useEffect, RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree, RootState } from "@react-three/fiber";

import SkyBoundsDebug from "./SkyBoundsDebug";

type Star = {
  active: boolean;
  nextSpawnAt: number;
  startTime: number;
  duration: number;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  length: number;
  opacity: number;
  headSize: number;
};

const SKY_BOUNDS = {
  minY: 1600,
  maxY: 4800,
  minZ: -5950,
  maxZ: -5000,
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pointOnDomeWithinYZBounds(
  radius: number,
  bounds: { minY: number; maxY: number; minZ: number; maxZ: number },
) {
  // Clamp bounds to what a sphere of this radius can represent
  const minY = THREE.MathUtils.clamp(bounds.minY, -radius, radius);
  const maxY = THREE.MathUtils.clamp(bounds.maxY, -radius, radius);
  const minZ = THREE.MathUtils.clamp(bounds.minZ, -radius, radius);
  const maxZ = THREE.MathUtils.clamp(bounds.maxZ, -radius, radius);

  // Pick Y first
  const y = rand(minY, maxY);

  // For this Y, the sphere allows z in [-sqrt(r^2 - y^2), +sqrt(r^2 - y^2)]
  const zMaxAbs = Math.sqrt(Math.max(0, radius * radius - y * y));

  // Intersect your requested Z-range with the sphere’s valid Z-range
  const zLo = Math.max(minZ, -zMaxAbs);
  const zHi = Math.min(maxZ, +zMaxAbs);

  // If your bounds don't intersect the sphere at this Y, clamp Z to the closest valid value
  const z =
    zLo <= zHi
      ? rand(zLo, zHi)
      : THREE.MathUtils.clamp((minZ + maxZ) * 0.5, -zMaxAbs, zMaxAbs);

  // Solve X from x^2 + y^2 + z^2 = r^2
  const xAbs = Math.sqrt(Math.max(0, radius * radius - (y * y + z * z)));
  const x = (Math.random() < 0.5 ? -1 : 1) * xAbs;

  return new THREE.Vector3(x, y, z);
}

function fitTravelInsideBoundsWithMin(
  start: THREE.Vector3,
  dir: THREE.Vector3,
  desiredTravel: number,
  minTravel: number,
  bounds: { minY: number; maxY: number; minZ: number; maxZ: number },
) {
  // Clamp direction so that traveling `minTravel` stays inside Y/Z bounds.
  // This guarantees movement (no “fade in place”).
  const d = dir.clone().normalize();

  // --- Y clamp: we only allow slight downward drift; never upwards
  if (d.y > 0) d.y = -Math.abs(d.y);

  // To stay above minY after minTravel:
  // start.y + d.y * minTravel >= minY  =>  d.y >= (minY - start.y)/minTravel
  const minAllowedY = (bounds.minY - start.y) / minTravel; // negative or 0
  if (d.y < minAllowedY) d.y = minAllowedY; // reduce downward magnitude if too steep

  // --- Z clamp: keep within [minZ, maxZ] after minTravel
  const endZ = start.z + d.z * minTravel;
  if (endZ < bounds.minZ) d.z = (bounds.minZ - start.z) / minTravel;
  if (endZ > bounds.maxZ) d.z = (bounds.maxZ - start.z) / minTravel;

  d.normalize();

  // Now compute the maximum allowed travel (same math as your previous fitter)
  let maxT = desiredTravel;

  if (d.y > 0) maxT = Math.min(maxT, (bounds.maxY - start.y) / d.y);
  if (d.y < 0) maxT = Math.min(maxT, (bounds.minY - start.y) / d.y);

  if (d.z > 0) maxT = Math.min(maxT, (bounds.maxZ - start.z) / d.z);
  if (d.z < 0) maxT = Math.min(maxT, (bounds.minZ - start.z) / d.z);

  if (!Number.isFinite(maxT) || maxT <= 0) maxT = minTravel;

  // Guarantee at least minTravel (since we clamped d to make that safe)
  const allowedTravel = Math.max(minTravel, Math.min(desiredTravel, maxT));

  return { dir: d, travel: allowedTravel };
}

function randomTangentDirection(p: THREE.Vector3) {
  const radial = p.clone().normalize();
  const helper =
    Math.abs(radial.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);

  const tangent = new THREE.Vector3().crossVectors(radial, helper).normalize();
  tangent.applyAxisAngle(radial, rand(0, Math.PI * 2));
  tangent.add(new THREE.Vector3(0, rand(-0.25, 0.05), 0)).normalize();
  return tangent;
}

function biasedScreenDirection(camera: THREE.Camera, noise: THREE.Vector3) {
  // camera right in world space
  const right = new THREE.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .normalize();

  // kill vertical in the horizontal sweep (so it reads “across the sky”)
  right.y = 0;
  right.normalize();

  // small downward drift only
  const down = new THREE.Vector3(0, -1, 0);

  // build mostly-horizontal direction
  const dir = new THREE.Vector3()
    .addScaledVector(right, rand(-1.0, 1.0)) // strong left/right
    .addScaledVector(down, rand(0.03, 0.12)) // tiny downward drift
    .addScaledVector(noise, rand(0.05, 0.12)); // small organic variation

  // absolutely never allow up
  if (dir.y > 0) dir.y = -dir.y;

  // reduce Z drift so Z-bounds don’t kill travel
  dir.z *= 0.25;

  return dir.normalize();
}

// --------- shaders (trail + head) ---------
const TrailShader = {
  uniforms: {
    uIntensity: { value: 1.0 },
    uTailPower: { value: 2.4 },
    uEdgeSoftness: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    void main() {
      vUv = uv;
      #ifdef USE_INSTANCING_COLOR
        vInstanceColor = instanceColor.rgb;
      #else
        vInstanceColor = vec3(1.0);
      #endif
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vInstanceColor;

    uniform float uIntensity;
    uniform float uTailPower;
    uniform float uEdgeSoftness;

    void main() {
      // Along trail: 0 tail -> 1 head
      float along = clamp(vUv.y, 0.0, 1.0);

      // Tail ramps up towards the head
      float tail = pow(along, uTailPower);

      // Make edges softer (thin center line)
      float x = abs(vUv.x - 0.5) * 2.0;          // 0 center, 1 edges
      float edge = smoothstep(1.0, 0.0, x);      // 1 center, 0 edges
      edge = pow(edge, uEdgeSoftness);

      // Slight extra brightness close to head
      float headRamp = smoothstep(0.7, 1.0, along);

      float a = (tail * edge + headRamp * 0.35) * uIntensity;

      vec3 col = vInstanceColor * a;
      gl_FragColor = vec4(col, a);

      if (gl_FragColor.a < 0.01) discard;
    }
  `,
};

const HeadShader = {
  uniforms: {
    uIntensity: { value: 1.0 },
    uCoreSize: { value: 0.18 }, // smaller = tighter core
    uHaloSize: { value: 0.75 }, // larger = bigger halo
    uHaloStrength: { value: 0.8 },
    uCoreStrength: { value: 2.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    void main() {
      vUv = uv;
      #ifdef USE_INSTANCING_COLOR
        vInstanceColor = instanceColor.rgb;
      #else
        vInstanceColor = vec3(1.0);
      #endif
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vInstanceColor;

    uniform float uIntensity;
    uniform float uCoreSize;
    uniform float uHaloSize;
    uniform float uHaloStrength;
    uniform float uCoreStrength;

    void main() {
      // radial falloff from center (0.5,0.5)
      vec2 c = vUv - vec2(0.5);
      float r = length(c);

      // core: tight and hot
      float core = smoothstep(uCoreSize, 0.0, r) * uCoreStrength;

      // halo: wider, softer
      float halo = smoothstep(uHaloSize, 0.0, r) * uHaloStrength;

      float a = (core + halo) * uIntensity;

      // slight blue-white tint at high intensity (subtle)
      vec3 col = vInstanceColor * a;

      gl_FragColor = vec4(col, a);
      if (gl_FragColor.a < 0.01) discard;
    }
  `,
};

export default function ShootingStars({
  domeRadius = 6000,
  poolSize = 10,

  minInterval = 2.0,
  maxInterval = 10.0,

  trailThickness = 22,
  globalMinGap = 4,
}: {
  domeRadius?: number;
  poolSize?: number;
  minInterval?: number;
  maxInterval?: number;
  trailThickness?: number;
  globalMinGap?: number;
}) {
  const starsRef = useRef<Star[]>([]);
  const readyRef = useRef(false);

  useEffect(() => {
    starsRef.current = Array.from({ length: poolSize }, (_, i) => ({
      active: false,
      nextSpawnAt: rand(minInterval, maxInterval) + i * (globalMinGap * 0.5),
      startTime: 0,
      duration: rand(1.2, 1.85),
      start: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: rand(3600, 4800),
      length: rand(1000, 1600),
      opacity: 0,
      headSize: rand(100, 140),
    }));
    readyRef.current = true;
  }, [poolSize, minInterval, maxInterval, globalMinGap]);

  const lastSpawnAtRef = useRef<number>(-1e9);
  const clickQueueRef = useRef<{ x: number; y: number }[]>([]);

  const trailRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpHead = useMemo(() => new THREE.Vector3(), []);
  const tmpMid = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const upAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // reuse color object to avoid allocations
  const tmpColor = useMemo(() => new THREE.Color(), []);

  function spawnToPointer(state: RootState, pointer: { x: number; y: number }) {
    if (!readyRef.current) return;
    const stars = starsRef.current;

    // find free slot
    const idx = stars.findIndex((s) => !s.active);
    if (idx === -1) return;

    const s = stars[idx];

    // ---------- 1) compute target point under pointer ----------
    const targetZ = (SKY_BOUNDS.minZ + SKY_BOUNDS.maxZ) * 0.5;

    // plane z = targetZ
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -targetZ);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(pointer.x, pointer.y),
      state.camera,
    );

    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    if (!hit) return;

    // Clamp target inside bounds
    target.y = THREE.MathUtils.clamp(
      target.y,
      SKY_BOUNDS.minY,
      SKY_BOUNDS.maxY,
    );
    target.z = THREE.MathUtils.clamp(
      target.z,
      SKY_BOUNDS.minZ,
      SKY_BOUNDS.maxZ,
    );

    // ---------- 2) choose side + guarantee "comes from distance" ----------
    // If click is near center, force a strong side choice so you still get travel
    const deadzone = 0.18;
    const clickSign =
      Math.abs(pointer.x) < deadzone
        ? Math.random() < 0.5
          ? -1
          : 1
        : Math.sign(pointer.x);

    // click left => star comes from right; click right => star comes from left
    const spawnSign = -clickSign;

    // We want it to come from far, so pick a start Y higher than target (=> downward travel)
    const startY = THREE.MathUtils.clamp(
      target.y + rand(700, 1400), // ↑ higher start => more down drift
      SKY_BOUNDS.minY,
      SKY_BOUNDS.maxY,
    );

    // Keep start Z near target Z so it doesn't get “stuck” by Z bounds
    let startZ = THREE.MathUtils.clamp(
      target.z + rand(-250, 250),
      SKY_BOUNDS.minZ,
      SKY_BOUNDS.maxZ,
    );

    // Solve X on dome for (startY, startZ)
    const rr = domeRadius * domeRadius;

    // Guarantee a minimum |x| by nudging Z toward 0 if necessary
    const minAbsX = 2200; // <-- makes it spawn from “distance”
    {
      const allowedZAbsForMinX = Math.sqrt(
        Math.max(0, rr - startY * startY - minAbsX * minAbsX),
      );

      // If we can achieve minAbsX at this Y, constrain Z so xAbs won't collapse
      if (allowedZAbsForMinX > 0) {
        const zLo = Math.max(SKY_BOUNDS.minZ, -allowedZAbsForMinX);
        const zHi = Math.min(SKY_BOUNDS.maxZ, +allowedZAbsForMinX);

        // If intersection exists, clamp startZ into it (no tries)
        if (zLo <= zHi) {
          startZ = THREE.MathUtils.clamp(startZ, zLo, zHi);
        }
      }
    }

    const rest = rr - (startY * startY + startZ * startZ);
    const xAbs = Math.sqrt(Math.max(0, rest));
    const startX = spawnSign * xAbs;

    const start = new THREE.Vector3(startX, startY, startZ);

    // ---------- 3) aim at pointer, but keep it "a bit downwards" ----------
    // Push the target slightly downward so even center clicks have down drift
    const targetDownBias = 220;
    target.y = THREE.MathUtils.clamp(
      target.y - targetDownBias,
      SKY_BOUNDS.minY,
      SKY_BOUNDS.maxY,
    );

    const dir = target.clone().sub(start);

    // avoid "too horizontal": enforce a minimum downward component (but not a dive)
    // convert to normalized y ratio
    const len = dir.length();
    if (len < 1) return;

    const minDownRatio = -0.1; // at least ~10% down
    const maxDownRatio = -0.28; // no steeper than ~28% down

    const yRatio = dir.y / len;

    if (yRatio > minDownRatio) {
      // not down enough: make start a bit higher (deterministic)
      start.y = THREE.MathUtils.clamp(
        start.y + 350,
        SKY_BOUNDS.minY,
        SKY_BOUNDS.maxY,
      );
      // recompute x to stay on dome
      const rest2 = rr - (start.y * start.y + start.z * start.z);
      const xAbs2 = Math.sqrt(Math.max(0, rest2));
      start.x = spawnSign * xAbs2;
      dir.copy(target).sub(start);
    } else if (yRatio < maxDownRatio) {
      // too down: bring start closer in Y
      start.y = THREE.MathUtils.clamp(
        start.y - 350,
        SKY_BOUNDS.minY,
        SKY_BOUNDS.maxY,
      );
      const rest2 = rr - (start.y * start.y + start.z * start.z);
      const xAbs2 = Math.sqrt(Math.max(0, rest2));
      start.x = spawnSign * xAbs2;
      dir.copy(target).sub(start);
    }

    dir.normalize();

    // ---------- 4) set star so it reaches the pointer ----------
    s.active = true;
    s.startTime = state.clock.elapsedTime;

    s.duration = rand(0.6, 1);
    const travel = start.distanceTo(target);

    // Keep travel meaningful even if click is extremely close to start
    const minTravel = 2400;
    const finalTravel = Math.max(minTravel, travel);

    s.speed = finalTravel / s.duration;
    s.length = THREE.MathUtils.clamp(finalTravel * 0.35, 900, 1700);
    s.headSize = rand(110, 160);
    s.opacity = 0;

    s.start.copy(start);
    s.dir.copy(dir);

    // Optional: make it end near the pointer by shortening duration a bit if needed
    // (your fadeOut should be near t=0.9..1.0)
  }

  useFrame((state) => {
    const trail = trailRef.current;
    const head = headRef.current;
    if (!trail || !head) return;

    if (!readyRef.current) return;
    const stars = starsRef.current;

    // --- click spawns have priority and ignore timers ---
    // click spawns (always)
    while (clickQueueRef.current.length > 0) {
      const pointer = clickQueueRef.current.shift()!;
      spawnToPointer(state, pointer);
    }

    const now = state.clock.elapsedTime;

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];

      // spawn
      if (
        !s.active &&
        now >= s.nextSpawnAt &&
        now - lastSpawnAtRef.current >= globalMinGap
      ) {
        s.active = true;
        lastSpawnAtRef.current = now;

        s.startTime = now;
        s.duration = rand(1.2, 1.85);
        s.speed = rand(3600, 4800);
        s.length = rand(1000, 1600);
        s.headSize = rand(100, 140);
        s.opacity = 0;

        // ✅ guaranteed spawn inside Y/Z bounds on the dome
        const p = pointOnDomeWithinYZBounds(domeRadius, SKY_BOUNDS);
        s.start.copy(p);

        // camera-biased direction + noise
        const noise = randomTangentDirection(p);
        const rawDir = biasedScreenDirection(state.camera, noise);

        // enforce meaningful motion
        const desiredTravel = s.speed * s.duration;
        const minTravel = 1400; // <-- tweak: how far it should *at least* cross

        const fitted = fitTravelInsideBoundsWithMin(
          p,
          rawDir,
          desiredTravel,
          minTravel,
          SKY_BOUNDS,
        );

        s.dir.copy(fitted.dir);

        // set effective speed so it actually travels `fitted.travel`
        s.speed = fitted.travel / s.duration;
      }

      if (s.active) {
        const t = (now - s.startTime) / s.duration;

        const fadeIn = THREE.MathUtils.smoothstep(t, 0.0, 0.12);
        const fadeOut = 1.0 - THREE.MathUtils.smoothstep(t, 0.9, 1.0);
        s.opacity = 1.0 * fadeIn * fadeOut;

        // compute head pos
        tmpHead.copy(s.start).addScaledVector(s.dir, t * s.speed * s.duration);

        // orientation along direction
        tmpQuat.setFromUnitVectors(upAxis, s.dir);

        // -------- trail instance (centered on segment) --------
        tmpMid.copy(tmpHead).addScaledVector(s.dir, -s.length * 0.5);

        dummy.position.copy(tmpMid);
        dummy.quaternion.copy(tmpQuat);
        dummy.scale.set(trailThickness, s.length, 1);
        dummy.updateMatrix();
        trail.setMatrixAt(i, dummy.matrix);

        // -------- head instance (at head) --------
        dummy.position.copy(tmpHead);
        dummy.quaternion.copy(tmpQuat);
        // make head slightly wider than trail
        const headW = trailThickness * 2.2;
        dummy.scale.set(headW, s.headSize, 1);
        dummy.updateMatrix();
        head.setMatrixAt(i, dummy.matrix);

        // per-instance color encodes brightness (shader uses it)
        // head should pop more than tail: we’ll bake a bit of boost into instanceColor
        const base = THREE.MathUtils.clamp(s.opacity, 0, 1);

        // tail is a bit dimmer; head is hotter
        trail.setColorAt?.(
          i,
          tmpColor.setRGB(base * 0.75, base * 0.75, base * 0.8),
        );
        head.setColorAt?.(
          i,
          tmpColor.setRGB(base * 1.2, base * 1.2, base * 1.35),
        );

        if (t >= 1) {
          s.active = false;
          s.opacity = 0;
          s.nextSpawnAt = now + rand(minInterval, maxInterval);

          // hide instances by scaling nearly to zero
          dummy.position.set(0, 0, 0);
          dummy.quaternion.identity();
          dummy.scale.set(0.00001, 0.00001, 0.00001);
          dummy.updateMatrix();
          trail.setMatrixAt(i, dummy.matrix);
          head.setMatrixAt(i, dummy.matrix);
          trail.setColorAt?.(i, tmpColor.setRGB(0, 0, 0));
          head.setColorAt?.(i, tmpColor.setRGB(0, 0, 0));
        }
      } else {
        // keep hidden
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.scale.set(0.00001, 0.00001, 0.00001);
        dummy.updateMatrix();
        trail.setMatrixAt(i, dummy.matrix);
        head.setMatrixAt(i, dummy.matrix);
        trail.setColorAt?.(i, tmpColor.setRGB(0, 0, 0));
        head.setColorAt?.(i, tmpColor.setRGB(0, 0, 0));
      }
    }

    trail.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
  });

  const { gl } = useThree();
  useEffect(() => {
    const el = document.documentElement; // this is the scroll container that receives events
    const onPointerDown = (e: PointerEvent) => {
      const rect = (gl.domElement as HTMLCanvasElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      clickQueueRef.current.push({ x, y });
    };

    el?.addEventListener("pointerdown", onPointerDown);
    return () => el?.removeEventListener("pointerdown", onPointerDown);
  }, [gl]);

  return (
    <group>
      {/* <SkyBoundsDebug bounds={SKY_BOUNDS} domeRadius={domeRadius} /> */}

      {/* TRAILS */}
      <instancedMesh ref={trailRef} args={[undefined, undefined, poolSize]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={TrailShader.uniforms}
          vertexShader={TrailShader.vertexShader}
          fragmentShader={TrailShader.fragmentShader}
        />
      </instancedMesh>

      {/* HEADS (core + halo) */}
      <instancedMesh ref={headRef} args={[undefined, undefined, poolSize]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={HeadShader.uniforms}
          vertexShader={HeadShader.vertexShader}
          fragmentShader={HeadShader.fragmentShader}
        />
      </instancedMesh>
    </group>
  );
}
