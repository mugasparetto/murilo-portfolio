"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import {
  emergence,
  makeFrame,
  sightline,
  smoothstep,
} from "../scene-core/path";
import { TUNNEL } from "../scene-core/presets";
import { SEGMENTS_PER_CARD, tunnelResources } from "../scene-core/resources";
import { cardCount, cardSlot } from "./cardSlots";
import { flight } from "./flight";

/**
 * The cards, and the cells they come out of.
 *
 * Three things move together here, and they have to agree to the pixel or the
 * illusion goes: the patch of grid that lights up on the wall, four beams
 * leaving its corners, and a card sitting on the plane those beams arrive at.
 * The first two are geometry. The third is markup — see ./WorksCards for why —
 * so it is placed by projecting the same four corners the beams end on.
 *
 * That is the whole trick to the alignment. The card's corners are built by
 * stepping along the camera's own right and up vectors, so whatever the camera
 * is doing they project to an *axis-aligned* screen rectangle; a `translate`
 * and a `scale` then land the element exactly on it, with no perspective
 * transform on the element and no rounding to argue about.
 *
 * Runs at priority 0.6: after <Scene /> has placed the camera at 0.5, before
 * <EffectComposer /> draws with it at 1. See <Scene />, where that ordering is
 * set out at length — it is what keeps the markup and the geometry in the same
 * frame as each other.
 */

