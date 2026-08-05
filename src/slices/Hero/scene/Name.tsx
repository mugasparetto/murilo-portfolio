"use client";

import { RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyTextField } from "@prismicio/client";

import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { toBaseFrame } from "@/app/components/ParallaxRig";
import { defaultParams } from "../scene-core/params";
import type { DoorProjection } from "../scene-core/doorProjection";

/**
 * The name is a DOM overlay, not scene geometry, because every requirement
 * pulls that way:
 *
 * - it sits above the canvas, so Vignette/Noise/Bloom never touch it;
 * - the DOM knows nothing about the camera, so the pointer parallax can't
 *   move it;
 * - "fills the viewport width, pinned near the top" is a layout problem, and
 *   scaling measured type to the width beats a per-breakpoint size table.
 *
 * It therefore comes in two halves, since a DOM tree can't live inside the
 * R3F reconciler:
 *
 * - <NameOverlay />, mounted in the Hero section, owns the markup;
 * - <NameDriver />, mounted in the scene, reads the camera once per frame and
 *   writes to that markup — no React render involved.
 *
 * They meet at the module-scoped `overlay` handle below, the same way
 * <ParallaxRig /> publishes its cancel matrix. There is only ever one hero
 * name, so a singleton is honest here.
 *
 * Everything here is arranged so the type is rasterised **once**:
 *
 * - the SVG carries a viewBox fitted to the measured glyphs, so the browser
 *   scales it to the viewport width on its own — no per-frame size maths, and
 *   nothing inside the SVG ever changes;
 * - the scroll drift is a CSS transform on the band, which the compositor
 *   applies to the finished raster. It's rounded to whole pixels so the text
 *   is never resampled;
 * - the door cut-out is the one thing that can force a repaint, so it's
 *   skipped entirely unless the door is actually over the type, and the band
 *   is only as tall as the block so the damaged area stays small.
 *
 * The two frames the driver works in are deliberately different: the drift is
 * projected through the *base* pose so parallax can't reach the type, while
 * the door is projected through the *live* camera, because it's ordinary
 * scene geometry that parallax really does slide across the screen.
 *
 * The cut-out reproduces the old stencil mask: the name hides behind the door
 * regardless of its real depth, which matters because it actually sits ~7000
 * units *in front* of it.
 */

type Layout = {
  /** cap height at NOMINAL */
  cap: number;
  /** widest line's ink width at NOMINAL — the viewBox width */
  inkW: number;
  /** drop from the caps to the faintest echo's baseline — the viewBox height */
  depth: number;
  /** baseline of each line, caps of the first resting on y = 0 */
  baselines: number[];
  /** text origin that centres each line's ink on x = 0 */
  origins: number[];
  echoes: { reveal: number; baseline: number }[];
};

const overlay: {
  band: HTMLDivElement | null;
  layout: Layout | null;
} = { band: null, layout: null };

/** size the glyphs are measured at; the viewBox scales them from here */
const NOMINAL = 100;

/** gap above the caps, as a share of the viewport height */
const TOP = 0.05;

/** share of the viewport width the widest line fills */
const FILL = 0.95;

/** space between stacked lines, in cap heights */
const LINE_GAP = 0.2;

/**
 * Stroked echoes trailing under the name. `gap` is the baseline offset from
 * the last line and `reveal` the share of the caps still shown, measured up
 * from the echo's own baseline. Both in cap heights, so they hold at any size.
 *
 * Keep `reveal` off exact halves: at 0.5 the cut lands on the crossbars of
 * A/E/R and the echo reads as a row of hairlines.
 */
const ECHOES = [
  { gap: 0.9, reveal: 0.75 },
  { gap: 1.58, reveal: 0.44 },
  { gap: 1.97, reveal: 0.22 },
];

/** echo outline width, in cap heights */
const ECHO_STROKE = 0.028;

/**
 * World point the block is pinned to, on the rest camera's view axis and far
 * enough ahead that scrolling drifts the name up at the pace of the near
 * geometry. Only the *delta* from its resting projection is used, so moving it
 * changes how fast the name leaves, never where it starts.
 */
const ANCHOR = new THREE.Vector3(0, 1050, -1330);

/** how far the cut-out's outer contour reaches past the band, in px */
const BLEED = 200;

/** door quad corners as (right, up) signs — counter-clockwise on screen */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * The projected corners, x/y interleaved, plus the last set actually written.
 * Whole pixels: a sub-pixel mask edge isn't visible, and rounding stops a
 * slow pointer move from rewriting the path — and so repainting the type — on
 * every single frame. Reused buffers, so the frame loop never allocates.
 */
const quad = new Int32Array(8);
const written = new Int32Array(8);

