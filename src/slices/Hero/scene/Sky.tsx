"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Stars } from "@react-three/drei";

import OutlinedSolid from "../../../app/components/OutlinedSolid"; // adjust path if needed
import InstancedStars from "./Star";
import ShootingStars from "./ShootingStars";
import { createSolidGeometries, SolidKind } from "@/app/components/solids";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { defaultParams } from "../scene-core/params";

const STARS_COUNT = 200;
const DOME_RADIUS = 6000;

/* -------------------------------------------------------------------------
   Where the solids go

   Placing them by world coordinates means retuning the whole field every time
   the viewport changes shape, so each one is authored in the frame that
   actually matters: `sx`/`sy` are NDC at the resting camera pose — -1..1 is
   edge to edge, ±1 sits exactly on the frame — and `z` is the world depth it
   floats at. `skyPosition` turns that back into world space for the current
   aspect, so the field spreads across the whole sky on any screen while the
   depths (and therefore the parallax between them) stay fixed.

   Two things to respect when moving one:

   - past z ≈ -10000, keep `sy` above ~0.2. The mountain range runs from
     z -20000 to -10000 and its peaks reach y ≈ 3330, so a far solid placed
     lower than that ends up buried inside the ridge.
   - the DOM overlays claim their own patches of frame. The name's solid caps
     run sy 0.71..0.93 across everything inside sx ±0.95, so a solid parked
     there is simply painted over; its stroked echoes below (down to sy 0.38)
     are see-through and make a good home. The headline block sits around
     sx -0.95..-0.25 / sy 0.05..0.30 and the circular text around sx 0.34 /
     sy -0.05. All of those are laid out against the viewport too, so they
     hold wherever the frame ends up.

   A placement can also opt out entirely and give `position: [x, y, z]` in
   world space instead of `sx`/`sy`/`z`. Nothing reframes it — it lands where
   the numbers say on every screen, which is what you want when a solid has to
   sit against a fixed piece of the world (tucked behind a specific ridge, say)
   rather than against the frame.

   Each solid carries its placements mobile-first, the same way the CSS reads:
   `base` is what runs below md, `md` takes over from md up, and a solid with
   no `md` just keeps its `base` everywhere. The two are independent — depth
   included — so a solid can be NDC-framed on phones, where the frame is tall
   and narrow and the field has to re-spread to stay visible, and pinned to
   hand-tuned world coordinates on the wide layouts it was composed against.
   ------------------------------------------------------------------------- */

/** Authored against the frame: resolved to world space for the current aspect. */
type FramedPlacement = {
  /** NDC x at the resting pose: -1 is the left edge, 1 the right */
  sx: number;
  /** NDC y at the resting pose: the horizon sits at about -0.5 */
  sy: number;
  /** world depth */
  z: number;
  position?: never;
};

/** Authored in world space: used verbatim, whatever shape the frame takes. */
type PinnedPlacement = {
  /** world [x, y, z] */
  position: readonly [number, number, number];
  sx?: never;
  sy?: never;
  z?: never;
};

type Placement = FramedPlacement | PinnedPlacement;

type SolidSpec = {
  kind: SolidKind;
  /** radius in world units — the base geometries are all built at radius 1 */
  size: number;
  /** placement below md, and the fallback whenever `md` is absent */
  base: Placement;
  /** placement from md up */
  md?: Placement;
};

const SOLIDS: SolidSpec[] = [
  {
    kind: "cube",
    size: 400,
    base: { sx: 0.54, sy: -0.12, z: -12300 },
    md: { position: [5800, 3200, -12300] },
  },
  {
    kind: "icosahedron",
    size: 370,
    base: { sx: -0.5, sy: 0.12, z: -15500 },
    md: { position: [-2400, 2600, -9500] },
  },
  {
    kind: "pyramid",
    size: 220,
    base: { sx: 0.35, sy: 0.34, z: -13000 },
    md: { position: [3000, 4700, -13000] },
  },
  {
    kind: "octahedron",
    size: 2420,
    base: { sx: -0.55, sy: -0.45, z: -27000 },
    md: { position: [-8600, 1800, -27000] },
  },
];

