import * as THREE from "three";

export const SMOOTH_NORMAL = "aSmoothNormal";

const baked = new WeakSet<THREE.BufferGeometry>();

/**
 * Inverted-hull outlines push every vertex along its normal. That only produces
 * a closed rim if vertices sharing a position also share a normal — on a model
 * with hard edges the hull tears open at every seam.
 *
 * drei's <Outlines angle={...}> fixes that with three's `toCreasedNormals`,
 * which de-indexes the geometry and builds a whole new BufferGeometry per mesh.
 * With ~68 meshes that ran on every remount and was a large part of what made
 * the outlines expensive here.
 *
 * Instead we average the normals of co-located vertices once and store them in
 * an extra attribute. The geometry, its index buffer and its original normals
 * are left alone, so the fill material still shades exactly as before and the
 * hull can share the very same geometry instance.
 *
 * Runs once per geometry (results are cached on the geometry itself), during
 * model mount — i.e. in the same tick the GLB is already being parsed.
 */
export function bakeSmoothNormals(
  geometry: THREE.BufferGeometry,
  precision = 4,
) {
  if (baked.has(geometry)) return;
  baked.add(geometry);

  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");

  if (!position || !normal) return;

  const count = position.count;
  const factor = 10 ** precision;

  // vertex -> welded group, and the summed normal of every group
  const groupOfVertex = new Uint32Array(count);
  const groups = new Map<string, number>();
  const sums: number[] = [];

  for (let i = 0; i < count; i++) {
    const key =
      Math.round(position.getX(i) * factor) +
      "," +
      Math.round(position.getY(i) * factor) +
      "," +
      Math.round(position.getZ(i) * factor);

    let group = groups.get(key);

    if (group === undefined) {
      group = sums.length;
      groups.set(key, group);
      sums.push(0, 0, 0);
    }

    groupOfVertex[i] = group;
    sums[group] += normal.getX(i);
    sums[group + 1] += normal.getY(i);
    sums[group + 2] += normal.getZ(i);
  }

  const smooth = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const group = groupOfVertex[i];

    let x = sums[group];
    let y = sums[group + 1];
    let z = sums[group + 2];

    const length = Math.hypot(x, y, z);

    if (length > 1e-6) {
      x /= length;
      y /= length;
      z /= length;
    } else {
      // opposite normals cancelled out (paper-thin surface) — keep the original
      x = normal.getX(i);
      y = normal.getY(i);
      z = normal.getZ(i);
    }

    smooth[i * 3] = x;
    smooth[i * 3 + 1] = y;
    smooth[i * 3 + 2] = z;
  }

  geometry.setAttribute(SMOOTH_NORMAL, new THREE.BufferAttribute(smooth, 3));
}
