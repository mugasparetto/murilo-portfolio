"use client";

import { useEffect, useMemo, useRef } from "react";

import {
  SolidKind,
  SOLID_KINDS,
  solidWireframe,
} from "@/app/components/solids";

/**
 * One of the sky's solids, turning, as an SVG — the tile icon on every row of
 * the About section's skills list.
 *
 * It's a drawing rather than a fifth thing on the canvas: this list is DOM on
 * <AboutOverlay />'s layer, and a <Canvas /> per row would mean a WebGL
 * context per row for a shape twenty triangles wide. What it draws is the real
 * solid all the same — the vertices come from the same geometries <Sky />
 * builds, so the icon is the sky's cube rather than a cube.
 *
 * Drawn rather than exported for the reason the icosahedron it replaces was:
 * the design places a 72 × 64 crop of a reference bitmap on each row, which is
 * already soft at that size. Real edges stay crisp at any size and take their
 * colour from the row.
 *
 * ── How the hidden edges go ───────────────────────────────────────────────
 *
 * In the sky the solids are black-filled, so the far side of one is simply
 * painted over. A fill would be wrong here — the rows are translucent black
 * over the face behind them — so the far edges are dropped instead of covered:
 * every one of these solids is convex, which makes an edge visible exactly
 * when one of the two faces meeting along it turns towards the eye. Same
 * picture, nothing opaque needed.
 */

/* --------------------------------------------------------------------------
   Projection

   A 24-unit box, the one the section's other icons are drawn in, with the
   solid at circumradius 1 in the middle of it. The eye sits four radii back:
   far enough that the shape reads as the sky's near-orthographic one, near
   enough that the leading corner opens out a little as it swings past.

   The focal length is set from the unit sphere's silhouette, which no vertex
   can project outside of — so nothing escapes the box, whatever the pose.
   -------------------------------------------------------------------------- */

const BOX = 24;
const CENTRE = BOX / 2;
const EYE = 4;
/** half the box, less a stroke's worth of margin */
const FIT = CENTRE - 1;
const FOCAL = FIT * Math.sqrt(EYE * EYE - 1);

/* --------------------------------------------------------------------------
   Motion

   The sky's solids turn at 0.03–0.10 rad/s, which is right for something a few
   hundred units across and ten thousand away: what reads is the rate on
   screen, and theirs is a crawl. An icon is twenty pixels wide, so the same
   crawl would be a still image. These run a few times faster — half a minute
   or so a turn — which is as quick as this can go before it stops reading as a
   solid drifting and starts reading as a spinner.

   The per-row jitter is the trick <Sky /> and <InstancedStars /> use: hand-
   tuning a rate for every row is noise, but rows turning in lockstep read as
   one animation repeated down the list.
   -------------------------------------------------------------------------- */

const fract = (x: number) => x - Math.floor(x);
const rnd = (i: number, salt: number) =>
  fract(Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123);

/** The solid on row `i` — down the list, in the order {@link SOLID_KINDS} sets. */
export const solidForRow = (i: number) => SOLID_KINDS[i % SOLID_KINDS.length];

/* --------------------------------------------------------------------------
   The shared ticker

   One rAF for every icon on the page rather than one each, and capped, for the
   reason <FrameCap /> caps the scene: on a fast panel the frame budget is 6ms,
   the About section already fills most of it, and this is DOM work landing in
   the same frames. Thirty is plenty for something taking half a minute to
   turn, and costs a few hundred multiplications a frame.
   -------------------------------------------------------------------------- */

const FPS = 30;

const subscribers = new Set<(t: number) => void>();
let raf = 0;
let started = -1;
let last = -Infinity;

function frame(now: number) {
  raf = requestAnimationFrame(frame);

  if (started < 0) started = now;
  const t = (now - started) / 1000;

  if (t - last < 1 / FPS) return;
  last = t;

  subscribers.forEach((draw) => draw(t));
}

function run() {
  if (raf || !subscribers.size || document.hidden) return;
  // the clock restarts with the loop, so a tab left in the background comes
  // back where it was rather than snapping forward by however long it was away
  started = -1;
  last = -Infinity;
  raf = requestAnimationFrame(frame);
}