/** The placement in force at the current width. */
const placementOf = (s: SolidSpec, mdUp: boolean) =>
  mdUp && s.md ? s.md : s.base;

/** Depth of a placement however it was authored — the tiers key off this. */
const depthOf = (p: Placement) => (p.position ? p.position[2] : p.z);

/**
 * Outline weight and brightness by depth. `LineMaterial.linewidth` is in
 * screen pixels, so without this a solid 14000 units away would be drawn with
 * exactly the same heavy stroke as one at 3300 and the field would read flat —
 * thinning and dimming with distance is what buys the depth.
 */
const TIERS = [
  // { until: -6000, linewidth: 1.6, opacity: 1 },
  { until: -26000, linewidth: 1, opacity: 0.4 },
  { until: -Infinity, linewidth: 2, opacity: 0.4 },
];

const tierOf = (z: number) => TIERS.findIndex((t) => z > t.until);

// The resting camera pose the layout is measured against. The pointer parallax
// and the scroll rig both move away from this pose; neither redefines it, so
// resolving the field once against it is enough.
const BASE_EYE = new THREE.Vector3(
  defaultParams.cameraX,
  defaultParams.cameraY,
  defaultParams.cameraZ,
);

const VIEW_FWD = new THREE.Vector3(
  defaultParams.targetX,
  defaultParams.targetY,
  defaultParams.targetZ,
)
  .sub(BASE_EYE)
  .normalize();

const VIEW_RIGHT = VIEW_FWD.clone()
  .cross(new THREE.Vector3(0, 1, 0))
  .normalize();

const VIEW_UP = VIEW_RIGHT.clone().cross(VIEW_FWD).normalize();

// the camera's fov is vertical, hence the aspect only on the horizontal term
const TAN_V = Math.tan(THREE.MathUtils.degToRad(defaultParams.fov) / 2);

/** World point at depth `z` that projects to NDC (`sx`, `sy`) at the rest pose. */
function skyPosition(sx: number, sy: number, z: number, aspect: number) {
  const dir = VIEW_FWD.clone()
    .addScaledVector(VIEW_RIGHT, sx * TAN_V * aspect)
    .addScaledVector(VIEW_UP, sy * TAN_V);

  return BASE_EYE.clone().addScaledVector(dir, (z - BASE_EYE.z) / dir.z);
}

/** Resting world position of a placement, whichever frame it was authored in. */
function placementPosition(p: Placement, aspect: number) {
  return p.position
    ? new THREE.Vector3(...p.position)
    : skyPosition(p.sx, p.sy, p.z, aspect);
}

// deterministic per-solid jitter, same trick as <InstancedStars />: hand-tuning
// a spin and a bob for sixteen solids is noise, but they must not drift in
// lockstep either
const fract = (x: number) => x - Math.floor(x);
const rnd = (i: number, salt: number) =>
  fract(Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123);

