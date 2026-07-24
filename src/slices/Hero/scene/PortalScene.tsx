/**
 * PortalScene.jsx — React Three Fiber recreation of the "creative developer" hero scene.
 *
 *   npm i three @react-three/fiber @react-three/postprocessing
 *
 * Usage:  import PortalScene from './PortalScene'   →   <PortalScene />
 * (Type/typography intentionally omitted — this is the 3D layer only.)
 */

import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

/* ------------------------------------------------------------------ *
 * Scene constants — one place to re-tune the whole composition
 * ------------------------------------------------------------------ */
const STAIRS = {
  count: 14,
  rise: 0.14,
  run: 0.55,
  wBottom: 7.5,
  wTop: 3.4,
  zBottom: 3.7,
};
const TOP_Y = STAIRS.count * STAIRS.rise; // 1.96
const TOP_Z = STAIRS.zBottom - STAIRS.count * STAIRS.run; // -4.0
const PORTAL = { w: 2.3, h: 6.4, d: 0.9, z: TOP_Z - 0.6 };
const LOOK_AT = new THREE.Vector3(0, 4.0, PORTAL.z);

// Height below which terrain stops occluding, so the floor grid stays visible
// across the flat ground. Raise it to sink the mountain bases into the grid.
const FILL_FLOOR = "0.12";

/* ------------------------------------------------------------------ *
 * Shared GLSL — simplex noise + fbm
 * ------------------------------------------------------------------ */
const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                             + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * snoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/* ------------------------------------------------------------------ *
 * Portal — animated iridescent slab
 * ------------------------------------------------------------------ */
function Portal() {
  const mat = useRef();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += dt;
  });

  const frame = useMemo(
    () =>
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(PORTAL.w + 0.34, PORTAL.h + 0.3, PORTAL.d + 0.34),
      ),
    [],
  );

  return (
    <group position={[0, TOP_Y + PORTAL.h / 2, PORTAL.z]}>
      {/* the light itself */}
      <mesh>
        <boxGeometry args={[PORTAL.w, PORTAL.h, PORTAL.d]} />
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          fog={false}
          vertexShader={
            /* glsl */ `
            varying vec2 vUv;
            varying vec3 vNormal;
            void main(){
              vUv = uv;
              vNormal = normalMatrix * normal;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `
          }
          fragmentShader={
            /* glsl */ `
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vNormal;
            ${NOISE_GLSL}
            void main(){
              vec2 p = vec2(vUv.x * 2.4, vUv.y * 1.15);
              float t = uTime * 0.09;

              float w1 = fbm(p * 1.5 + vec2(t, -t * 0.7));
              float w2 = fbm(p * 2.4 + vec2(w1 * 1.3 - t * 0.5, w1 * 0.9 + t * 0.35));
              float w3 = fbm(p * 4.2 + w2 * 1.6);

              vec3 violet  = vec3(0.42, 0.34, 1.00);
              vec3 magenta = vec3(1.00, 0.26, 0.86);
              vec3 cyan    = vec3(0.32, 0.86, 1.00);
              vec3 mint    = vec3(0.56, 1.00, 0.80);

              vec3 col = mix(violet, magenta, smoothstep(-0.6, 0.5, w1));
              col = mix(col, cyan, smoothstep(-0.25, 0.8, w2));
              col = mix(col, mint, smoothstep(0.35, 0.95, w3) * 0.55);

              float hot = smoothstep(0.5, 1.0, w2 * 0.6 + w3 * 0.5 + 0.2 * sin(vUv.y * 7.0 + uTime * 0.4));
              col = mix(col, vec3(1.0), hot * 0.8);

              // brighter down the vertical centre, softer at the sides
              float centre = 1.0 - abs(vUv.x - 0.5) * 1.3;
              col *= 0.72 + 0.55 * centre;
              col += 0.12;

              // side faces read darker so the slab keeps its volume
              float facing = abs(normalize(vNormal).z);
              col *= mix(0.35, 1.0, facing);

              gl_FragColor = vec4(col, 1.0);
            }
          `
          }
        />
      </mesh>

      {/* glass housing */}
      <mesh>
        <boxGeometry
          args={[PORTAL.w + 0.34, PORTAL.h + 0.3, PORTAL.d + 0.34]}
        />
        <meshBasicMaterial
          color="#8fb4c8"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={frame}>
        <lineBasicMaterial color="#cfe6f2" transparent opacity={0.55} />
      </lineSegments>

      {/* halo */}
      <Glow
        scale={[13, 17, 1]}
        position={[0, 0, -0.9]}
        color="#7d5cff"
        opacity={0.5}
      />
      <Glow
        scale={[6, 9, 1]}
        position={[0, 0, 0.7]}
        color="#ff7ae0"
        opacity={0.35}
      />
    </group>
  );
}

