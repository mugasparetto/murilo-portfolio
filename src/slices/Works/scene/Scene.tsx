"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { ABOUT_POSE } from "@/app/components/poses";
import { useCoarsePointer } from "@/app/hooks/pointer";
import { useScrollY } from "@/app/hooks/ScrollY";

import { visibleRange } from "../scene-core/geometry";
import { frameAt, makeFrame, smoothstep } from "../scene-core/path";
import {
  flightDistance,
  TUNNEL,
  wallColumnCount,
  wallHandoverVh,
  worksSectionVh,
} from "../scene-core/presets";
import { tunnelResources } from "../scene-core/resources";
import { flight } from "./flight";
import TunnelCards from "./TunnelCards";
import { worksProgress } from "./worksScroll";

/**
 * The Works section: a wall that curls into a tunnel, and a flight down it.
 *
 * The shape and the arithmetic are in ../scene-core/path — read that first, it
 * is where the one idea lives. This file is the wiring: once a frame it turns
 * the section's scroll into a distance along the spine, and everything else
 * follows from that number.
 *
 * ── The camera, and who is holding it ─────────────────────────────────────
 *
 * Every other section is placed by <ScrollRig /> lerping between two poses.
 * This one cannot be: the camera has to follow an arc-length parameterised
 * spine, and it *rolls* — a banked turn is a segment property here — which a
 * `lookAt` and a world up vector cannot express at all. So while the section is
 * on screen this takes the camera directly.
 *
 * The priority is load-bearing, and 0.5 is not arbitrary. <EffectComposer />
 * renders at 1, so anything that wants to be *in* the frame it draws has to run
 * below that; <TunnelCards /> follows at 0.6 and projects against the camera
 * this leaves, which is the same camera the composer is about to use. Written
 * after the composer instead — where <ParallaxRig /> sits, at 10 — the DOM
 * cards would be a frame ahead of the grid they are anchored to, and on a fast
 * scroll that reads as the cards swimming against the wall.
 *
 * Nothing has to hand the camera back, either. <ParallaxRig /> keeps writing it
 * at 10 whether this ran or not, so the last thing to touch the camera in any
 * frame is always the pose the rest of the site is held at — which means that
 * on the first frame this stops writing, that pose is already there and the
 * section leaves without a jump. Below `md`, where no parallax rig is mounted,
 * <ScrollRig /> does the same job at priority 0.
 *
 * The handover the other way is seamless for a different reason: TUNNEL_ORIGIN
 * puts the far end of the lead-in exactly on ABOUT_POSE, so progress 0 *is*
 * where the rig left off, pointed the same way.
 */

/** the camera at aim 0 is the spine frame pitched back: facing the wall */
const ROT_X90 = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);

/**
 * The pose the rest of the page is looked at from, as a point to measure the
 * pointer sway against — see the frame loop, which takes the sway rather than
 * inventing one.
 */
const ABOUT_EYE = new THREE.Vector3(...ABOUT_POSE.position);

/** how far in front of the camera the submerged wash hangs — well clear of `near` */
const WASH_DIST = 120;

const BLACK = new THREE.Color(0x000000);
/** the water glowing back up the last stretch of tunnel */
const POOL_TINT = new THREE.Color(0x07203c);