function halt() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function subscribe(draw: (t: number) => void) {
  subscribers.add(draw);
  run();

  return () => {
    subscribers.delete(draw);
    if (!subscribers.size) halt();
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () =>
    document.hidden ? halt() : run(),
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The visible edges of `kind` at pitch `ax` / yaw `ay`, as a path.
 *
 * Written to be called thirty times a second: the wireframe is shared and
 * read-only, the scratch buffers are the caller's, and the only allocation is
 * the string that comes back — which is what the DOM is going to be handed
 * either way.
 */
function drawSolid(
  kind: SolidKind,
  ax: number,
  ay: number,
  scratch: { xyz: Float32Array; xy: Float32Array; front: Uint8Array },
) {
  const { vertices, normals, anchors, edges } = solidWireframe(kind);
  const { xyz, xy, front } = scratch;

  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);

  // yaw, then pitch. The rotated z is kept as well as the projected point:
  // the visibility test below needs the face where it actually is in space.
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];

    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;

    const y2 = cx * y - sx * z1;
    const z2 = sx * y + cx * z1;

    xyz[i] = x1;
    xyz[i + 1] = y2;
    xyz[i + 2] = z2;

    // perspective divide, and SVG's y runs the opposite way to the solid's
    const k = FOCAL / (EYE - z2);
    xy[(i / 3) * 2] = CENTRE + x1 * k;
    xy[(i / 3) * 2 + 1] = CENTRE - y2 * k;
  }

  // A face turns towards the eye when its outward normal leans back along the
  // line of sight — measured to the eye rather than down -z, since there's
  // perspective in the projection.
  for (let f = 0; f < normals.length / 3; f++) {
    const nx0 = normals[f * 3];
    const ny0 = normals[f * 3 + 1];
    const nz0 = normals[f * 3 + 2];

    const nx = cy * nx0 + sy * nz0;
    const nz1 = -sy * nx0 + cy * nz0;
    const ny = cx * ny0 - sx * nz1;
    const nz = sx * ny0 + cx * nz1;

    const a = anchors[f] * 3;
    const dot = nx * xyz[a] + ny * xyz[a + 1] + nz * (xyz[a + 2] - EYE);

    front[f] = dot < 0 ? 1 : 0;
  }

  let d = "";

  for (let e = 0; e < edges.length; e += 4) {
    // convex, so one face of the pair facing the eye is the whole test
    if (!front[edges[e + 2]] && !front[edges[e + 3]]) continue;

    const p = edges[e] * 2;
    const q = edges[e + 1] * 2;

    // two decimals is a hundredth of a viewBox unit — a twentieth of a device
    // pixel at the size these render, and half the string length
    d += `M${xy[p].toFixed(2)} ${xy[p + 1].toFixed(2)}L${xy[q].toFixed(2)} ${xy[
      q + 1
    ].toFixed(2)}`;
  }

  return d;
}

type Props = {
  kind: SolidKind;
  /** row index — sets the pose it starts from and the rate it turns at */
  seed?: number;
  className?: string;
};

export default function SolidIcon({ kind, seed = 0, className }: Props) {
  const path = useRef<SVGPathElement>(null);

  const motion = useMemo(
    () => ({
      // a yaw with a slower pitch under it, so the solid turns rather than
      // tumbles and the same face doesn't keep coming back
      spinY: (0.16 + rnd(seed, 1) * 0.1) * (rnd(seed, 2) < 0.5 ? -1 : 1),
      spinX: (0.05 + rnd(seed, 3) * 0.05) * (rnd(seed, 4) < 0.5 ? -1 : 1),
      phaseY: rnd(seed, 5) * Math.PI * 2,
      phaseX: rnd(seed, 6) * Math.PI * 2,
    }),
    [seed],
  );

  const scratch = useMemo(() => {
    const { vertices, normals } = solidWireframe(kind);

    return {
      xyz: new Float32Array(vertices.length),
      xy: new Float32Array((vertices.length / 3) * 2),
      front: new Uint8Array(normals.length / 3),
    };
  }, [kind]);

  // The pose at t = 0, rendered on the server and hydrated as it is — a path
  // built in an effect would land a frame late and flash an empty tile.
  const initial = useMemo(
    () => drawSolid(kind, motion.phaseX, motion.phaseY, scratch),
    [kind, motion, scratch],
  );

  useEffect(() => {
    // whoever asked not to see things move keeps the pose above, and no ticker
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    return subscribe((t) => {
      const node = path.current;
      if (!node) return;

      node.setAttribute(
        "d",
        drawSolid(
          kind,
          motion.phaseX + t * motion.spinX,
          motion.phaseY + t * motion.spinY,
          scratch,
        ),
      );
    });
  }, [kind, motion, scratch]);

  return (
    <svg
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path ref={path} d={initial} />
    </svg>
  );
}