function measure(lines: string[]): Layout | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;

  ctx.font = `800 ${NOMINAL}px "Monument Extended"`;

  const measured = lines.map((line) => {
    const m = ctx.measureText(line);
    // canvas reports ink bounds around the origin: `left` grows leftwards,
    // `right` rightwards, so the ink spans [-left, +right]
    const left = m.actualBoundingBoxLeft ?? 0;
    const right = m.actualBoundingBoxRight ?? m.width;
    const ascent = m.actualBoundingBoxAscent ?? NOMINAL * 0.72;

    return { inkW: left + right, x0: -(right - left) / 2, ascent };
  });

  if (!measured.every((m) => m.inkW > 0 && m.ascent > 0)) return null;

  const cap = Math.max(...measured.map((m) => m.ascent));
  const step = cap * (1 + LINE_GAP);
  const baselines = measured.map((_, i) => cap + i * step);
  const last = baselines[baselines.length - 1];
  const echoes = ECHOES.map((e) => ({
    reveal: e.reveal,
    baseline: last + e.gap * cap,
  }));

  return {
    cap,
    inkW: Math.max(...measured.map((m) => m.inkW)),
    depth: echoes[echoes.length - 1].baseline,
    baselines,
    origins: measured.map((m) => m.x0),
    echoes,
  };
}

/**
 * Lives in the Hero section, above the canvas. Nothing inside the SVG changes
 * after the glyphs are measured — <NameDriver /> only ever touches the band's
 * transform and clip.
 */
