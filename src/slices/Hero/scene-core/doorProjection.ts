import * as THREE from "three";

/**
 * Live, world-space description of the door quad.
 *
 * <Door /> writes it every frame and <Steps /> reads it to place the
 * reflection. Reading it off the mesh (instead of off `params`) is what keeps
 * the two in sync: the door also carries the parent group offset, the mobile
 * position/scale overrides and the scroll-driven shrink, none of which the raw
 * params know about.
 */
export type DoorProjection = {
  /** world position of the door center */
  position: THREE.Vector3;
  /** unit axes of the door plane, world space */
  right: THREE.Vector3;
  up: THREE.Vector3;
  normal: THREE.Vector3;
  /** half extents of the quad in world units (after scale) */
  halfSize: THREE.Vector2;
  /** 1 while the door is fully open, 0 once the scroll has closed it */
  strength: number;
};

export function createDoorProjection(): DoorProjection {
  return {
    position: new THREE.Vector3(),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(0, 0, 1),
    halfSize: new THREE.Vector2(400, 800),
    strength: 0,
  };
}
