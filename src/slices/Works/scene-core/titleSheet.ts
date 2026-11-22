import * as THREE from "three";

import {
  frameAt,
  makeFrame,
  surfaceNormal,
  surfacePoint,
  type CompiledPath,
} from "./path";

/**
 * A rectangle of artwork laid on the wall: the sheet the section title is
 * printed on.
 *
 * It is the wall itself, sampled again — every vertex is a {@link surfacePoint}
 * of the same path the grid is built from — so wherever the wall curls, the
 * sheet curls with it, and the type rolls over the throat's bend and on round
 * the ceiling because that is where the surface goes, not because anything
 * here animates it.
 *
 * Across the strip the mapping is free. The wrap bends the strip around its
 * centre line without stretching it — a strip `2*PI*tube` wide stays that wide
 * at every wrap — so a world unit across the flat wall is still a world unit
 * once it has curled.
 *
 * Along it the mapping is the whole job. The throat pitches the spine over a
 * radius, and the crown sits on the *inside* of that turn, so a stretch of
 * spine buys well under the same length of crown: about 0.6 of it at the
 * opening preset's figures. Rows laid out by spine distance would print the
 * type squashed to that across the bend. So the rows are laid out by arc length
 * along the crown instead — measured once into a table — and the letters keep
 * their proportions all the way over. Off the crown they stretch or squash a
 * little with their distance from it, which over a title's width is a few
 * percent and reads as the surface bending rather than as the type distorting.
 */

/** crown arc length against spine distance, sampled */
export type CrownTable = {
  s: Float64Array;
  L: Float64Array;
};

/**
 * Arc length along the crown (u = 0) between spine distances `from` and `to`,
 * measured from `origin` — so `L` is negative above it and positive below.
 */
export function crownTable(
  path: CompiledPath,
  from: number,
  to: number,
  origin: number,
  samples = 2048,
): CrownTable {
  const s = new Float64Array(samples + 1);
  const L = new Float64Array(samples + 1);

  const fr = makeFrame();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();

  let acc = 0;
  let zero = 0;

  for (let i = 0; i <= samples; i++) {
    s[i] = from + ((to - from) * i) / samples;
    surfacePoint(0, frameAt(path, s[i], fr), p);

    if (i > 0) acc += p.distanceTo(q);
    q.copy(p);
    L[i] = acc;

    if (s[i] <= origin) zero = acc;
  }

  for (let i = 0; i <= samples; i++) L[i] -= zero;

  return { s, L };
}

/** the spine distance at which the crown has run `l` from the table's origin */
export function spineAtCrown(table: CrownTable, l: number) {
  const { s, L } = table;
  const n = L.length - 1;

  if (l <= L[0]) return s[0];
  if (l >= L[n]) return s[n];

  let lo = 0;
  let hi = n;

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid] <= l) lo = mid;
    else hi = mid;
  }

  const t = (l - L[lo]) / Math.max(1e-9, L[hi] - L[lo]);
  return s[lo] + (s[hi] - s[lo]) * t;
}

export type SheetOptions = {
  /** crown arc length at which the sheet's top edge sits */
  top: number;
  /** the sheet's size on the surface, in world units */
  width: number;
  height: number;
  /** grid resolution: columns across, rows down */
  cols: number;
  rows: number;
  /**
   * How far in off the surface, towards the axis, in world units.
   *
   * The shell behind the grid is built from chords between the grid's own
   * vertices, and across a curled strip a chord sits *nearer* the axis than the
   * surface it spans — by about four units at a cell's width and a full wrap.
   * A sheet on the true surface would be behind those chords and lose to them
   * in the depth test in patches; a few units in clears them.
   */
  inset: number;
};

/**
 * The sheet's geometry. UVs run 0..1 left to right and 0..1 *top to bottom*,
 * matching a texture uploaded with its first row first.
 */
export function wallSheet(
  path: CompiledPath,
  table: CrownTable,
  opts: SheetOptions,
): THREE.BufferGeometry {
  const { top, width, height, cols, rows, inset } = opts;

  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
  const index: number[] = [];

  const fr = makeFrame();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    frameAt(path, spineAtCrown(table, top + v * height), fr);

    // the strip is `2*PI*tube` across at every wrap, so a world width is a
    // fixed share of it — see the note at the top of the file
    const perU = 2 * Math.PI * fr.tube;

    for (let c = 0; c <= cols; c++) {
      const h = c / cols;
      const u = ((h - 0.5) * width) / perU;

      surfacePoint(u, fr, p);
      surfaceNormal(u, fr, n);
      p.addScaledVector(n, -inset);

      const i = r * (cols + 1) + c;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      uvs[i * 2] = h;
      uvs[i * 2 + 1] = v;
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);

  return geometry;
}
