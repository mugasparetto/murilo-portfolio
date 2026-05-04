import { useRef, useMemo, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A 2D point in UV space [0,1] where (0,0) = bottom-left, (1,1) = top-right */
export type UV = [number, number];

interface PolygonSpriteProps {
  texture: THREE.Texture;
  /** Polygon vertices in UV space [0,1]. Defined once, clockwise or CCW – doesn't matter. */
  polygon: UV[];
  position?: [number, number, number];
  scale?: [number, number, number] | number;
  /** Fired when the pointer is pressed down inside the polygon */
  onPointerDown?: () => void;
  /** Fired when the pointer is released, after a press that started inside the polygon */
  onPointerUp?: () => void;
  /** Render a coloured debug overlay so you can tune the polygon */
  debug?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Point-in-polygon test using the ray-casting algorithm.
 * Works for any simple (non-self-intersecting) polygon.
 */
function pointInPolygon(px: number, py: number, polygon: UV[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Unproject a raw PointerEvent into the mesh's local UV space [0,1].
 * Builds its own ray so it is completely independent of R3F's raycaster —
 * multiple sprites at the same position all get tested individually.
 */
function pointerToUV(
  event: PointerEvent,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  gl: THREE.WebGLRenderer,
): UV | null {
  const rect = gl.domElement.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Plane at the sprite's world position, facing the camera
  const spriteWorldPos = new THREE.Vector3();
  mesh.getWorldPosition(spriteWorldPos);

  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  normal.negate();

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    normal,
    spriteWorldPos,
  );

  const hitPoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;

  // worldToLocal fully inverts the world matrix (including scale),
  // so localPoint is already in geometry space [-0.5, 0.5].
  const localPoint = mesh.worldToLocal(hitPoint.clone());

  // PlaneGeometry spans [-0.5, 0.5] → remap to UV [0, 1]
  const u = localPoint.x + 0.5;
  const v = localPoint.y + 0.5;

  return [u, v];
}

/**
 * Build a BufferGeometry whose shape exactly matches the UV polygon.
 * UV coords [0,1] are remapped to local plane space [-0.5, 0.5].
 *
 * Assumes a CONVEX polygon. Vertices may be in any winding order —
 * the signed-area check auto-corrects CW input to CCW before
 * running the fan triangulation: (0,1,2), (0,2,3), (0,3,4) …
 */
function buildPolygonGeometry(polygon: UV[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  // Shoelace signed area: positive = CCW, negative = CW
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  const ordered = area > 0 ? [...polygon].reverse() : polygon;

  const verts: number[] = [];
  for (const [u, v] of ordered) {
    verts.push(u - 0.5, v - 0.5, 0);
  }

  // Fan triangulation — valid for any convex polygon
  const indices: number[] = [];
  for (let i = 1; i < ordered.length - 1; i++) {
    indices.push(0, i, i + 1);
  }

  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PolygonSprite({
  texture,
  polygon,
  position = [0, 0, 0],
  scale = 1,
  onPointerDown,
  onPointerUp,
  debug = false,
}: PolygonSpriteProps) {
  // meshRef is used only for world-space math — not for R3F raycasting.
  const meshRef = useRef<THREE.Mesh>(null!);
  const { camera, gl } = useThree();
  const isPressedRef = useRef(false);

  const normalizedScale: [number, number, number] =
    typeof scale === "number" ? [scale, scale, scale] : scale;

  const debugGeometry = useMemo(
    () => (debug ? buildPolygonGeometry(polygon) : null),
    [debug, polygon],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!meshRef.current) {
        console.warn("[PolygonSprite] meshRef not ready");
        return;
      }

      // Ensure world matrix is current — required for getWorldPosition / worldToLocal
      meshRef.current.updateWorldMatrix(true, false);

      const uv = pointerToUV(event, meshRef.current, camera, gl);

      if (!uv) return;

      const hit = pointInPolygon(uv[0], uv[1], polygon);

      if (hit) {
        isPressedRef.current = true;
        onPointerDown?.();
      }
    };

    const handlePointerUp = () => {
      if (!isPressedRef.current) return;
      isPressedRef.current = false;
      onPointerUp?.();
    };

    const canvas = gl.domElement;
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [camera, gl, polygon, onPointerDown, onPointerUp]);

  return (
    <group position={position} scale={normalizedScale}>
      {/* Visible sprite — raycast disabled so R3F never interferes */}
      <mesh ref={meshRef} raycast={() => null} renderOrder={10}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Debug overlay — shaped exactly like the polygon ── */}
      {debug && debugGeometry && (
        <mesh
          position={[0, 0, 0.001]}
          geometry={debugGeometry}
          raycast={() => null}
        >
          <meshBasicMaterial
            transparent
            opacity={0.35}
            color="#0088ff"
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
