"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { ABOUT_POSE, poseFrame } from "@/app/components/poses";
import { BREAKPOINTS, useBreakpoints } from "@/app/hooks/breakpoints";
import { blockFill } from "@/slices/Hero/scene/Name";

import { tunnelPath, WALL_Z } from "../scene-core/presets";
import { crownTable, wallSheet } from "../scene-core/titleSheet";
import { makeTitleMaterial } from "../scene-core/tunnelShader";

/**
 * The section's title, printed on the wall where it curls.
 *
 * The gap between the About section and the first card is the throat: the flat
 * wall rolling over into the tube, which is the most striking thing the flight
 * does and, until this, had nothing on it. So the title goes there. It rises
 * into frame as the About column leaves, and its echoes run on down the wall
 * after it — over the bend and along the ceiling into the tube — so that by the
 * time the caps have gone off the top of the screen, the wake is what is
 * streaming overhead, thinning out towards the first card.
 *
 * The block is the one the hero name and the About title are built from —
 * solid caps in Monument Extended with stroked echoes under them, cut off at
 * their tops — so the three sections read as one set of headings. Solid here
 * where the About title is a ghost: that one sits behind the head as a
 * backdrop, and this one *is* the picture for the stretch it is on screen.
 *
 * Geometry rather than an overlay because it has to bend; see
 * ../scene-core/titleSheet for how the sheet follows the wall, and the title
 * shader in ../scene-core/tunnelShader for how one line of type becomes the
 * whole block.
 */

/** what the block says — the same word the nav links to this section with */
const TEXT = "WORKS";

const FONT_FAMILY = '"Monument Extended"';
const FONT_WEIGHT = 800;

/** px the glyphs are typeset at before the art is scaled to the texture */
const NOMINAL = 400;

/** texture width in texels; the height is one line of type */
const TEX_W = 2048;

/**
 * The hero name's echoes, unchanged — see `ECHOES` in ../../Hero/scene/Name.
 * `gap` is the baseline offset under the title's own, `reveal` the share of the
 * caps left showing above the echo's baseline; both in cap heights.
 */
const ECHOES = [
  { gap: 0.97, reveal: 0.75 },
  { gap: 1.62, reveal: 0.44 },
  { gap: 2.04, reveal: 0.22 },
];

/**
 * The wake that carries on after them, down the bend and along the ceiling.
 *
 * Laid out in world units along the wall rather than in cap heights, because
 * what it has to do is a fact about the tunnel — reach the far end of the
 * throat — and a phone's caps are a quarter the size of a desktop's. So it ends
 * at {@link WAKE_END} on every screen, at {@link WAKE_PITCH} where that fits in
 * {@link WAKE_MAX} echoes and spaced out further where it doesn't.
 *
 * It carries on the progression the hero's three set up rather than repeating
 * the last of them: each slice a little thinner than the one before, starting
 * below the third's reveal, and dimmer — starting well under the hero's
 * brightness and going all the way out, so it dissolves into the grid rather
 * than stopping. At the third's brightness the whole wake read as a ladder of
 * that one echo, which is a pattern, not a wake.
 */
const WAKE_PITCH = 0.35;
const WAKE_MAX = 20;
/** crown arc length past the curl where the wake's last echo sits, world units */
const WAKE_END = 2700;
/** reveal from, to; brightness from, to */
const WAKE_TAPER: [number, number, number, number] = [0.12, 0.05, 0.55, 0];

/** echo outline width, in cap heights — the hero's */
const ECHO_STROKE = 0.015;

/** how far below an echo's baseline its cut reaches, in cap heights */
const CLIP_SLOP = 0.1;

/** clear border round the line, in cap heights, so mip levels don't bleed */
const PAD = 0.08;

/**
 * Where the caps' top edge sits, as arc length along the crown past the point
 * where the wall starts to curl, in world units.
 *
 * That point is the foot of the screen on the frame the flight takes over —
 * the opening wall is solved to put it there — so anything past it is still
 * below the fold when the tunnel first draws, and the title rises in rather
 * than popping on. A little past it, for the pointer sway's sake.
 */
const TOP = 180;

/** how the two layers are weighted — see the title shader */
const FILL = 0.1;
const STROKE = 0.1;

/** sheet resolution: rows enough to follow the bend, columns for the wrap */
const COLS = 64;
const ROWS = 192;

/** in off the surface, clear of the shell's chords — see `SheetOptions.inset` */
const INSET = 8;

type TitleArt = {
  texture: THREE.DataTexture;
  /** the ink's width, and the cap height, as shares of the texture's width */
  inkShare: number;
  capShare: number;
  /** texture v at the top of the caps, and texture v per cap height */
  line: [number, number];
};

/**
 * Draw one line of the word into a two-channel texture: solid in red, outlined
 * in green. The title shader builds the caps and every echo from it.
 *
 * Drawn on an opaque black canvas and added with `lighter`, so each channel
 * holds its layer's coverage straight — on a transparent canvas the browser
 * stores the edge pixels premultiplied, and reading them back as colour would
 * throw the antialiasing away.
 */
