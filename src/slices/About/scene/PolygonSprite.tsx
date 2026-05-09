import { useRef, useMemo, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ─── Throw tuning ─────────────────────────────────────────────────────────────

/**
 * Minimum world-space speed (units/s) at release required to trigger a throw.
 * Lower = easier to throw, higher = only fast flicks count.
 */
const THROW_SPEED_THRESHOLD = 500;

/**
 * Maximum world-space speed (units/s) the throw velocity is clamped to.
 * Prevents violent flicks from sending the sprite off-screen instantly.
 */
const MAX_THROW_SPEED = 1000;

/**
 * Multiplied against velocity every second (exponential decay).
 * 0.85 = 85 % of speed kept per second → stops in ~2–3 s.
 * Raise toward 1 for a longer glide, lower for a quick stop.
 */
const FRICTION = 0.25;

/**
 * How many recent pointer samples to average for the throw velocity.
 * More samples = smoother but slightly lags; fewer = snappier but noisier.
 */
const VELOCITY_SAMPLE_COUNT = 5;

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
 * Project a PointerEvent onto a THREE.Plane and return the world-space hit
 * point. Used during drag to move the sprite along its facing plane.
 */
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
  draggable = false,
  throwable = false,
  onPointerDown,
  onPointerUp,
  debug = false,
}: PolygonSpriteProps) {
  // meshRef is used only for world-space math — not for R3F raycasting.
  const meshRef = useRef<THREE.Mesh>(null!);
  // groupRef lets us mutate position during drag without a re-render.
  const groupRef = useRef<THREE.Group>(null!);
  const { camera, gl } = useThree();

  const isPressedRef = useRef(false);
  const isInsideRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Drag internals — kept in refs to avoid any re-render during movement.
  const dragPlane = useRef(new THREE.Plane());
  const dragOffset = useRef(new THREE.Vector3());

  // Throw internals
  // Ring buffer of recent (worldPosition, timestamp) samples taken during drag.
  type Sample = { pos: THREE.Vector3; t: number };
  const velocitySamples = useRef<Sample[]>([]);
  // Current throw velocity in world units/s; zeroed when stopped.
  const throwVelocity = useRef(new THREE.Vector3());

  const normalizedScale: [number, number, number] =
    typeof scale === "number" ? [scale, scale, scale] : scale;

  const debugGeometry = useMemo(
    () => (debug ? buildPolygonGeometry(polygon) : null),
    [debug, polygon],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!meshRef.current) return;

      meshRef.current.updateWorldMatrix(true, false);

      const uv = pointerToUV(event, meshRef.current, camera, gl);
      if (!uv) return;

      const hit = pointInPolygon(uv[0], uv[1], polygon);
      if (!hit) return;

      isPressedRef.current = true;
      document.body.style.cursor = "grabbing";
      onPointerDown?.();

      if (!draggable) return;

      // Build a drag plane that faces the camera and passes through the
      // sprite's current world position. This keeps the sprite under the
      // cursor regardless of camera angle, exactly like a billboard drag.
      const spriteWorldPos = new THREE.Vector3();
      meshRef.current.getWorldPosition(spriteWorldPos);

      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      normal.negate();
      dragPlane.current.setFromNormalAndCoplanarPoint(normal, spriteWorldPos);

      // World-space hit point on that plane
      const worldHit = pointerToWorldPlane(
        event,
        dragPlane.current,
        camera,
        gl,
      );
      if (!worldHit) return;

      // Offset = hit point minus group's current world position,
      // so the sprite doesn't jump to the cursor's centre.
      dragOffset.current.set(
        worldHit.x - groupRef.current.position.x,
        worldHit.y - groupRef.current.position.y,
        worldHit.z - groupRef.current.position.z,
      );

      isDraggingRef.current = true;
    };

    const handlePointerMove = (event: PointerEvent) => {
      // ── Drag movement ──────────────────────────────────────────────────────
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

          // Record sample for throw velocity estimation.
          if (throwable) {
            const samples = velocitySamples.current;
            samples.push({
              pos: groupRef.current.position.clone(),
              t: performance.now(),
            });
            // Keep only the most recent N samples.
            if (samples.length > VELOCITY_SAMPLE_COUNT) samples.shift();
          }
        }
        return;
      }

      // ── Hover detection ────────────────────────────────────────────────────
      if (!meshRef.current) return;
      meshRef.current.updateWorldMatrix(true, false);

      const uv = pointerToUV(event, meshRef.current, camera, gl);
      if (!uv) return;

      const hit = pointInPolygon(uv[0], uv[1], polygon);

      if (hit) {
        if (!isInsideRef.current) {
          isInsideRef.current = true;
          document.body.style.cursor = "grab";
        }
      } else {
        if (isInsideRef.current) {
          isInsideRef.current = false;
          document.body.style.cursor = "default";
        }
      }
    };

    const handlePointerUp = () => {
      if (!isPressedRef.current) return;
      isPressedRef.current = false;
      isDraggingRef.current = false;
      onPointerUp?.();
      document.body.style.cursor = isInsideRef.current ? "grab" : "default";

      // ── Throw ──────────────────────────────────────────────────────────────
      if (!throwable) return;

      const samples = velocitySamples.current;
      throwVelocity.current.set(0, 0, 0);

      if (samples.length >= 2) {
        // Average velocity across all consecutive sample pairs.
        const vel = new THREE.Vector3();
        for (let i = 1; i < samples.length; i++) {
          const dt = (samples[i].t - samples[i - 1].t) / 1000; // ms → s
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
  }, [camera, gl, polygon, draggable, throwable, onPointerDown, onPointerUp]);

  // ── Friction / coasting loop ───────────────────────────────────────────────
  // Runs every frame only when there is active throw velocity.
  useFrame((_, delta) => {
    if (!throwable) return;
    if (throwVelocity.current.lengthSq() < 1e-6) return;

    // Advance position by velocity × delta.
    groupRef.current.position.addScaledVector(throwVelocity.current, delta);

    // Exponential friction: v *= friction^delta  (frame-rate independent).
    const frictionFactor = Math.pow(FRICTION, delta);
    throwVelocity.current.multiplyScalar(frictionFactor);

    // Zero out once negligible to stop the loop.
    if (throwVelocity.current.length() < 0.01) {
      throwVelocity.current.set(0, 0, 0);
    }
  });

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
        />
      </mesh>

      {/* ── Debug overlay — shaped exactly like the polygon ── */}
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
}
