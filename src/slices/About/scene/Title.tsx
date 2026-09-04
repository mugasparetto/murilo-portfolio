"use client";

import { useCallback, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";

import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { ABOUT_POSE, poseFrame } from "@/app/components/poses";
import { blockFill } from "@/slices/Hero/scene/Name";

/**
 * The section title: solid caps with stroked echoes trailing under them — the
 * same block <NameOverlay /> draws over the hero, in the same margins.
 *
 * The name is a DOM overlay because everything about it pulls that way: it has
 * to clear the post-processing, and the pointer parallax must not reach it.
 * Neither holds here, and one thing pulls the other way hard — this block sits
 * *behind* the head, so the pieces have to occlude it as they're dragged past.
 * An overlay could only fake that with a cut-out, which is exactly the
 * machinery the name needs for the door and exactly the machinery worth not
 * having twice. So this one is ordinary geometry, placed once in world space,
 * and the parallax sways it along with the backdrop it belongs to.
 *
 * That leaves one problem: the side margins are a *screen* measurement —
 * {@link blockFill} of the viewport width across — and a mesh has no viewport.
 * The bridge is {@link ABOUT_POSE}: the scroll rig comes to rest there and
 * holds it for the whole section, so projecting that frustum at the block's
 * depth turns the viewport edges into plain world coordinates. Done once per
 * resize, not per frame.
 *
 * Vertically it hangs off the centre of that frustum rather than off its top
 * edge, and by its own cap height rather than by a share of the viewport. The
 * head sits at the centre, and this block is the head's backdrop: what has to
 * hold is the gap between the two, which is a gap between two pieces of the
 * picture and not a margin. Measuring it from the top edge instead let it come
 * loose — the type is sized off the viewport's *width*, so on a narrow screen
 * the block shrank while the top edge stayed put and the title drifted off up
 * there on its own.
 *
 * The type is measured rather than sized by hand for the reason the name is:
 * scaling the block to the viewport beats a per-breakpoint size table. Troika
 * does the measuring here — see `onSync` — since it's the one that knows what
 * it drew.
 */

/**
 * Where the block sits: clear of the wall and the grid ruled on it at z = 2200
 * — see WALL_Z in ../../Works/scene-core/presets, which is what these ten units
 * of clearance are really against — and well behind the face at z = 2600 so
 * every piece passes in front of it.
 */
const Z = 2210;

/** em size the glyphs are typeset at; the group scales them from here */
const NOMINAL = 100;

/**
 * Stroked echoes trailing under the title, as in <NameOverlay />: `gap` is the
 * baseline offset from the title's own baseline and `reveal` the share of the
 * caps still shown, measured up from the echo's baseline. Both in cap heights,
 * so they hold at any size.
 *
 * Kept off exact halves — at 0.5 the cut lands on the crossbars of A/B/E and
 * the echo reads as a row of hairlines.
 */
const ECHOES = [
  { gap: 0.9, reveal: 0.74 },
  { gap: 1.52, reveal: 0.46 },
  { gap: 1.94, reveal: 0.21 },
];

/** echo outline width, in cap heights */
const ECHO_STROKE = 0.015;

/** how far past the baseline the reveal clip reaches, in cap heights */
const CLIP_SLOP = 0.1;

/**
 * How far the title's baseline sits above the centre of the frustum, in cap
 * heights — so the whole block, echoes included, rides with its own size.
 */
const BLOCK_RISE = 0.65;

const FONT = "/fonts/PPMonumentExtended-Black.ttf";

/**
 * The typeset block at {@link NOMINAL}, in troika's local space: `cap` the ink
 * height above the baseline, `centreX` where the ink actually centres. Both are
 * read off the *ink* rather than the advance box, so the block bleeds to its
 * margins the way the name's does and the side bearings don't eat into them.
 */
type Metrics = { inkW: number; cap: number; centreX: number };

/** The slice of troika's sync payload this reads; drei types it as `any`. */
type TextRenderInfo = {
  /** ink bounds of the typeset block, `[minX, minY, maxX, maxY]` */
  visibleBounds: ArrayLike<number>;
};

export default function Title({ text = "ABOUT" }: { text?: string }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });

  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const onSync = useCallback((troika: { textRenderInfo?: TextRenderInfo }) => {
    const bounds = troika.textRenderInfo?.visibleBounds;
    if (!bounds) return;

    // anchored to the baseline, so maxY is the ink height above it
    const next = {
      inkW: bounds[2] - bounds[0],
      cap: bounds[3],
      centreX: (bounds[0] + bounds[2]) / 2,
    };
    if (!(next.inkW > 0 && next.cap > 0)) return;

    // troika only re-typesets when something it typesets from changed, so this
    // fires once — but it writes state that feeds back into the render, so bail
    // on an unchanged measurement rather than rely on that
    setMetrics((prev) =>
      prev &&
      prev.inkW === next.inkW &&
      prev.cap === next.cap &&
      prev.centreX === next.centreX
        ? prev
        : next,
    );
  }, []);

  /**
   * The rest pose's frustum where the block sits: how much world the viewport
   * spans at that depth, and the world point it is centred on.
   */
  const frame = useMemo(
    () => poseFrame(ABOUT_POSE, camera.fov, size.width / size.height, Z),
    [camera.fov, size.width, size.height],
  );

  // world units per NOMINAL unit: whatever makes the ink span its share of the
  // frustum. Uniform, so every offset below can stay in cap heights.
  const scale = metrics ? (frame.width * blockFill(up.md)) / metrics.inkW : 1;
  const cap = metrics?.cap ?? 0;

  return (
    // the group's origin is the title's baseline, with the caps standing on top
    // of it and the echoes hanging below — so the rise is what clears the head
    <group
      visible={metrics !== null}
      position={[
        frame.center[0] - (metrics?.centreX ?? 0) * scale,
        frame.center[1] + BLOCK_RISE * cap * scale,
        Z,
      ]}
      scale={scale}
    >
      <Text
        font={FONT}
        fontSize={NOMINAL}
        anchorX="center"
        anchorY="top-baseline"
        color="#fff"
        fillOpacity={0.05}
        onSync={onSync}
      >
        {text}
      </Text>

      {/* Each echo is clipped in its own local space, where its baseline is
          y = 0: keep everything up to `reveal` cap heights above it and the
          tops of the letters are cut off, leaving the slice that reads as the
          block fading into the grid. The stroke is drawn inside the glyph edge,
          so the clip reaches a little below the baseline to take the part of it
          that hangs under there with it. */}
      {ECHOES.map((echo, i) => (
        <Text
          key={i}
          font={FONT}
          fontSize={NOMINAL}
          anchorX="center"
          anchorY="top-baseline"
          position={[0, -echo.gap * cap, 0]}
          fillOpacity={0}
          strokeOpacity={0.05}
          strokeColor="#fff"
          strokeWidth={cap * ECHO_STROKE}
          clipRect={
            metrics
              ? [
                  -metrics.inkW,
                  -cap * (ECHO_STROKE + CLIP_SLOP),
                  metrics.inkW,
                  cap * echo.reveal,
                ]
              : undefined
          }
        >
          {text}
        </Text>
      ))}
    </group>
  );
}