export default function Sky() {
  const { size, gl } = useThree();
  const dpr = gl.getPixelRatio();
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });

  // one per SOLIDS entry, so the frame loop can move fill + outline together
  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  // --- geometries, one per kind and shared by every solid using it. All built
  // at radius 1; the per-solid `size` is the group scale. Defined next to
  // <SolidIcon />'s wireframes rather than here, since the About section's
  // skill icons are these same solids drawn flat.
  const geometries = useMemo(() => createSolidGeometries(), []);

  // --- edge geometries, also shared. <OutlinedSolid /> builds its own when it
  // isn't handed one, which would mean re-extracting the same edges sixteen
  // times over.
  const lineGeometries = useMemo(() => {
    const out = {} as Record<SolidKind, LineSegmentsGeometry>;

    (Object.keys(geometries) as SolidKind[]).forEach((kind) => {
      const edges = new THREE.EdgesGeometry(geometries[kind]);
      const g = new LineSegmentsGeometry();
      g.setPositions(
        (edges.attributes.position as THREE.BufferAttribute)
          .array as Float32Array,
      );
      edges.dispose();
      out[kind] = g;
    });

    return out;
  }, [geometries]);

  // --- fill material
  const blackMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "black" }),
    [],
  );

  // --- one fat line material per depth tier
  const lineMats = useMemo(
    () =>
      TIERS.map((tier) => {
        const m = new LineMaterial({
          color: 0xffffff,
          linewidth: tier.linewidth,
          resolution: new THREE.Vector2(size.width * dpr, size.height * dpr),
        });
        m.depthTest = true;
        m.depthWrite = false;
        m.transparent = true;
        m.opacity = tier.opacity;
        return m;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // keep resolution current (important for LineMaterial)
  useEffect(() => {
    lineMats.forEach((m) =>
      m.resolution.set(size.width * dpr, size.height * dpr),
    );
  }, [lineMats, size.width, size.height, dpr]);

  // cleanup
  useEffect(() => {
    return () => {
      Object.values(geometries).forEach((g) => g.dispose());
      Object.values(lineGeometries).forEach((g) => g.dispose());
      blackMat.dispose();
      lineMats.forEach((m) => m.dispose());
    };
  }, [geometries, lineGeometries, blackMat, lineMats]);

  // the placement in force at this width, and its resting world position —
  // re-resolved when the frame changes shape (so a framed placement keeps
  // spanning the sky) or when the layout crosses md
  const placements = useMemo(
    () => SOLIDS.map((s) => placementOf(s, up.md)),
    [up.md],
  );

  const layout = useMemo(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    return placements.map((p) => placementPosition(p, aspect));
  }, [placements, size.width, size.height]);

  const motion = useMemo(
    () =>
      SOLIDS.map((s, i) => ({
        spin: [
          s.kind === "octahedron"
            ? 0.03
            : (0.03 + rnd(i, 1) * 0.07) * (rnd(i, 2) < 0.5 ? -1 : 1),
          s.kind === "octahedron"
            ? 0.01
            : (0.03 + rnd(i, 3) * 0.07) * (rnd(i, 4) < 0.5 ? -1 : 1),
          0,
        ] as const,
        bob: s.kind === "octahedron" ? 200 : s.size * (0.15 + rnd(i, 7) * 0.2),
        bobSpeed: 0.28 + rnd(i, 8) * 0.27,
        phase: rnd(i, 9) * Math.PI * 2,
      })),
    [],
  );

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

    for (let i = 0; i < SOLIDS.length; i++) {
      const group = groupRefs.current[i];
      if (!group) continue;

      const base = layout[i];
      const m = motion[i];

      group.position.set(
        base.x,
        base.y + Math.sin(t * m.bobSpeed + m.phase) * m.bob,
        base.z,
      );

      group.rotation.x += delta * m.spin[0];
      group.rotation.y += delta * m.spin[1];
      group.rotation.z += delta * m.spin[2];
    }
  });

  return (
    <group>
      {SOLIDS.map((s, i) => (
        <group
          key={`${s.kind}-${i}`}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          <OutlinedSolid
            geometry={geometries[s.kind]}
            lineGeometry={lineGeometries[s.kind]}
            fillMaterial={blackMat}
            lineMaterial={lineMats[tierOf(depthOf(placements[i]))]}
            scale={s.size}
            // The terrain and the mountains are transparent with
            // depthWrite off, so they can only hide what was drawn before
            // them — and the transparent sort weighs renderOrder ahead of
            // distance. At the default 0 the outline (fill + 1) lands after
            // the terrain and paints over a ridge that is thousands of units
            // in front of it. -2 puts fill and outline both behind it.
            renderOrder={-2}
            // z-fighting + distance stability
            polygonOffset
            polygonOffsetFactor={2}
            polygonOffsetUnits={2}
            wireScale={1.002}
          />
        </group>
      ))}

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
      />
    </group>
  );
}