export default function NameOverlay({
  firstName = "",
  lastName = "",
}: {
  firstName: KeyTextField;
  lastName: KeyTextField;
}) {
  const { up } = useBreakpoints(BREAKPOINTS);

  // React's generated ids carry delimiters that aren't valid in `url(#…)`
  const clip = `name-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [layout, setLayout] = useState<Layout | null>(null);

  // one line on desktop, stacked first/last once the viewport gets too narrow
  // for the full name to stay legible at full width
  const lines = useMemo(() => {
    const both = [firstName ?? "", lastName ?? ""]
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return up.md ? [both.join(" ")].filter(Boolean) : both;
  }, [firstName, lastName, up.md]);

  const lineKey = lines.join(" ");

  useEffect(() => {
    if (!lineKey) return;

    let alive = true;
    const apply = () => {
      if (!alive) return;
      const next = measure(lines);
      overlay.layout = next;
      setLayout(next);
    };
    const face = `800 ${NOMINAL}px "Monument Extended"`;

    // measuring against the fallback font would size the block wrong, so wait
    // for the real face when it isn't ready yet
    if (!document.fonts || document.fonts.check(face, lineKey)) apply();
    else document.fonts.load(face, lineKey).then(apply, apply);

    return () => {
      alive = false;
      overlay.layout = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  if (!lines.length) return null;

  return (
    <div
      ref={(el) => {
        overlay.band = el;
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        zIndex: 1,
        pointerEvents: "none",
        contain: "layout style",
        // the band is moved every frame and never re-laid-out, so keep it on
        // its own compositor layer
        willChange: "transform",
        // the driver reveals it once it has placed it, so it can't flash at
        // the top of the viewport first
        visibility: "hidden",
      }}
    >
      <h1
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {lines.join(" ")}
      </h1>

      {/* the viewBox is the measured block, so the browser does the scaling:
          full-bleed type at any viewport, and the band's height follows the
          intrinsic ratio without a single measurement */}
      {layout && (
        <svg
          aria-hidden
          viewBox={`${-layout.inkW / 2} 0 ${layout.inkW} ${layout.depth}`}
          style={{
            display: "block",
            width: `${FILL * 100}%`,
            height: "auto",
            margin: "0 auto",
            overflow: "visible",
          }}
        >
          <defs>
            {layout.echoes.map((echo, i) => (
              <clipPath
                key={i}
                id={`${clip}-echo-${i}`}
                clipPathUnits="userSpaceOnUse"
              >
                {/* keeps only the bottom `reveal` slice of the echo's caps */}
                <rect
                  x={-layout.inkW}
                  width={layout.inkW * 2}
                  y={echo.baseline - layout.cap * echo.reveal}
                  height={layout.cap * (echo.reveal + ECHO_STROKE + 0.1)}
                />
              </clipPath>
            ))}
          </defs>

          <g
            fontFamily='"Monument Extended", sans-serif'
            fontWeight={800}
            fontSize={NOMINAL}
          >
            {layout.baselines.map((baseline, i) => (
              <text key={i} x={layout.origins[i]} y={baseline} fill="#fff">
                {lines[i]}
              </text>
            ))}

            {layout.echoes.map((echo, i) => (
              <g key={i} clipPath={`url(#${clip}-echo-${i})`}>
                <text
                  x={layout.origins[layout.origins.length - 1]}
                  y={echo.baseline}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={layout.cap * ECHO_STROKE}
                >
                  {lines[lines.length - 1]}
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * Lives in the scene. Renders nothing — it just drives <NameOverlay /> from
 * the camera, once per frame, skipping writes that wouldn't change anything so
 * an idle desktop settles to zero DOM work.
 */
export function NameDriver({
  doorProjectionRef,
}: {
  doorProjectionRef: RefObject<DoorProjection>;
}) {
  const { camera, size } = useThree();

  /**
   * NDC y of ANCHOR at the resting pose. The camera's fov is vertical, so this
   * is aspect-independent and only has to be computed once.
   */
  const restY = useMemo(() => {
    const p = defaultParams;
    const cam = new THREE.PerspectiveCamera(p.fov, 1, 50, 100000);
    cam.position.set(p.cameraX, p.cameraY, p.cameraZ);
    cam.lookAt(p.targetX, p.targetY, p.targetZ);
    cam.updateMatrixWorld();
    return ANCHOR.clone().project(cam).y;
  }, []);

  const scratch = useMemo(() => new THREE.Vector3(), []);
  const lastY = useRef(NaN);
  const lastBandH = useRef(NaN);
  const lastCut = useRef<boolean | null>(null);
  const lastHidden = useRef<boolean | null>(null);

  useFrame(() => {
    const { band, layout } = overlay;
    if (!band || !layout) return;

    // --- vertical drift: how far ANCHOR has travelled since the rest pose.
    // Projected in the base frame so the pointer parallax is stripped out.
    scratch.copy(ANCHOR);
    toBaseFrame(scratch);
    scratch.project(camera);

    // whole pixels: a fractional translate would resample the type every
    // frame, which reads as shimmer on the stroked echoes
    const y = Math.round(
      size.height * TOP + (restY - scratch.y) * 0.5 * size.height,
    );
    // the svg's intrinsic ratio, so this matches its laid-out height exactly
    const bandH = Math.round((size.width * FILL * layout.depth) / layout.inkW);

    const hidden = y + bandH < 0;
    if (hidden !== lastHidden.current) {
      band.style.visibility = hidden ? "hidden" : "visible";
      lastHidden.current = hidden;
    }
    if (hidden) return;

    // compositor-only — the raster is reused, never redrawn. Compared as a
    // number so an unchanged frame doesn't even build the string.
    if (y !== lastY.current) {
      band.style.transform = `translate3d(0,${y}px,0)`;
      lastY.current = y;
    }

    // --- door cut-out, in the band's own box.
    //
    // The only thing here that can dirty the type, so it stays "none" unless
    // the door is genuinely over it — which at rest it isn't, the door's top
    // edge sitting well below the block.
    const door = doorProjectionRef.current;
    let cut = false;

    if (door && door.strength > 0.001) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < 4; i++) {
        const [u, v] = CORNERS[i];

        scratch
          .copy(door.position)
          .addScaledVector(door.right, u * door.halfSize.x)
          .addScaledVector(door.up, v * door.halfSize.y)
          .project(camera);

        const px = Math.round((scratch.x * 0.5 + 0.5) * size.width);
        const py = Math.round((1 - (scratch.y * 0.5 + 0.5)) * size.height) - y;

        quad[i * 2] = px;
        quad[i * 2 + 1] = py;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      cut = maxX > 0 && minX < size.width && maxY > 0 && minY < bandH;
    }

    // integer compare before anything else: writing `clip-path` repaints the
    // type, so it has to be earned
    let moved = cut !== lastCut.current || bandH !== lastBandH.current;

    if (cut && !moved) {
      for (let i = 0; i < 8; i++) {
        if (quad[i] !== written[i]) {
          moved = true;
          break;
        }
      }
    }

    if (!moved) return;

    if (!cut) {
      band.style.clipPath = "none";
    } else {
      // outer contour clockwise, the quad counter-clockwise against it, so
      // it punches through under either fill rule — which spares `path()`
      // an `evenodd` argument, the part with the thinnest support
      let d = `M${-BLEED} ${-BLEED}H${size.width + BLEED}V${
        bandH + BLEED
      }H${-BLEED}Z`;

      for (let i = 0; i < 4; i++) {
        d += `${i ? "L" : "M"}${quad[i * 2]} ${quad[i * 2 + 1]}`;
      }

      band.style.clipPath = `path("${d}Z")`;
      written.set(quad);
    }

    lastCut.current = cut;
    lastBandH.current = bandH;
  });

  return null;
}
