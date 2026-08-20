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