async function drawTitle(text: string, anisotropy: number) {
  const font = `${FONT_WEIGHT} ${NOMINAL}px ${FONT_FAMILY}`;

  if (document.fonts && !document.fonts.check(font, text)) {
    await document.fonts.load(font, text).catch(() => undefined);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.font = font;
  const m = ctx.measureText(text);

  // the ink, not the advance box — the block bleeds to its margins the way the
  // name's does, and the side bearings don't eat into them
  const left = m.actualBoundingBoxLeft;
  const inkW = left + m.actualBoundingBoxRight;
  const cap = m.actualBoundingBoxAscent;
  if (!(inkW > 0 && cap > 0)) return null;

  const pad = cap * PAD;
  const nomW = inkW + 2 * pad;
  const nomH = cap * (1 + ECHO_STROKE + CLIP_SLOP) + 2 * pad;

  const k = TEX_W / nomW;
  const w = TEX_W;
  const h = Math.ceil(nomH * k);

  canvas.width = w;
  canvas.height = h;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  ctx.scale(k, k);
  ctx.font = font;
  ctx.globalCompositeOperation = "lighter";

  const x = pad + left;
  const baseline = pad + cap;

  ctx.fillStyle = "#f00";
  ctx.fillText(text, x, baseline);

  ctx.strokeStyle = "#0f0";
  ctx.lineWidth = cap * ECHO_STROKE;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, baseline);

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const rg = new Uint8Array(w * h * 2);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
    rg[j] = rgba[i];
    rg[j + 1] = rgba[i + 1];
  }

  const texture = new THREE.DataTexture(
    rg,
    w,
    h,
    THREE.RGFormat,
    THREE.UnsignedByteType,
  );
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // the type is read at a steep angle once it is on the ceiling
  texture.anisotropy = anisotropy;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // the canvas's height is rounded up to whole texels, so the shares are
  // quoted against what was actually drawn
  const texH = h / k;

  return {
    texture,
    inkShare: inkW / nomW,
    capShare: cap / nomW,
    line: [pad / texH, cap / texH],
  } satisfies TitleArt;
}

/**
 * The crown's arc length against spine distance, from the top of the flight to
 * well past the throat — everything the sheet can reach. Built once: the path
 * is a module singleton.
 */
let table: ReturnType<typeof crownTable> | null = null;

function titleTable() {
  if (table) return table;

  const path = tunnelPath();
  const curl = path.segs.find((seg) => seg.wrap1 > seg.wrap0);
  const origin = curl ? curl.s0 : path.travelA;

  table = crownTable(
    path,
    path.travelA,
    Math.min(path.total, origin + 120 * path.scale),
    origin,
  );

  return table;
}

/**
 * The block at a given width: the sheet, and the material that prints it.
 * Rebuilt together on a resize — the wake's spacing is a function of the cap
 * height — and cheap enough to be: a few thousand vertices and a handful of
 * uniforms, with the shader program shared.
 */
function buildSheet(art: TitleArt, width: number) {
  const sheetW = width / art.inkShare;
  const capW = sheetW * art.capShare;

  const last = ECHOES[ECHOES.length - 1];

  // the wake's first gap, and how much crown it has to cover from there, in
  // cap heights — measured to the last echo's baseline
  const first = last.gap + WAKE_PITCH;
  const reach = (WAKE_END - TOP) / capW - 1 - first;

  let count = 0;
  let pitch = WAKE_PITCH;

  if (reach >= 0) {
    count = Math.floor(reach / WAKE_PITCH) + 1;
    if (count > WAKE_MAX) {
      count = WAKE_MAX;
      pitch = reach / (WAKE_MAX - 1);
    }
  }

  const tail = count > 0 ? first + (count - 1) * pitch : last.gap;
  const top = -PAD;
  const bottom = 1 + tail + ECHO_STROKE + CLIP_SLOP + PAD;

  const geometry = wallSheet(tunnelPath(), titleTable(), {
    top: TOP + top * capW,
    width: sheetW,
    height: (bottom - top) * capW,
    cols: COLS,
    rows: ROWS,
    inset: INSET,
  });

  const material = makeTitleMaterial({
    map: art.texture,
    line: art.line,
    span: [top, bottom - top],
    fill: FILL,
    stroke: STROKE,
    slop: ECHO_STROKE + CLIP_SLOP,
    echoes: ECHOES.map((e) => [e.gap, e.reveal, 1]),
    wake: [first, pitch, count],
    taper: WAKE_TAPER,
  });

  return { geometry, material };
}

export default function WorksTitle() {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { up } = useBreakpoints(BREAKPOINTS, { clientOnly: true });

  const [art, setArt] = useState<TitleArt | null>(null);
  const anisotropy = gl.capabilities.getMaxAnisotropy();

  useEffect(() => {
    let alive = true;
    let drawn: TitleArt | null = null;

    drawTitle(TEXT, anisotropy).then((next) => {
      if (!next) return;
      drawn = next;

      if (alive) setArt(next);
      else next.texture.dispose();
    });

    return () => {
      alive = false;
      drawn?.texture.dispose();
    };
  }, [anisotropy]);

  /**
   * As wide as the other two sections' blocks: the same share of the viewport,
   * measured where the type sits. The wall is that depth from the pose the
   * About section is held at, and the throat keeps the camera the same
   * distance off the crown as it curls, so the frame at the wall is the frame
   * the title is read in.
   */
  const width = useMemo(() => {
    const frame = poseFrame(
      ABOUT_POSE,
      camera.fov,
      size.width / Math.max(1, size.height),
      WALL_Z,
    );
    return frame.width * blockFill(up.md);
  }, [camera.fov, size.width, size.height, up.md]);

  const sheet = useMemo(
    () => (art ? buildSheet(art, width) : null),
    [art, width],
  );

  useEffect(
    () => () => {
      sheet?.geometry.dispose();
      sheet?.material.dispose();
    },
    [sheet],
  );

  if (!sheet) return null;

  return (
    <mesh
      geometry={sheet.geometry}
      material={sheet.material}
      // after the shell, which it is tested against, and before the grid, so
      // the wall's lines are ruled over the type rather than cut out by it
      renderOrder={0.5}
      frustumCulled={false}
    />
  );
}
