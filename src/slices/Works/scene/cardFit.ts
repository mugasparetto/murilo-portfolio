import * as THREE from "three";

import { blockFill } from "@/slices/Hero/scene/Name";

import type { CardPatch } from "../scene-core/geometry";
import {
  frameAt,
  makeFrame,
  smoothstep,
  type CompiledPath,
} from "../scene-core/path";
import { hudLayout } from "./hud";

/**
 * How big each card is, and how far it comes off the wall, for one viewport.
 *
 * Everything here is worked out at the one moment the flight is built around:
 * where the camera *reaches* the card (see `REACHED` in ./hud), which is where
 * clicking its tick lands the page and where it is meant to be read. Two
 * things are decided there.
 *
 * ── The size it lands at is the size it is laid out at ───────────────────
 *
 * The card is markup scaled onto its plane, and it sits on its own compositor
 * layer (`will-change: transform`), which Chrome rasterises at its layout size
 * and then scales as a bitmap. A card laid out small and blown up to its
 * landing size is soft exactly when it is being read. So the card is laid out
 * at its landing size in px, and its plane is given whatever world size
 * projects to that at the landing depth. It lands at a scale of 1, and before
 * that it is only ever scaled *down*.
 *
 * The landing size is a share of the screen — half its height, at a ratio
 * that goes square on a portrait screen — held inside the page's own margins:
 * the block inset the nav and the HUD sit on, and clear of their row at the
 * foot of the screen.
 *
 * ── Off the wall until it fits ───────────────────────────────────────────
 *
 * A card comes off its patch towards the axis. On a wide screen that leaves
 * it on its own side of the tunnel, beside the vanishing point. On a narrow
 * one the same card is half off the screen, because the tunnel is barely
 * wider than the frame there. So each card comes off the wall just as far as
 * it needs to for its landing box to be inside the margins: the least `push`
 * that fits, so a wide screen keeps the card where it was and a phone brings it
 * in towards the middle. If no push fits, the card is drawn a little smaller
 * than its layout, which is still a downscale.
 *
 * ── And past the landing ─────────────────────────────────────────────────
 *
 * The card stays all the way out for some way after it is reached (about 20
 * units down to 12), and a plain plane would keep growing all that way, to
 * nearly twice its landing size: half off the screen, and soft, being a
 * bitmap blown up. So past its landing depth <TunnelCards /> shrinks the plane
 * with the distance left, and the card only grows by {@link GROWTH_AFTER}'s
 * share of what it would have. It holds while it is being read, then goes back
 * into the wall.
 */

export type CardFit = {
  /** the card's layout size in CSS px — and so the size it lands at */
  w: number;
  h: number;
  /** per card: half its width and height at landing, in world units */
  hw: number[];
  hh: number[];
  /** per card: how far it comes off the wall, as a share of the tube radius */
  push: number[];
  /** per card: how far ahead of the camera it is at landing, in world units */
  depth: number[];
};

/**
 * How much of its growth a card keeps once it is past its landing: its size
 * on screen goes as `(landing depth / depth) ^ GROWTH_AFTER`. 1 is a plain
 * plane, 0 holds it at its landing size exactly. At a quarter it is about 15%
 * bigger by the time it starts back into the wall, so it still reads as being
 * flown past.
 */
export const GROWTH_AFTER = 0.25;

/** the card's height at landing, as a share of the screen's */
const HEIGHT_SHARE = 0.5;

/** width over height, on a landscape and a portrait screen */
const RATIO_WIDE = 1.36;
const RATIO_TALL = 1;

/** past this the card is big enough; the type stops growing well before */
const MAX_W = 840;

/** Tailwind's `md`, where the nav turns from a corner button into the pill */
const MD = 768;

/**
 * The push the tunnel was tuned with, and the most a card may take. Past 1 is
 * past the axis. That is allowed because the camera is two tube radii back
 * along a spine that may still be bending, so the middle of the screen can be
 * a little beyond the axis at the card.
 */
const PUSH_MIN = 0.55;
const PUSH_MAX = 1.3;
const PUSH_STEP = 0.005;

/** the least a card may be drawn at, as a share of its layout size */
const SHRINK_MIN = 0.6;

/**
 * Room to spare: the fit is checked for a card this much bigger than it is.
 * Clicking a tick lands a couple of px past the moment, and the drawn card
 * snaps to a ring up to a unit nearer, so the card arrives a few % bigger and
 * would otherwise touch the margin.
 */
