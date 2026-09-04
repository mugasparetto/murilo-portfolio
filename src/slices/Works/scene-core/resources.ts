import * as THREE from "three";

import { buildTunnel, type TunnelGeometry } from "./geometry";
import { frameAt, makeFrame, type CompiledPath } from "./path";
import { tunnelPath } from "./presets";
import {
  makeFluidMaterial,
  makeGridMaterial,
  makeShellMaterial,
} from "./tunnelShader";

/**
 * Everything the section draws with, built once and kept.
 *
 * ── Why this is a module singleton and not a `useMemo` ────────────────────
 *
 * Two reasons, and they point the same way.
 *
 * The first is that it is true. There is only ever one Works section on the
 * page, its input is a module constant, and fifty thousand vertices of wall is
 * not something to rebuild because a section scrolled out of the registry's
 * margin and back in, or because a development double-mount asked twice.
 * {@link tunnelPath} is a singleton for exactly this reason and this is the
 * rest of the same object.
 *
 * The second is that a frame loop has to *write* to all of it — a uniform, an
 * opacity, a draw range, a buffer of beam vertices, sixty times a second. A
 * value that came out of a hook is not allowed to be written to (React's
 * compiler enforces it, and it is right to: a component that mutates its own
 * memo is lying about what it depends on). A value that came out of a plain
 * function call is nobody's memo and can be handled the way three.js expects.
 *
 * Nothing here is disposed, which is the honest consequence of the above: these
 * live as long as the page does. The alternative — disposing on unmount and
 * rebuilding on the way back — is the hitch this is avoiding.
 */

export type PatchMaterials = {
  lines: THREE.LineBasicMaterial;
  fill: THREE.MeshBasicMaterial;
};

export type TunnelResources = {
  path: CompiledPath;
  build: TunnelGeometry;

  /** the wireframe, and the solid shell behind it that fills the depth buffer */
  gridMat: THREE.ShaderMaterial;
  shellMat: THREE.ShaderMaterial;

  /** the fluid, on the disc ahead of you and on the pane once you are through */
  poolMat: THREE.ShaderMaterial;
  washMat: THREE.ShaderMaterial;

  /** where the disc goes, or null when the path has no pool */
  poolFrame: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    radius: number;
  } | null;

  /** the beams from each patch's corners out to its card, rewritten every frame */
  beams: THREE.BufferGeometry;
  beamMat: THREE.LineBasicMaterial;

  /** one pair per card slot, because each fades on its own */
  patchMats: PatchMaterials[];
};

/** four beams and four frame edges, two vertices each */
export const SEGMENTS_PER_CARD = 8;

/**
 * Keyed by column count, which is the only thing that can differ: a coarse
 * pointer gets fewer columns. At most two entries ever, and a tablet docked to
 * a mouse mid-session keeps both rather than rebuilding on the swap.
 */
const cache = new Map<number, TunnelResources | null>();

export function tunnelResources(radial: number): TunnelResources | null {
  const hit = cache.get(radial);
  if (hit !== undefined) return hit;

  const path = tunnelPath();
  const build = buildTunnel(path, radial);

  if (!build) {
    cache.set(radial, null);
    return null;
  }

  let poolFrame: TunnelResources["poolFrame"] = null;

  if (path.pool != null) {
    const fr = makeFrame();
    frameAt(path, path.pool, fr);

    poolFrame = {
      position: fr.pos.clone(),
      // the disc's local +Z is the tunnel's -T, so this faces you
      quaternion: fr.quat.clone(),
      radius: fr.tube * 1.06,
    };
  }

  const count = Math.max(1, build.patches.length) * SEGMENTS_PER_CARD * 2;
  const beams = new THREE.BufferGeometry();

  beams.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  beams.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );

  // Never culled either, for the reason ./geometry gives: it is rewritten every
  // frame from points all over the tunnel, so a bounding volume would be stale
  // the moment it was computed.

  const washMat = makeFluidMaterial(0, 3.4);
  // it hangs a hundred units in front of the camera and is the last thing drawn,
  // so it has nothing to test against and nothing to write for
  washMat.depthTest = false;
  washMat.depthWrite = false;

  const resources: TunnelResources = {
    path,
    build,
    gridMat: makeGridMaterial(),
    shellMat: makeShellMaterial(),
    poolMat: makeFluidMaterial(1, 2.4),
    washMat,
    poolFrame,
    beams,
    beamMat: new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
    patchMats: build.patches.map(() => ({
      lines: new THREE.LineBasicMaterial({
        color: 0xcaf4ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      fill: new THREE.MeshBasicMaterial({
        color: 0x7fe3ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    })),
  };

  cache.set(radial, resources);
  return resources;
}
