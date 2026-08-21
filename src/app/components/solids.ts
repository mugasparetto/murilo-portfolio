import * as THREE from "three";

/**
 * The five Platonic-ish solids the site draws — the sky's field in
 * <Sky /> and, at icon size, the tiles on the About section's skills list.
 *
 * They live here rather than in either of those because "the same solids"
 * has to stay literally true: the icons are a projection of these very
 * geometries, so a shape retuned for the sky turns up in the list as well.
 */
export type SolidKind =
  | "cube"
  | "pyramid"
  | "icosahedron"
  | "octahedron"
  | "tetrahedron";

/**
 * Ordered, so anything that wants "a different solid each time" — the skills
 * list cycling down its rows — can index into it and get a stable answer.
 */
export const SOLID_KINDS: readonly SolidKind[] = [
  "pyramid",
  "cube",
  "octahedron",
  "icosahedron",
  "tetrahedron",
];

/**
 * One fresh geometry per kind. They're all authored at circumradius ≈ 1 so a
 * single `scale` sets a solid's size in world units, whatever shape it is —
 * the cube is 1.15 a side because that's the cube whose corners sit on the
 * unit sphere.
 *
 * The caller owns what comes back and has to dispose it.
 */
export function createSolidGeometries(): Record<
  SolidKind,
  THREE.BufferGeometry
> {
  return {
    cube: new THREE.BoxGeometry(1.15, 1.15, 1.15),
    // square-base pyramid: a cone with 4 segments
    pyramid: new THREE.ConeGeometry(1, 1.5, 4, 1),
    icosahedron: new THREE.IcosahedronGeometry(1, 0),
    octahedron: new THREE.OctahedronGeometry(1, 0),
    tetrahedron: new THREE.TetrahedronGeometry(1, 0),
  };
}

/**
 * A solid reduced to what a hidden-line drawing needs, with the GPU's
 * conveniences — split vertices, quads cut into triangles — undone.
 *
 * Everything is a flat typed array and every face-to-vertex hop is an index,
 * because this is walked on every animation frame by however many icons are on
 * screen: no objects are allocated in the loop that draws one.
 */
export type SolidWireframe = {
  /** unique vertices, xyz triples, scaled so the furthest sits at radius 1 */
  vertices: Float32Array;
  /** one outward normal per triangle, xyz */
  normals: Float32Array;
  /** a vertex index on each triangle — enough to place its plane in space */
  anchors: Uint16Array;
  /**
   * `[a, b, faceA, faceB]` per edge. Only real edges are here: the diagonal
   * that cuts a cube's face into two triangles has the same normal on both
   * sides and is dropped, exactly as THREE.EdgesGeometry drops it.
   *
   * `faceB` repeats `faceA` on an open edge, so the visibility test can read
   * both without branching. These solids are all closed, so it never happens.
   */
  edges: Uint32Array;
};

/** ~1e-4 world units, comfortably finer than any feature and coarser than fp noise. */
const weld = (v: number) => Math.round(v * 1e4);

/** cos 1° — THREE.EdgesGeometry's default threshold, and it agrees with it here. */
const COPLANAR = Math.cos(THREE.MathUtils.degToRad(1));

const cache = new Map<SolidKind, SolidWireframe>();

/**
 * The wireframe for a kind, built once per process and shared by every icon
 * drawing it — the data is read-only and the drawing keeps its own scratch.
 */
export function solidWireframe(kind: SolidKind): SolidWireframe {
  const hit = cache.get(kind);
  if (hit) return hit;

  const geometries = createSolidGeometries();
  const built = extract(geometries[kind]);
  Object.values(geometries).forEach((g) => g.dispose());

  cache.set(kind, built);
  return built;
}

function extract(geometry: THREE.BufferGeometry): SolidWireframe {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.attributes.position as THREE.BufferAttribute;

  // --- weld the duplicated corners back together. A box carries 24 vertices
  // for 8 corners, since each face wants its own normal; a drawing wants the 8.
  const verts: number[] = [];
  const byPosition = new Map<string, number>();

  const indexOf = (i: number) => {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const key = `${weld(x)},${weld(y)},${weld(z)}`;
    const seen = byPosition.get(key);
    if (seen !== undefined) return seen;

    const id = verts.length / 3;
    verts.push(x, y, z);
    byPosition.set(key, id);
    return id;
  };

  const tris: number[] = [];
  const normals: number[] = [];
  const anchors: number[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 3) {
    const ia = indexOf(i);
    const ib = indexOf(i + 1);
    const ic = indexOf(i + 2);

    // a cone's cap fan can hand back a triangle that welded down to a line
    if (ia === ib || ib === ic || ic === ia) continue;

    a.fromArray(verts, ia * 3);
    b.fromArray(verts, ib * 3);
    c.fromArray(verts, ic * 3);

    // counter-clockwise winding, so this points out of the solid
    n.copy(c).sub(b).cross(t.copy(a).sub(b)).normalize();

    tris.push(ia, ib, ic);
    normals.push(n.x, n.y, n.z);
    anchors.push(ia);
  }

  if (source !== geometry) source.dispose();

  // --- edges, each one carrying the faces it separates
  const faces = new Map<string, [number, number]>();

  for (let f = 0; f < tris.length / 3; f++) {
    for (let e = 0; e < 3; e++) {
      const p = tris[f * 3 + e];
      const q = tris[f * 3 + ((e + 1) % 3)];
      const key = p < q ? `${p},${q}` : `${q},${p}`;

      const pair = faces.get(key);
      if (pair) pair[1] = f;
      else faces.set(key, [f, f]);
    }
  }

  const edges: number[] = [];

  faces.forEach(([fa, fb], key) => {
    // the two halves of a triangulated quad share a plane, and the seam
    // between them is not an edge of the solid
    if (fa !== fb) {
      const dot =
        normals[fa * 3] * normals[fb * 3] +
        normals[fa * 3 + 1] * normals[fb * 3 + 1] +
        normals[fa * 3 + 2] * normals[fb * 3 + 2];

      if (dot > COPLANAR) return;
    }

    const [p, q] = key.split(",");
    edges.push(Number(p), Number(q), fa, fb);
  });

  // --- circumradius 1, so every kind draws into the same box at the same
  // scale and the icons read as one set
  let radius = 0;
  for (let i = 0; i < verts.length; i += 3) {
    radius = Math.max(radius, Math.hypot(verts[i], verts[i + 1], verts[i + 2]));
  }

  const vertices = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) vertices[i] = verts[i] / radius;

  return {
    vertices,
    normals: new Float32Array(normals),
    anchors: new Uint16Array(anchors),
    edges: new Uint32Array(edges),
  };
}