const SLACK = 1.04;

/** the camera at aim 0 faces the wall — see <Scene />, which this mirrors */
const ROT_X90 = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);

/**
 * Where the card may not go, in px from each edge. The sides and the top are
 * the block inset everything else on the page lines up with. The foot also
 * clears the row the nav and the HUD share: 24px up and 50 tall from `md`,
 * at the inset and 40 tall below it.
 */
function margins(width: number) {
  const md = width >= MD;
  const inset = Math.max(16, ((1 - blockFill(md)) / 2) * width);
  const row = md ? 24 + 50 : inset + 40;

  return { side: inset, top: inset, bottom: row + inset };
}

const scratch = {
  fr: makeFrame(),
  q: new THREE.Quaternion(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  fwd: new THREE.Vector3(),
  v: new THREE.Vector3(),
};

/**
 * One viewport at a time — it only changes on a resize. Compared field by
 * field, since this is asked on every frame.
 */
let cache: {
  path: CompiledPath;
  width: number;
  height: number;
  fov: number;
  fit: CardFit;
} | null = null;

export function cardFit(
  path: CompiledPath,
  patches: CardPatch[],
  count: number,
  width: number,
  height: number,
  fov: number,
): CardFit {
  if (
    cache &&
    cache.path === path &&
    cache.width === width &&
    cache.height === height &&
    cache.fov === fov
  ) {
    return cache.fit;
  }

  const m = margins(width);
  const ratio = width >= height ? RATIO_WIDE : RATIO_TALL;

  const w = Math.max(
    1,
    Math.round(
      Math.min(
        MAX_W,
        (width - 2 * m.side) / SLACK,
        HEIGHT_SHARE * height * ratio,
        ((height - m.top - m.bottom) * ratio) / SLACK,
      ),
    ),
  );
  const h = Math.round(w / ratio);

  const { reachS } = hudLayout(count);
  const { fr, q, right, up, fwd, v } = scratch;
  const tan = Math.tan((fov * Math.PI) / 360);

  const fit: CardFit = { w, h, hw: [], hh: [], push: [], depth: [] };

  patches.forEach((patch, i) => {
    // the camera as <Scene /> leaves it at the card's landing, less the sway
    frameAt(path, reachS[i] ?? patch.s, fr);
    q.copy(fr.quat).multiply(ROT_X90).slerp(fr.quat, smoothstep(fr.aim));
    right.set(1, 0, 0).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    fwd.set(0, 0, -1).applyQuaternion(q);

    /** the anchor at a push, on screen: centre in px, and px per world unit */
    const place = (p: number) => {
      v.copy(patch.centre)
        .addScaledVector(patch.inward, p * patch.tube)
        .sub(fr.pos);

      const z = v.dot(fwd);
      if (z <= 0) return null;

      const ppu = height / (2 * z * tan);

      return {
        cx: width / 2 + v.dot(right) * ppu,
        cy: height / 2 - v.dot(up) * ppu,
        ppu,
        z,
      };
    };

    // The least push at which the card fits at full size; failing that, the
    // push that lets it be biggest. `k` is the most the card can be drawn at
    // there, as a share of its layout, with the slack on top.
    let best = { p: PUSH_MAX, k: -Infinity, ppu: 0, z: 0 };

    for (let p = PUSH_MIN; p <= PUSH_MAX + 1e-9; p += PUSH_STEP) {
      const at = place(p);
      if (!at) continue;

      const k = Math.min(
        1,
        (2 * Math.min(at.cx - m.side, width - m.side - at.cx)) / (w * SLACK),
        (2 * (at.cy - m.top)) / (h * SLACK),
        (2 * (height - m.bottom - at.cy)) / (h * SLACK),
      );

      if (k > best.k + 1e-6) best = { p, k, ppu: at.ppu, z: at.z };
      if (k >= 1) break;
    }

    // floored for a screen far shorter than any phone; and if the card was
    // never in front of the camera, sized for the two radii it usually is
    const k = Math.max(SHRINK_MIN, Math.min(1, best.k));
    const z = best.z || 2 * patch.tube;
    const ppu = height / (2 * z * tan);

    fit.hw[i] = (k * w) / 2 / ppu;
    fit.hh[i] = (k * h) / 2 / ppu;
    fit.push[i] = best.p;
    fit.depth[i] = z;
  });

  cache = { path, width, height, fov, fit };
  return fit;
}
