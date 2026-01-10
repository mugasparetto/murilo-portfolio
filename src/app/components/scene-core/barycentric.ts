import * as THREE from "three";

export function addBarycentricCoordinates(geometry: THREE.BufferGeometry) {
  const count = geometry.attributes.position.count;
  const barycentric = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 3) {
    barycentric[(i + 0) * 3 + 0] = 1;
    barycentric[(i + 0) * 3 + 1] = 0;
    barycentric[(i + 0) * 3 + 2] = 0;

    barycentric[(i + 1) * 3 + 0] = 0;
    barycentric[(i + 1) * 3 + 1] = 1;
    barycentric[(i + 1) * 3 + 2] = 0;

    barycentric[(i + 2) * 3 + 0] = 0;
    barycentric[(i + 2) * 3 + 1] = 0;
    barycentric[(i + 2) * 3 + 2] = 1;
  }

  geometry.setAttribute(
    "barycentric",
    new THREE.BufferAttribute(barycentric, 3)
  );
}