/* Additive radial sprite used for every soft light bloom in the scene */
function Glow({ color = "#ffffff", opacity = 0.4, ...props }) {
  return (
    <mesh {...props}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        fog={false}
        blending={THREE.AdditiveBlending}
        uniforms={useMemo(
          () => ({
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
          }),
          [color, opacity],
        )}
        vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`
          uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
          void main(){
            float d = length(vUv - 0.5) * 2.0;
            float a = pow(max(1.0 - d, 0.0), 2.6);
            gl_FragColor = vec4(uColor, a * uOpacity);
          }
        `}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ *
 * Staircase — dark treads, bright edges, widening toward camera
 * ------------------------------------------------------------------ */
function Stairs() {
  const steps = useMemo(() => {
    const out = [];
    for (let i = 0; i < STAIRS.count; i++) {
      const k = i / (STAIRS.count - 1);
      const w = THREE.MathUtils.lerp(STAIRS.wBottom, STAIRS.wTop, k);
      const h = (i + 1) * STAIRS.rise;
      out.push({
        args: [w, h, STAIRS.run],
        pos: [0, h / 2, STAIRS.zBottom - i * STAIRS.run - STAIRS.run / 2],
      });
    }
    return out;
  }, []);

  return (
    <group>
      {steps.map((s, i) => (
        <group key={i} position={s.pos}>
          <mesh>
            <boxGeometry args={s.args} />
            <meshBasicMaterial color="#050507" />
          </mesh>
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(...s.args)]} />
            <lineBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.45 - i * 0.012}
            />
          </lineSegments>
        </group>
      ))}
      {/* light pooling on the treads */}
      <Glow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, TOP_Y + 0.02, TOP_Z + 2]}
        scale={[9, 12, 1]}
        color="#9a7dff"
        opacity={0.22}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Figure — silhouette at the threshold
 * ------------------------------------------------------------------ */
function Figure() {
  const black = <meshBasicMaterial color="#000000" />;
  return (
    <group position={[0, TOP_Y, TOP_Z + 1.15]} scale={1}>
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.115, 16, 16]} />
        {black}
      </mesh>
      <mesh position={[0, 1.02, 0]}>
        <cylinderGeometry args={[0.13, 0.17, 0.62, 12]} />
        {black}
      </mesh>
      <mesh position={[-0.19, 1.05, 0]} rotation={[0, 0, 0.12]}>
        <cylinderGeometry args={[0.045, 0.04, 0.62, 8]} />
        {black}
      </mesh>
      <mesh position={[0.19, 1.05, 0]} rotation={[0, 0, -0.12]}>
        <cylinderGeometry args={[0.045, 0.04, 0.62, 8]} />
        {black}
      </mesh>
      <mesh position={[-0.085, 0.35, 0]}>
        <cylinderGeometry args={[0.075, 0.055, 0.72, 10]} />
        {black}
      </mesh>
      <mesh position={[0.085, 0.35, 0]}>
        <cylinderGeometry args={[0.075, 0.055, 0.72, 10]} />
        {black}
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Terrain — ridged-noise wireframe mountains flanking a flat corridor
 * ------------------------------------------------------------------ */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi),
    b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1),
    d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function ridged(x, y) {
  let v = 0,
    amp = 0.5,
    f = 0.055;
  for (let i = 0; i < 5; i++) {
    v += amp * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1));
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

