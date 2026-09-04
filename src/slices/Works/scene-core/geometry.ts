import * as THREE from "three";

import {
  frameAt,
  makeFrame,
  surfaceNormal,
  surfacePoint,
  type CompiledPath,
} from "./path";
import { TUNNEL } from "./presets";

/**
 * The wall, built once.
 *
 * Marching along the spine with the rings spaced by the local cell size is what
 * keeps the squares square: the tube flares and narrows over the flight, and a
 * fixed ring spacing would stretch the cells wherever it did. Cell size is
 * `2*PI*tube / radial`, so a ring is exactly one cell further on than the last
 * whatever the radius is doing.
 *
 * ── Why the index buffer is ordered along the path ────────────────────────
 *
 * The obvious way to index a grid is one loop per direction: every longitudinal
 * line end to end, then every ring. That draws in two passes and both of them
 * touch the whole tunnel, which for a flight this long is thirty thousand world
 * units of geometry vertex-shaded on every frame to show the two thousand in
 * front of the camera.
 *
 * Ordering by *sample* instead — for each ring: its own forward segments, then
 * its own ring segments — makes every index for a given position along the
 * spine contiguous, so the visible stretch is one `setDrawRange`. `rowStartLine`
 * below is the offset table that makes it addressable, and ../scene/Scene sets
 * the range from the camera's distance each frame. The same trick, and a table
 * of its own, for the shell's triangles.
 */

export type TunnelGeometry = {
  grid: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  /** distance along the spine of every sample, ascending */
  sList: Float64Array;
  /** index into the line index buffer where each sample's segments begin */
  rowStartLine: Uint32Array;
  /** the same for the shell's triangles */
  rowStartTri: Uint32Array;
  patches: CardPatch[];
};

/** one card's highlighted cells, and the anchor its plane hangs off */
export type CardPatch = {
  /** the outline of the patch, following the surface between rings */
  lines: THREE.BufferGeometry;
  /** and the cells themselves, for the wash inside it */
  fill: THREE.BufferGeometry;
  /** distance along the spine of the patch's middle */
  s: number;
  /** the frame's `aim` there — how the card is approached, see `emergence` */
  aim: number;
  tube: number;
  /** centre of the patch on the surface */
  centre: THREE.Vector3;
  /** unit vector from there towards the axis: the way the card comes out */
  inward: THREE.Vector3;
  /** the patch's four corners, where the beams are anchored */
  corners: THREE.Vector3[];
};

/**
 * Above this the build is refused rather than attempted. A path long enough or
 * a column count high enough to reach it would spend seconds in the main thread
 * and hundreds of megabytes; better to draw nothing and say why.
 */
const MAX_VERTICES = 500_000;