export default function Scene() {
  const coarse = useCoarsePointer();
  // shared with the About section, which rules its grid on the same lattice
  const radial = wallColumnCount(coarse);

  // Not a hook: see ../scene-core/resources, which is where the geometry, the
  // materials and the reason they live outside React all are.
  const res = tunnelResources(radial);

  const { scrollY } = useScrollY();
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  /**
   * The window the wall's grid comes up over, and this section's own scroll in
   * the units that window is quoted in.
   *
   * Both off `wallHandoverVh`, which is also what ../../About/scene/Scene runs
   * its half of the same fade from — see there, and see the write in the frame
   * loop for what the two halves are actually crossing.
   */
  const flightVh = useMemo(() => Math.max(1, worksSectionVh() - 100), []);
  const handover = useMemo(() => Math.max(0, wallHandoverVh()), []);

  const root = useRef<THREE.Group>(null);
  const wash = useRef<THREE.Mesh>(null);
  const tinted = useRef(false);

  const scratch = useMemo(
    () => ({
      frame: makeFrame(),
      rig: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      qWall: new THREE.Quaternion(),
      qSway: new THREE.Quaternion(),
      clear: new THREE.Color(),
    }),
    [],
  );

  // The fluid is written in screen space, so the pane needs the shape of the
  // screen. The disc is a circle and keeps 1.
  useEffect(() => {
    const live = tunnelResources(radial);
    if (!live) return;

    live.washMat.uniforms.uAspect.value = size.width / Math.max(1, size.height);
  }, [radial, size]);

  // Whatever the section did to the clear colour, undo it on the way out.
  useEffect(
    () => () => {
      if (tinted.current) gl.setClearColor(BLACK, 1);
    },
    [gl],
  );

  useFrame((state) => {
    const group = root.current;
    // Looked up here rather than closed over from render: a Map hit, and the
    // one shape React's compiler will let a frame callback write to. Everything
    // below writes — uniforms, draw ranges, a clear colour.
    const live = tunnelResources(radial);
    if (!group || !live) return;

    const { path, build } = live;
    const progress = worksProgress(scrollY.current);

    // Above the section, or before it has been measured. Nothing is drawn and
    // nothing is written — the camera is already where the rigs put it, because
    // they run every frame whether this does or not.
    const active = progress > 0;

    group.visible = active;
    flight.active = active;

    if (!active) {
      if (tinted.current) {
        gl.setClearColor(BLACK, 1);
        tinted.current = false;
      }
      return;
    }

    const t = progress > 1 ? 1 : progress;
    const s = flightDistance(t);
    const fr = frameAt(path, s, scratch.frame);

    // ── The wall's grid, coming up as the About section's goes out ────────
    //
    // The two are one lattice on one plane at one level — see {@link WALL_Z} —
    // so the handover is a cross-fade or it is nothing. Drawn at full strength
    // from the first frame, this one is simply laid on top of the copy that is
    // still going out, and the grid is half as bright again for as long as
    // that takes: a flare in the middle of the move the fade exists to hide.
    //
    // Safe to run on the whole material rather than on the opening stretch of
    // it, and that is the draw range's doing rather than luck: everything the
    // frame can see for the whole of this window is flat wall, because the
    // preset is held to a run long enough to keep it so, and everything past
    // the throat is behind the shell.
    live.gridMat.uniforms.uOpacity.value =
      handover <= 0 ? 1 : smoothstep((t * flightVh) / handover);

    /* ---- the camera ------------------------------------------------- */

    const camera = state.camera;

    // ── The sway, taken rather than invented ─────────────────────────────
    //
    // Both halves of it, read before anything is written, because what is on
    // the camera right now *is* the sway. <ParallaxRig /> runs at priority 10 —
    // after this and after the composer — and <ScrollRig /> parks its pose on
    // ABOUT_POSE for the whole of the page below the About section, so what the
    // rig has left on the camera is that pose plus its offset. At that pose the
    // un-swayed orientation is the identity quaternion, which is what makes the
    // rotation readable the same way the position is: it is the whole of what
    // is there. (Below `md` no rig is mounted and <ScrollRig /> writes the pose
    // itself, so both come out as nothing — which is also right, since nothing
    // else sways down there either.)
    //
    // Taking them is the point. The wall this section opens on is the About
    // section's grid, so a sway of its own — of any size — would slide that
    // grid sideways on the frame the flight took it over and keep sliding it as
    // its own settled in. And the turn matters as much as the shift: the rig
    // looks at a target that moves a fraction of the offset with it, which is
    // only a few thousandths of a radian but lands three pixels out at the edge
    // of the frame and nothing at all in the middle — a mismatch shaped exactly
    // like the pointer, and so one you find by moving the mouse. The rig's own
    // damping is already in both numbers, so there is nothing left to ease.
    scratch.rig.subVectors(camera.position, ABOUT_EYE);

    // Unless the rig has not run yet: on the first frame after a reload deep
    // enough in the page to start inside this section, the camera is still
    // wherever the canvas made it and the difference is a hundred times a sway.
    // Nothing to be continuous with on that frame anyway.
    if (scratch.rig.lengthSq() > (fr.tube * 0.25) ** 2) {
      scratch.rig.setScalar(0);
      scratch.qSway.identity();
    } else {
      scratch.qSway.copy(camera.quaternion);
    }

    // The spine frame IS the down-the-tunnel orientation, and facing the wall
    // is that same frame pitched back 90 degrees — so the blend between them is
    // a pure pitch about a shared right vector, and the slerp is exact rather
    // than merely short.
    scratch.qWall.copy(fr.quat).multiply(ROT_X90);
    camera.quaternion.copy(scratch.qWall).slerp(fr.quat, smoothstep(fr.aim));

    // Taken off the un-swayed orientation, which is the basis the rig measured
    // its offset in — reading them here rather than after the turn below is the
    // difference between a handover that is exact and one that is merely close.
    scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    scratch.up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // and now the sway's turn, in the camera's own frame so that it still means
    // left/right and up/down on the screen once the tunnel has rolled
    camera.quaternion.multiply(scratch.qSway);
    scratch.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

    // The offset in that same basis rather than the world's. At the pose the
    // rig holds the two are the same pair of axes, so at the handover this is
    // the rig's camera exactly — position and orientation both.
    camera.position
      .copy(fr.pos)
      .addScaledVector(scratch.right, scratch.rig.x)
      .addScaledVector(scratch.up, scratch.rig.y);
    // <TunnelCards /> projects against this a fraction of a priority later, and
    // three only refreshes the inverse of its own accord at render time
    camera.updateMatrixWorld();

    /* ---- how much of the tunnel to draw ------------------------------ */

    // One object spans the whole flight, so frustum culling can never help: the
    // visible stretch is a range of the index buffer instead. See
    // ../scene-core/geometry, which is what orders the indices to make it one.
    const reach = TUNNEL.fogFar * TUNNEL.scale;
    const [i0, i1] = visibleRange(build.sList, s, reach);

    const lineFrom = build.rowStartLine[i0];
    build.grid.setDrawRange(lineFrom, build.rowStartLine[i1 + 1] - lineFrom);

    const triFrom = build.rowStartTri[i0];
    build.shell.setDrawRange(triFrom, build.rowStartTri[i1 + 1] - triFrom);

    /* ---- the fluid --------------------------------------------------- */

    const now = state.clock.elapsedTime;
    live.poolMat.uniforms.uTime.value = now;
    live.washMat.uniforms.uTime.value = now;

    let submersion = 0;

    if (live.poolFrame && path.pool != null) {
      const scale = TUNNEL.scale;
      const dPool = path.pool - s;

      submersion = 1 - smoothstep((dPool + 6 * scale) / (16 * scale));
      live.washMat.uniforms.uFade.value = submersion;

      const pd = live.poolFrame.position.distanceTo(camera.position);
      live.poolMat.uniforms.uFade.value = Math.min(
        1,
        Math.max(0, (reach * 1.5 - pd) / (reach * 0.8)),
      );

      // the water glows back up the last stretch of tunnel. The clear colour is
      // safe to take: this section is the only thing on screen while it holds
      // the camera, and the effect is undone the moment it lets go.
      const tint = (1 - smoothstep(dPool / (90 * scale))) * 0.8;
      gl.setClearColor(scratch.clear.copy(BLACK).lerp(POOL_TINT, tint), 1);
      tinted.current = true;
    }

    const pane = wash.current;
    if (pane) {
      pane.visible = submersion > 0.002;

      if (pane.visible) {
        const cam = camera as THREE.PerspectiveCamera;
        const h = 2 * Math.tan((cam.fov * Math.PI) / 360) * WASH_DIST * 1.05;

        pane.position
          .copy(camera.position)
          .addScaledVector(scratch.fwd, WASH_DIST);
        pane.quaternion.copy(camera.quaternion);
        pane.scale.set(h * cam.aspect, h, 1);
      }
    }

    flight.s = s;
    flight.progress = t;
    flight.submersion = submersion;
  }, 0.5);

  if (!res) return null;

  return (
    <group ref={root} visible={false}>
      {/* the shell first: it writes depth, which is what stops the grid being
          an X-ray of every turn at once */}
      <mesh
        geometry={res.build.shell}
        material={res.shellMat}
        renderOrder={0}
        frustumCulled={false}
        // the geometry and the material outlive this node — see ../scene-core/resources
        dispose={null}
      />

      <lineSegments
        geometry={res.build.grid}
        material={res.gridMat}
        renderOrder={1}
        frustumCulled={false}
        dispose={null}
      />

      {res.poolFrame && (
        // a disc filling the tube's cross-section. It writes depth too, so it
        // hides the tunnel beyond it while near rings still draw in front of it
        <mesh
          material={res.poolMat}
          position={res.poolFrame.position}
          quaternion={res.poolFrame.quaternion}
          scale={res.poolFrame.radius}
          renderOrder={0}
          frustumCulled={false}
        >
          <circleGeometry args={[1, 96]} />
        </mesh>
      )}

      {/* Once through the surface the same material takes the whole frame. A
          pane held in front of the camera rather than a fullscreen pass,
          because a pass would have to run outside <EffectComposer /> and so
          outside the bloom and the grain the rest of the page is graded
          through. */}
      <mesh
        ref={wash}
        material={res.washMat}
        renderOrder={20}
        frustumCulled={false}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <TunnelCards radial={radial} />
    </group>
  );
}