function Terrain({ side = 1 }) {
  const geom = useMemo(() => {
    const W = 62,
      L = 170,
      SEG_W = 62,
      SEG_L = 150;
    const g = new THREE.PlaneGeometry(W, L, SEG_W, SEG_L);
    g.rotateX(-Math.PI / 2);
    const cx = side * (3 + W / 2);
    const cz = -35;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const mask = THREE.MathUtils.smoothstep(Math.abs(x), 3.5, 17);
      const h = Math.pow(ridged(x, z), 1.7) * 13 * mask;
      pos.setY(i, h);
    }
    g.translate(cx, 0.02, cz);
    g.computeVertexNormals();
    return g;
  }, [side]);

  return (
    <group>
      {/*
        Occluding fill. Opaque, so it renders before the transparent wireframe
        pass and writes depth — anything behind a ridge fails the depth test.
        polygonOffset pushes it a hair away from the camera so the wireframe
        sitting on the same triangles still wins. Fragments below FILL_FLOOR are
        discarded so the flat ground either side keeps showing the floor grid.
      */}
      <mesh geometry={geom}>
        <shaderMaterial
          fog={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          vertexShader={`
            varying float vH;
            void main(){
              vH = position.y;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying float vH;
            void main(){
              if (vH < ${FILL_FLOOR}) discard;
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
          `}
        />
      </mesh>

      {/* visible line pass */}
      <mesh geometry={geom}>
        <meshBasicMaterial
          color="#ffffff"
          wireframe
          transparent
          opacity={0.42}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Floating wireframe solids
 * ------------------------------------------------------------------ */
const SOLIDS = [
  { geo: "ico", p: [7.5, 7.2, -2], s: 0.95, spin: [0.1, 0.14] },
  { geo: "box", p: [-8.5, 4.6, 1], s: 1.5, spin: [0.08, 0.11] },
  { geo: "box", p: [-6.4, 8.4, -6], s: 0.9, spin: [-0.12, 0.07] },
  { geo: "dode", p: [9.2, 3.1, -1], s: 0.85, spin: [0.09, -0.1] },
  { geo: "octa", p: [-11.5, 8.9, 3], s: 1.0, spin: [0.13, 0.06] },
  { geo: "ico", p: [12, 9.6, 2], s: 1.15, spin: [-0.07, 0.12] },
  { geo: "box", p: [5.6, 11.0, -8], s: 0.7, spin: [0.1, -0.09] },
];

function Solid({ geo, p, s, spin }) {
  const ref = useRef();
  const t0 = useMemo(() => Math.random() * 10, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.rotation.x = t * spin[0];
    ref.current.rotation.y = t * spin[1];
    ref.current.position.y = p[1] + Math.sin(t * 0.35 + t0) * 0.28;
  });
  const G = {
    ico: <icosahedronGeometry args={[s, 0]} />,
    box: <boxGeometry args={[s * 1.4, s * 1.4, s * 1.4]} />,
    dode: <dodecahedronGeometry args={[s, 0]} />,
    octa: <octahedronGeometry args={[s, 0]} />,
  }[geo];

  return (
    <group ref={ref} position={p}>
      <mesh>
        {G}
        <meshBasicMaterial color="#08080c" />
      </mesh>
      <mesh scale={1.001}>
        {G}
        <meshBasicMaterial
          color="#ffffff"
          wireframe
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Stars
 * ------------------------------------------------------------------ */
function Stars({ count = 900 }) {
  const geom = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 90 + Math.random() * 110;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(THREE.MathUtils.lerp(1, -0.15, Math.random()));
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.7 + 2;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      size[i] = 0.5 + Math.pow(Math.random(), 3) * 2.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return g;
  }, [count]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += dt;
  });

  return (
    <points geometry={geom}>
      <shaderMaterial
        transparent
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`
          attribute float aSize; varying float vT;
          uniform float uTime;
          void main(){
            vT = 0.65 + 0.35 * sin(uTime * 1.6 + position.x * 0.4 + position.z * 0.3);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (260.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={`
          varying float vT;
          void main(){
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = pow(max(1.0 - d, 0.0), 2.0);
            gl_FragColor = vec4(vec3(1.0), a * vT);
          }
        `}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ *
 * Camera rig — subtle pointer parallax
 * ------------------------------------------------------------------ */
function Rig() {
  const { camera, pointer } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 1.5 - camera.position.x) * 0.035;
    camera.position.y += (2.9 + pointer.y * 0.7 - camera.position.y) * 0.035;
    camera.lookAt(LOOK_AT);
  });
  return null;
}

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */
export default function PortalScene({ scale = 60 }: { scale?: number }) {
  return (
    <group scale={scale}>
      {/* <color attach="background" args={["#000000"]} />
      <fog attach="fog" args={["#000000", 22, 115]} /> */}

      {/* <Stars /> */}
      <gridHelper
        args={[300, 300, "#ffffff", "#ffffff"]}
        position={[0, 0, -20]}
      >
        <lineBasicMaterial
          attach="material"
          color="#ffffff"
          transparent
          opacity={0.22}
        />
      </gridHelper>

      <Terrain side={-1.05} />
      <Terrain side={1.05} />

      {/* <Stairs />
      <Portal />
      <Figure />
      {SOLIDS.map((s, i) => (
        <Solid key={i} {...s} />
      ))} */}

      {/* <Rig /> */}

      {/* <EffectComposer>
          <Bloom intensity={1.35} luminanceThreshold={0.22} luminanceSmoothing={0.5} mipmapBlur radius={0.75} />
          <Vignette offset={0.28} darkness={0.85} />
        </EffectComposer> */}
    </group>
  );
}