export function buildTunnel(
  path: CompiledPath,
  radial: number,
): TunnelGeometry | null {
  const fr = makeFrame();
  const v = new THREE.Vector3();

  /* ---- where the rings go ------------------------------------------- */

  const sValues: number[] = [];
  const isRing: boolean[] = [];
  const ringAt: number[] = [];

  let s = 0;
  let guard = 0;

  while (s < path.total && guard++ < 30_000) {
    frameAt(path, s, fr);
    const cell = (2 * Math.PI * fr.tube) / radial;

    ringAt.push(sValues.length);
    sValues.push(s);
    isRing.push(true);

    for (let k = 1; k < TUNNEL.subdiv; k++) {
      sValues.push(s + (cell * k) / TUNNEL.subdiv);
      isRing.push(false);
    }

    s += cell;
  }

  ringAt.push(sValues.length);
  sValues.push(path.total);
  isRing.push(true);

  const uCount = radial + 1;
  const sCount = sValues.length;

  if (sCount * uCount > MAX_VERTICES) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[works tunnel] ${sCount * uCount} vertices is past the ${MAX_VERTICES} ceiling — shorten the path or drop the column count`,
      );
    }
    return null;
  }

  /* ---- the surface --------------------------------------------------- */

  const pos = new Float32Array(sCount * uCount * 3);
  const col = new Float32Array(sCount * uCount * 3);

  const base = new THREE.Color(TUNNEL.colorBase);
  const hot = new THREE.Color(TUNNEL.colorHot);
  const c = new THREE.Color();

  for (let i = 0; i < sCount; i++) {
    frameAt(path, Math.min(sValues[i], path.total), fr);

    // Brightest through the throat, where the wall is actually curling, and
    // at {@link TUNNEL.level} where it is flat — which is the level the About
    // section's grid hands over at. The two multipliers are what the wall gains
    // on top of that: a third again once it has closed into a tube, and a good
    // deal more than that while it is closing.
    const glow = Math.sin(Math.PI * Math.min(1, Math.max(0, fr.wrap)));
    c.copy(base)
      .lerp(hot, glow * 0.85)
      .multiplyScalar(TUNNEL.level * (1 + 0.36 * fr.wrap + 0.64 * glow));

    for (let j = 0; j < uCount; j++) {
      surfacePoint(-0.5 + j / radial, fr, v);

      const k = (i * uCount + j) * 3;
      pos[k] = v.x;
      pos[k + 1] = v.y;
      pos[k + 2] = v.z;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }

  /* ---- indices, ordered along the path -------------------------------- */

  const lineIdx: number[] = [];
  const rowStartLine = new Uint32Array(sCount + 1);

  for (let i = 0; i < sCount; i++) {
    rowStartLine[i] = lineIdx.length;

    if (i < sCount - 1) {
      for (let j = 0; j < uCount; j++) {
        lineIdx.push(i * uCount + j, (i + 1) * uCount + j);
      }
    }

    if (isRing[i]) {
      for (let j = 0; j < radial; j++) {
        lineIdx.push(i * uCount + j, i * uCount + j + 1);
      }
    }
  }

  rowStartLine[sCount] = lineIdx.length;

  const triIdx: number[] = [];
  const rowStartTri = new Uint32Array(sCount + 1);

  for (let i = 0; i < sCount; i++) {
    rowStartTri[i] = triIdx.length;

    if (i < sCount - 1) {
      for (let j = 0; j < radial; j++) {
        const a = i * uCount + j;
        const b = a + 1;
        const d = a + uCount;
        const e = d + 1;
        triIdx.push(a, d, b, b, d, e);
      }
    }
  }

  rowStartTri[sCount] = triIdx.length;

  /* ---- the two geometries, sharing one set of vertices ---------------- */

  const posAttr = new THREE.Float32BufferAttribute(pos, 3);

  const grid = new THREE.BufferGeometry();
  grid.setAttribute("position", posAttr);
  grid.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  grid.setIndex(lineIdx);

  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", posAttr);
  shell.setIndex(triIdx);

  // Neither carries a bounding sphere, and neither should. Both meshes are
  // mounted with `frustumCulled={false}`: one object spanning the whole flight
  // has a bounding sphere the size of the world, on screen at every scroll
  // position there is, so the draw range is the culling. Three only computes a
  // sphere when something asks, and with culling off and no raycasting on
  // either of them, nothing does.

  const patches = buildPatches(path, radial, sValues, isRing, ringAt);

  return {
    grid,
    shell,
    sList: Float64Array.from(sValues),
    rowStartLine,
    rowStartTri,
    patches,
  };
}

/* ==========================================================================
   The highlighted patches
   ========================================================================== */

function buildPatches(
  path: CompiledPath,
  radial: number,
  sValues: number[],
  isRing: boolean[],
  ringAt: number[],
): CardPatch[] {
  const fr = makeFrame();

  return path.cards.map((cd) => {
    // snap to real grid lines: the nearest ring, the nearest column. A patch
    // that did not would read as a decal laid over the wall rather than as
    // cells of it lighting up.
    let r0 = 0;
    for (let r = 0; r < ringAt.length; r++) {
      if (sValues[ringAt[r]] <= cd.s) r0 = r;
    }
    r0 = Math.max(
      0,
      Math.min(ringAt.length - 1 - cd.h, r0 - Math.floor(cd.h / 2)),
    );

    const a = ringAt[r0];
    const b = ringAt[r0 + cd.h];

    let j0 = Math.round((cd.u + 0.5) * radial - cd.w / 2);
    j0 = Math.max(0, Math.min(radial - cd.w, j0));

    // sample the patch on the surface, following the curve between rings
    const rows: THREE.Vector3[][] = [];
    const rowIsRing: boolean[] = [];

    for (let i = a; i <= b; i++) {
      frameAt(path, Math.min(sValues[i], path.total), fr);

      const row: THREE.Vector3[] = [];
      for (let j = j0; j <= j0 + cd.w; j++) {
        row.push(surfacePoint(-0.5 + j / radial, fr, new THREE.Vector3()));
      }

      rows.push(row);
      rowIsRing.push(isRing[i]);
    }

    const lp: number[] = [];
    const push = (x: THREE.Vector3, y: THREE.Vector3) => {
      lp.push(x.x, x.y, x.z, y.x, y.y, y.z);
    };

    for (let ri = 0; ri < rows.length - 1; ri++) {
      for (let cj = 0; cj <= cd.w; cj++) push(rows[ri][cj], rows[ri + 1][cj]);
    }
    for (let ri = 0; ri < rows.length; ri++) {
      if (!rowIsRing[ri]) continue;
      for (let cj = 0; cj < cd.w; cj++) push(rows[ri][cj], rows[ri][cj + 1]);
    }

    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));

    const fp: number[] = [];
    for (const row of rows) for (const pt of row) fp.push(pt.x, pt.y, pt.z);

    const fi: number[] = [];
    const stride = cd.w + 1;
    for (let ri = 0; ri < rows.length - 1; ri++) {
      for (let cj = 0; cj < cd.w; cj++) {
        const q = ri * stride + cj;
        fi.push(q, q + stride, q + 1, q + 1, q + stride, q + stride + 1);
      }
    }

    const fill = new THREE.BufferGeometry();
    fill.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    fill.setIndex(fi);

    // the anchor: the centre of the patch, and the direction to push the card
    const sMid = (sValues[a] + sValues[b]) / 2;
    const uMid = -0.5 + (j0 + cd.w / 2) / radial;

    frameAt(path, sMid, fr);

    const centre = surfacePoint(uMid, fr, new THREE.Vector3());
    const inward = surfaceNormal(uMid, fr, new THREE.Vector3()).negate();

    return {
      lines,
      fill,
      s: sMid,
      aim: fr.aim,
      tube: fr.tube,
      centre,
      inward,
      corners: [
        rows[0][0],
        rows[0][cd.w],
        rows[rows.length - 1][cd.w],
        rows[rows.length - 1][0],
      ],
    };
  });
}

/**
 * The stretch of samples worth drawing from a camera at `s`: everything within
 * the fade's reach, in both directions.
 *
 * Both, because "ahead along the spine" is not "ahead in view" for the whole
 * flight. On the wall the camera looks square across the spine while falling
 * down it, so the surface it can see runs as far behind it as in front; only
 * once `aim` has come up is forward the only direction that matters. A
 * symmetric window costs one extra fade's worth of geometry and is right at
 * both ends.
 */
export function visibleRange(sList: Float64Array, s: number, reach: number) {
  return [lowerBound(sList, s - reach), lowerBound(sList, s + reach)] as const;
}

function lowerBound(list: Float64Array, x: number) {
  let lo = 0;
  let hi = list.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}
