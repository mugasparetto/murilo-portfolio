/**
 * One CSS `vh`, in px — the unit the page is actually laid out in.
 *
 * Deliberately *not* `window.innerHeight / 100`. On a desktop browser the two
 * are the same number and it never comes up; on iOS they are two different
 * numbers and the gap between them is the height of Safari's address bar:
 *
 * - `vh` resolves against the **large** viewport — the page as it would be with
 *   the bar collapsed — and holds still while the bar animates. That is what
 *   `h-[250vh]` on the hero and `h-[350vh]` on the About section were measured
 *   in, and therefore where every section boundary really sits.
 * - `innerHeight` is the area visible **right now**, so it shrinks the moment
 *   the bar expands — which is precisely what scrolling back up the page does.
 *
 * So anything converting a scroll position into vh has to convert with this,
 * because the numbers it is compared against came out of CSS. Convert with
 * `innerHeight` instead and, with the bar out, the 250vh the camera thinks it
 * is crossing lands ~2.5 address bars above the 250vh the DOM is laid out at.
 * Between the two is a band of page where the camera has already finished its
 * flight and the About column has not yet begun to travel: the scroll runs and
 * nothing on screen moves.
 *
 * Measured off a probe because nothing reports it — `documentElement.clientHeight`
 * is the small viewport on iOS, i.e. `innerHeight` again.
 */
let cached = 0;
let watching = false;

function measure() {
  const probe = document.createElement("div");

  probe.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none";

  document.documentElement.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();

  return height;
}

/**
 * Drop the cached measurement on anything that can change what a `vh` is: a
 * real window resize, or a rotation.
 *
 * Invalidating rather than re-measuring means the layout read happens on the
 * next reader — a scroll handler or a frame — instead of inside the resize
 * handler, and at most once per frame however many resize events iOS fires
 * while the address bar animates. The value it comes back with is unchanged in
 * that case, which is the whole point of measuring in `vh`.
 */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;

  const invalidate = () => {
    cached = 0;
  };

  window.addEventListener("resize", invalidate, { passive: true });
  window.addEventListener("orientationchange", invalidate);
}

export function cssVh() {
  if (typeof document === "undefined") return 1;

  watch();

  if (cached <= 0) cached = measure() || window.innerHeight || 1;

  return cached;
}

/** A scroll position in px, as a number of `vh` down the page. */
export function pxToVh(px: number) {
  return (px / cssVh()) * 100;
}
