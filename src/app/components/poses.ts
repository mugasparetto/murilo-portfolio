/**
 * The camera poses <ScrollRig /> moves between, one per section.
 *
 * They live here rather than inline in <SceneManager /> because scene geometry
 * sometimes has to line up with the *screen* — the About title's margins, say.
 * A mesh can only work out where the viewport edges fall if it knows the pose
 * its section is viewed from, and reading that from the live camera would tie
 * it to wherever the scroll and the parallax happen to have left it this frame.
 */

export type Pose = {
  position: [number, number, number];
  lookAt: [number, number, number];
  /**
   * How much pointer sway this pose wants, as a fraction of <ParallaxRig />'s
   * `strength`. Defaults to 1 — the full amount — and <ScrollRig /> eases
   * between the two ends of a window along with the pose itself.
   *
   * It lives on the pose for the same reason the pose lives here: it is a fact
   * about how a section is *looked at*, and it has to stay true no matter which
   * other sections exist or what order the windows end up in.
   */
  parallax?: number;
};

/**
 * The hero, looking up the steps at the door. A wide shot, where a big sway
 * reads as the scene having depth — so it takes the full parallax.
 */
export const HERO_POSE: Pose = {
  position: [0, 200, 3380],
  lookAt: [0, 820, 0],
};

/**
 * The about section, square on to the head — the look direction is straight
 * down -Z, so a plane at constant z is parallel to the screen and its frustum
 * is a plain `2 * tan(fov / 2) * distance`.
 *
 * It's also the last pose the rig holds, so everything from the end of that
 * window down the page is seen from exactly here.
 */
export const ABOUT_POSE: Pose = {
  position: [0, -800, 3380],
  lookAt: [0, -800, 0],
  // a close-up with text held against it, where the hero's sway is just the
  // words wobbling
  parallax: 0.23,
};

/**
 * Where the viewport edges fall in world coordinates, for something sitting at
 * depth `z` and viewed from `pose`.
 *
 * This is the bridge the note at the top of this file describes, written down:
 * a mesh has no viewport, so anything that has to line up with the *screen* —
 * the About title's margins, the falloff that fades its grid out — projects
 * the frustum of the pose its section is held at rather than reading the live
 * camera, which is only ever wherever the scroll and the parallax left it this
 * frame.
 *
 * Only valid for a pose whose look direction is straight down -Z. That makes a
 * plane at constant z parallel to the screen and the projection a plain
 * `2 * tan(fov / 2) * distance`. {@link ABOUT_POSE} is one of those;
 * {@link HERO_POSE}, which pitches up at the door, is not.
 */
export function poseFrame(pose: Pose, fov: number, aspect: number, z: number) {
  const distance = pose.position[2] - z;
  const halfFov = (fov * Math.PI) / 180 / 2;
  const height = 2 * Math.tan(halfFov) * distance;

  return {
    height,
    width: height * aspect,
    /** world x/y the viewport is centred on */
    center: [pose.position[0], pose.position[1]] as [number, number],
    /** world y of the viewport's top edge */
    top: pose.position[1] + height / 2,
  };
}
