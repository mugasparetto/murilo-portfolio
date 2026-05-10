import {
  useRef,
  useMemo,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// New exported handle type
export type SpriteHandle = {
  getPosition: () => THREE.Vector3;
  setPosition: (v: THREE.Vector3) => void;
  getVelocity: () => THREE.Vector3;
  setVelocity: (v: THREE.Vector3) => void;
  getWorldPolygon: () => THREE.Vector2[]; // polygon in world XY space
  isDragging: () => boolean;
  getCentreBox: () => THREE.Box3 | null;
};

// ─── Throw tuning ─────────────────────────────────────────────────────────────

const THROW_SPEED_THRESHOLD = 400;
const MAX_THROW_SPEED = 1000;
const FRICTION = 0.2;
const VELOCITY_SAMPLE_COUNT = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A 2D point in UV space [0,1] where (0,0) = bottom-left, (1,1) = top-right */
export type UV = [number, number];

interface PolygonSpriteProps {
  texture: THREE.Texture;
  /** Polygon vertices in UV space [0,1]. Defined once, clockwise or CCW – doesn't matter. */
  polygon: UV[];
  position?: [number, number, number];
  scale?: [number, number, number] | number;
  /** Allow the sprite to be dragged around the scene. Default: false. */
  draggable?: boolean;
  /**
   * When true, releasing after a fast drag throws the sprite — it coasts
   * with friction until it stops. Requires draggable. Default: false.
   */
  throwable?: boolean;
  /**
   * Axis-aligned world-space box the sprite bounces inside.
   * Only the axes you specify are constrained — omit an axis pair to leave
   * that direction unbounded. Works during both throw and drag.
   * The polygon's own extents are automatically subtracted from each wall,
   * so the visible sprite edge never crosses the boundary.
   *
   * @example
   * bounds={{ min: [-10, -Infinity, -10], max: [10, Infinity, 10] }}
   */
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  /** Fired when the pointer is pressed down inside the polygon */
  onPointerDown?: () => void;
  /** Fired when the pointer is released, after a press that started inside the polygon */
  onPointerUp?: () => void;
  /** Render a coloured debug overlay so you can tune the polygon + bounds box */
  debug?: boolean;
  children?: React.ReactNode;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const localPoint = mesh.worldToLocal(hitPoint.clone());
  return [localPoint.x + 0.5, localPoint.y + 0.5];
}

function pointerToWorldPlane(
  event: PointerEvent,
  worldPlane: THREE.Plane,
  camera: THREE.Camera,
  gl: THREE.WebGLRenderer,
): THREE.Vector3 | null {
  const rect = gl.domElement.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const target = new THREE.Vector3();
  return raycaster.ray.intersectPlane(worldPlane, target)
    ? target.clone()
    : null;
}

function buildPolygonGeometry(polygon: UV[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  const ordered = area > 0 ? [...polygon].reverse() : polygon;

  const verts: number[] = [];
  for (const [u, v] of ordered) verts.push(u - 0.5, v - 0.5, 0);

  const indices: number[] = [];
  for (let i = 1; i < ordered.length - 1; i++) indices.push(0, i, i + 1);

  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Compute the X/Y half-extents of the polygon in world space.
 * UV coords map to [-0.5, 0.5] in local space, then get multiplied by scale.
 * These are subtracted from the bounds walls so the sprite's visible edge,
 * not just its centre, stays inside the boundary.
 */
function polygonExtents(polygon: UV[], scale: [number, number, number]) {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  for (const [u, v] of polygon) {
    const lx = (u - 0.5) * scale[0];
    const ly = (v - 0.5) * scale[1];
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  }
  return { minX, maxX, minY, maxY };
}

// ─── Component ────────────────────────────────────────────────────────────────

const PolygonSprite = forwardRef<SpriteHandle, PolygonSpriteProps>(
  function PolygonSprite(
    {
      texture,
      polygon,
      position = [0, 0, 0],
      scale = 1,
      draggable = false,
      throwable = false,
      bounds,
      onPointerDown,
      onPointerUp,
      debug = false,
      children,
    },
    ref,
  ) {
    const meshRef = useRef<THREE.Mesh>(null!);
    const groupRef = useRef<THREE.Group>(null!);
    const { camera, gl, scene } = useThree();

    const isPressedRef = useRef(false);
    const isInsideRef = useRef(false);
    const isDraggingRef = useRef(false);

    const dragPlane = useRef(new THREE.Plane());
    const dragOffset = useRef(new THREE.Vector3());

    type Sample = { pos: THREE.Vector3; t: number };
    const velocitySamples = useRef<Sample[]>([]);
    const throwVelocity = useRef(new THREE.Vector3());

    const normalizedScale = useMemo<[number, number, number]>(
      () => (typeof scale === "number" ? [scale, scale, scale] : scale),
      [scale],
    );

    const debugGeometry = useMemo(
      () => (debug ? buildPolygonGeometry(polygon) : null),
      [debug, polygon],
    );

    // Half-extents of the polygon in world space — used to inset the bounce walls
    // so the sprite's visible edge (not its centre) lands on the boundary.
    const extents = useMemo(
      () => polygonExtents(polygon, normalizedScale),
      [polygon, normalizedScale],
    );

    // centreBox: the region the group's CENTRE is allowed to move within.
    const centreBox = useMemo(() => {
      if (!bounds) return null;
      const { min, max } = bounds;
      const { minX, maxX, minY, maxY } = extents;
      return new THREE.Box3(
        new THREE.Vector3(
          isFinite(min[0]) ? min[0] - minX : -Infinity, // minX is negative, so subtract it
          isFinite(min[1]) ? min[1] - minY : -Infinity, // minY is negative, so subtract it
          min[2],
        ),
        new THREE.Vector3(
          isFinite(max[0]) ? max[0] - maxX : Infinity,
          isFinite(max[1]) ? max[1] - maxY : Infinity,
          max[2],
        ),
      );
    }, [bounds, extents]);

    // ── Debug: Box3Helper for the OUTER bounds ────────────────────────────────
    // Added imperatively to the scene so it renders in world space, independent
    // of the sprite's group transform, and aligns with the visible bounce walls.
    useEffect(() => {
      if (!debug || !bounds) return;

      const LARGE = 1e5;
      const safeBox = new THREE.Box3(
        new THREE.Vector3(
          Math.max(bounds.min[0], -LARGE),
          Math.max(bounds.min[1], -LARGE),
          Math.max(bounds.min[2], -LARGE),
        ),
        new THREE.Vector3(
          Math.min(bounds.max[0], LARGE),
          Math.min(bounds.max[1], LARGE),
          Math.min(bounds.max[2], LARGE),
        ),
      );

      const helper = new THREE.Box3Helper(safeBox, new THREE.Color(0x00ff88));
      scene.add(helper);
      return () => {
        scene.remove(helper);
      };
    }, [debug, bounds, scene]);

    useEffect(() => {
      const handlePointerDown = (event: PointerEvent) => {
        if (!meshRef.current) return;
        meshRef.current.updateWorldMatrix(true, false);

        const uv = pointerToUV(event, meshRef.current, camera, gl);
        if (!uv) return;
        if (!pointInPolygon(uv[0], uv[1], polygon)) return;

        isPressedRef.current = true;
        document.body.style.cursor = "grabbing";
        onPointerDown?.();

        if (!draggable) return;

        // Stop any in-flight throw when the user grabs again
        throwVelocity.current.set(0, 0, 0);

        const spriteWorldPos = new THREE.Vector3();
        meshRef.current.getWorldPosition(spriteWorldPos);

        const normal = new THREE.Vector3();
        camera.getWorldDirection(normal);
        normal.negate();
        dragPlane.current.setFromNormalAndCoplanarPoint(normal, spriteWorldPos);

        const worldHit = pointerToWorldPlane(
          event,
          dragPlane.current,
          camera,
          gl,
        );
        if (!worldHit) return;

        dragOffset.current.set(
          worldHit.x - groupRef.current.position.x,
          worldHit.y - groupRef.current.position.y,
          worldHit.z - groupRef.current.position.z,
        );

        isDraggingRef.current = true;
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (isDraggingRef.current && draggable) {
          const worldHit = pointerToWorldPlane(
            event,
            dragPlane.current,
            camera,
            gl,
          );
          if (worldHit && groupRef.current) {
            groupRef.current.position.set(
              worldHit.x - dragOffset.current.x,
              worldHit.y - dragOffset.current.y,
              worldHit.z - dragOffset.current.z,
            );

            // Clamp to the inset centre box during drag
            if (centreBox) {
              groupRef.current.position.clamp(centreBox.min, centreBox.max);
            }

            if (throwable) {
              const samples = velocitySamples.current;
              samples.push({
                pos: groupRef.current.position.clone(),
                t: performance.now(),
              });
              if (samples.length > VELOCITY_SAMPLE_COUNT) samples.shift();
            }
          }
          return;
        }

        if (!meshRef.current) return;
        meshRef.current.updateWorldMatrix(true, false);

        const uv = pointerToUV(event, meshRef.current, camera, gl);
        if (!uv) return;

        const hit = pointInPolygon(uv[0], uv[1], polygon);
        if (hit && !isInsideRef.current) {
          isInsideRef.current = true;
          document.body.style.cursor = "grab";
        } else if (!hit && isInsideRef.current) {
          isInsideRef.current = false;
          document.body.style.cursor = "default";
        }
      };

      const handlePointerUp = () => {
        if (!isPressedRef.current) return;
        isPressedRef.current = false;
        isDraggingRef.current = false;
        onPointerUp?.();
        document.body.style.cursor = isInsideRef.current ? "grab" : "default";

        if (!throwable) return;

        const samples = velocitySamples.current;
        throwVelocity.current.set(0, 0, 0);

        if (samples.length >= 2) {
          const vel = new THREE.Vector3();
          for (let i = 1; i < samples.length; i++) {
            const dt = (samples[i].t - samples[i - 1].t) / 1000;
            if (dt <= 0) continue;
            vel.add(
              new THREE.Vector3()
                .subVectors(samples[i].pos, samples[i - 1].pos)
                .divideScalar(dt),
            );
          }
          vel.divideScalar(samples.length - 1);

          if (vel.length() >= THROW_SPEED_THRESHOLD) {
            throwVelocity.current.copy(vel).clampLength(0, MAX_THROW_SPEED);
          }
        }

        velocitySamples.current = [];
      };

      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
      };
    }, [
      camera,
      gl,
      polygon,
      draggable,
      throwable,
      centreBox,
      onPointerDown,
      onPointerUp,
    ]);

    // ── Friction / coasting + bounce loop ────────────────────────────────────────
    useFrame((_, delta) => {
      if (!throwable) return;
      if (throwVelocity.current.lengthSq() < 1e-6) return;

      const pos = groupRef.current.position;
      const vel = throwVelocity.current;

      pos.addScaledVector(vel, delta);

      if (centreBox) {
        const b = centreBox;
        if (pos.x < b.min.x) {
          pos.x = b.min.x;
          vel.x = Math.abs(vel.x);
        } else if (pos.x > b.max.x) {
          pos.x = b.max.x;
          vel.x = -Math.abs(vel.x);
        }
        if (pos.y < b.min.y) {
          pos.y = b.min.y;
          vel.y = Math.abs(vel.y);
        } else if (pos.y > b.max.y) {
          pos.y = b.max.y;
          vel.y = -Math.abs(vel.y);
        }
        if (pos.z < b.min.z) {
          pos.z = b.min.z;
          vel.z = Math.abs(vel.z);
        } else if (pos.z > b.max.z) {
          pos.z = b.max.z;
          vel.z = -Math.abs(vel.z);
        }
      }

      vel.multiplyScalar(Math.pow(FRICTION, delta));
      if (vel.length() < 0.01) vel.set(0, 0, 0);
    });

    useImperativeHandle(
      ref,
      () => ({
        getPosition: () => groupRef.current.position.clone(),
        setPosition: (v) => groupRef.current.position.copy(v),
        getVelocity: () => throwVelocity.current.clone(),
        setVelocity: (v) => throwVelocity.current.copy(v),
        isDragging: () => isDraggingRef.current,
        getCentreBox: () => centreBox,

        getWorldPolygon: () => {
          const pos = groupRef.current.position;
          const s = normalizedScale;
          const INFLATE = -0.03; // tune this — in UV space

          // Compute centroid
          const cx = polygon.reduce((sum, [u]) => sum + u, 0) / polygon.length;
          const cy =
            polygon.reduce((sum, [, v]) => sum + v, 0) / polygon.length;

          return polygon.map(([u, v]) => {
            // Push vertex away from centroid by INFLATE amount
            const du = u - cx;
            const dv = v - cy;
            const len = Math.sqrt(du * du + dv * dv) || 1;
            const iu = u + (du / len) * INFLATE;
            const iv = v + (dv / len) * INFLATE;
            return new THREE.Vector2(
              pos.x + (iu - 0.5) * s[0],
              pos.y + (iv - 0.5) * s[1],
            );
          });
        },
      }),
      [polygon, normalizedScale, centreBox],
    );

    return (
      <group ref={groupRef} position={position}>
        {/* Visible sprite — raycast disabled so R3F never interferes */}
        <mesh
          ref={meshRef}
          scale={normalizedScale}
          raycast={() => null}
          renderOrder={10}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            alphaTest={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {children}

        {/* Debug: polygon overlay */}
        {debug && debugGeometry && (
          <mesh
            scale={normalizedScale}
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
  },
);

export default PolygonSprite;