export default function TunnelCards({ radial }: { radial: number }) {
  const size = useThree((s) => s.size);
  const res = tunnelResources(radial);

  const scratch = useMemo(
    () => ({
      frame: makeFrame(),
      anchor: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      back: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      corners: [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ],
    }),
    [],
  );

  /** whether each card is laid out, so `display` is only written on a change */
  const shown = useRef<boolean[]>([]);

  useFrame((state) => {
    // for <Scene />'s reason: a frame callback may not write to anything it
    // closed over from render
    const live = tunnelResources(radial);
    if (!live) return;

    const { path, build, beams, patchMats } = live;

    const pos = beams.attributes.position.array as Float32Array;
    const col = beams.attributes.color.array as Float32Array;
    let n = 0;

    const put = (x: THREE.Vector3, y: THREE.Vector3, g: number) => {
      pos[n] = x.x;
      pos[n + 1] = x.y;
      pos[n + 2] = x.z;
      pos[n + 3] = y.x;
      pos[n + 4] = y.y;
      pos[n + 5] = y.z;
      // the beams' own colour, dimmed by `g` — over black that is the fade
      col[n] = col[n + 3] = g * 0.55;
      col[n + 1] = col[n + 4] = g * 0.89;
      col[n + 2] = col[n + 5] = g;
      n += 6;
    };

    const hide = (i: number) => {
      if (!shown.current[i]) return;

      const el = cardSlot(i);
      if (el) el.style.display = "none";
      shown.current[i] = false;
    };

    if (!flight.active) {
      for (let i = 0; i < build.patches.length; i++) {
        hide(i);
        patchMats[i].lines.opacity = 0;
        patchMats[i].fill.opacity = 0;
      }

      beams.setDrawRange(0, 0);
      return;
    }

    const camera = state.camera;
    const filled = cardCount();
    const reach = TUNNEL.fogFar * TUNNEL.scale;

    camera.matrixWorld.extractBasis(scratch.right, scratch.up, scratch.back);
    scratch.fwd.copy(scratch.back).negate();

    const hw = (TUNNEL.cardWorld * TUNNEL.scale) / 2;
    const hh = hw * (TUNNEL.cardH / TUNNEL.cardW);

    for (let i = 0; i < build.patches.length; i++) {
      const patch = build.patches[i];
      const mat = patchMats[i];

      // A path may offer more slots than the CMS has works. The extras keep
      // their geometry — it costs nothing while it is dark — and simply never
      // light up, rather than the preset having to be edited every time a count
      // that lives somewhere else entirely changes.
      const e =
        i < filled ? emergence(patch.s - flight.s, patch.aim, path.scale) : 0;

      mat.lines.opacity = Math.min(1, e * 1.5) * 0.95;
      mat.fill.opacity = e * 0.16;

      if (e < 0.01) {
        hide(i);
        for (let z = 0; z < SEGMENTS_PER_CARD; z++) {
          put(patch.centre, patch.centre, 0);
        }
        continue;
      }

      // push the card off the wall, towards the axis
      scratch.anchor
        .copy(patch.centre)
        .addScaledVector(patch.inward, smoothstep(e) * patch.tube * 0.55);

      const corners = scratch.corners;
      corners[0]
        .copy(scratch.anchor)
        .addScaledVector(scratch.right, -hw)
        .addScaledVector(scratch.up, hh);
      corners[1]
        .copy(scratch.anchor)
        .addScaledVector(scratch.right, hw)
        .addScaledVector(scratch.up, hh);
      corners[2]
        .copy(scratch.anchor)
        .addScaledVector(scratch.right, hw)
        .addScaledVector(scratch.up, -hh);
      corners[3]
        .copy(scratch.anchor)
        .addScaledVector(scratch.right, -hw)
        .addScaledVector(scratch.up, -hh);

      for (let c = 0; c < 4; c++) put(patch.corners[c], corners[c], e * 0.5);
      for (let c = 0; c < 4; c++) put(corners[c], corners[(c + 1) % 4], e);

      const el = cardSlot(i);
      if (!el) continue;

      // behind the camera, where `project` would fold it back into frame
      const depth = scratch.tmp
        .copy(scratch.anchor)
        .sub(camera.position)
        .dot(scratch.fwd);

      if (depth < 0.5) {
        hide(i);
        continue;
      }

      // Fade over the distance the geometry fades over, hide anything still
      // round a corner, and go with the water once it has closed over. The
      // sightline is the one thing the 3D parts don't need: they depth-test
      // against the shell, and DOM cannot.
      const fade = Math.min(1, Math.max(0, (reach - depth) / (reach * 0.4)));
      const alpha =
        smoothstep(e) *
        fade *
        sightline(
          path,
          camera.position,
          flight.s,
          scratch.anchor,
          patch.s,
          scratch.frame,
        ) *
        (1 - flight.submersion);

      if (alpha < 0.01) {
        hide(i);
        continue;
      }

      scratch.a.copy(corners[0]).project(camera);
      scratch.b.copy(corners[2]).project(camera);

      const x0 = (scratch.a.x * 0.5 + 0.5) * size.width;
      const y0 = (-scratch.a.y * 0.5 + 0.5) * size.height;
      const x1 = (scratch.b.x * 0.5 + 0.5) * size.width;
      const y1 = (-scratch.b.y * 0.5 + 0.5) * size.height;

      if (!shown.current[i]) {
        el.style.display = "flex";
        shown.current[i] = true;
      }

      const scale = Math.abs(x1 - x0) / TUNNEL.cardW;
      const left = Math.min(x0, x1).toFixed(1);
      const top = Math.min(y0, y1).toFixed(1);

      el.style.transform = `translate(${left}px,${top}px) scale(${scale.toFixed(4)})`;
      el.style.opacity = alpha.toFixed(3);
    }

    beams.attributes.position.needsUpdate = true;
    beams.attributes.color.needsUpdate = true;
    beams.setDrawRange(0, n / 3);
  }, 0.6);

  if (!res) return null;

  return (
    <>
      {res.build.patches.map((patch, i) => (
        <group key={i}>
          <mesh
            geometry={patch.fill}
            material={res.patchMats[i].fill}
            renderOrder={2}
            frustumCulled={false}
            dispose={null}
          />
          <lineSegments
            geometry={patch.lines}
            material={res.patchMats[i].lines}
            renderOrder={3}
            frustumCulled={false}
            dispose={null}
          />
        </group>
      ))}

      <lineSegments
        geometry={res.beams}
        material={res.beamMat}
        renderOrder={4}
        frustumCulled={false}
        dispose={null}
      />
    </>
  );
}
