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
 * The section's title, written down the wall where it curls.
 *
 * The gap between the About section and the first card is the throat: the flat
 * wall rolling over into the tube, which is the most striking thing the flight
 * does and, until this, had nothing on it. So the title goes there, and it
 * runs the way the flight does — the letters stacked one under another down
 * the wall's centre line, so they come up the screen one at a time as the
 * About column leaves, roll over the bend with the surface, and carry on along
 * the ceiling into the tube. The word is read in the order it is flown past.
 *
 * Monument Extended, like the hero name and the About title, and a ghost at
 * the About title's level: it is the backdrop the dive happens against, not a
 * heading that stops it.
 *
 * Geometry rather than an overlay because it has to bend; see
 * ../scene-core/titleSheet for how the sheet follows the wall.
 */

/** what the column says — the same word the nav links to this section with */
const TEXT = "WORKS";

const FONT_FAMILY = '"Monument Extended"';
const FONT_WEIGHT = 800;

/** px the glyphs are typeset at before the art is scaled to the texture */
const NOMINAL = 400;

/**
 * The most texels the column may take each way. The column is about four
 * times as tall as it is wide, so it is the height that binds — 4096 is the
 * size every device's WebGL can be counted on for.
 */
const TEX_MAX_W = 1024;
const TEX_MAX_H = 4096;

/** space between one letter's foot and the next one's top, in cap heights */
const LEADING = 0.25;

/** clear border round the column, in cap heights, so mip levels don't bleed */
const PAD = 0.08;

/**
 * Where the first letter's top sits, as arc length along the crown past the
 * point where the wall starts to curl, in world units.
 *
 * That point is the foot of the screen on the frame the flight takes over —
 * the opening wall is solved to put it there — so anything past it is still
 * below the fold when the tunnel first draws, and the column rises in rather
 * than popping on.
 */
const TOP = 108;

/**
 * Where the last letter's foot sits, on the same measure: near the far end of
 * the throat, so the column runs over the whole bend and out along the
 * ceiling. The letters are sized to fill the stretch between the two — see
 * {@link buildSheet} for the one case where they can't.
 */
const END = 1700;

/** how bright the type is, as alpha over black */
const FILL = 0.1;

/** sheet resolution: rows enough to follow the bend, columns for the wrap */
const COLS = 32;
const ROWS = 192;

/** in off the surface, clear of the shell's chords — see `SheetOptions.inset` */
const INSET = 8;

/** The drawn column, with its proportions in cap heights. */
type TitleArt = {
  texture: THREE.DataTexture;
  material: THREE.ShaderMaterial;
  /** the whole texture, padding included */
  width: number;
  height: number;
  /** the padding above the first letter */
  padTop: number;
  /** the inked column, first cap's top to last letter's foot */
  column: number;
  /** the widest letter's ink */
  widest: number;
};

/**
 * Draw the letters stacked, each centred on the column's axis, into a
 * one-channel texture of coverage.
 *
 * Drawn white on an opaque black canvas and read back from the red channel, so
 * the coverage comes out straight — on a transparent canvas the browser stores
 * the edge pixels premultiplied, and reading them back as colour would throw
 * the antialiasing away.
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

  // every row is the same height, measured off the whole word: the tallest cap
  // above the baseline and the deepest overshoot below it, which is the round
  // letters' — so O and S sit on the same grid as W and K
  const all = ctx.measureText(text);
  const cap = all.actualBoundingBoxAscent;
  const foot = all.actualBoundingBoxDescent;
  if (!(cap > 0)) return null;

  const letters = [...text];
  const metrics = letters.map((l) => ctx.measureText(l));
  const widest = Math.max(
    ...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
  );

  const pad = cap * PAD;
  const row = cap + foot;
  const gap = cap * LEADING;
  const column = letters.length * row + (letters.length - 1) * gap;

  const nomW = widest + 2 * pad;
  const nomH = column + 2 * pad;

  const k = Math.min(TEX_MAX_W / nomW, TEX_MAX_H / nomH);
  const w = Math.ceil(nomW * k);
  const h = Math.ceil(nomH * k);

  canvas.width = w;
  canvas.height = h;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  ctx.scale(k, k);
  ctx.font = font;
  ctx.fillStyle = "#fff";

  const axis = w / k / 2;

  metrics.forEach((m, i) => {
    // centre the *ink* on the axis, not the advance box
    const x = axis - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    ctx.fillText(letters[i], x, pad + cap + i * (row + gap));
  });

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const red = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < red.length; i += 4, j++) red[j] = rgba[i];

  const texture = new THREE.DataTexture(
    red,
    w,
    h,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // the type is read at a steep angle once it is on the ceiling
  texture.anisotropy = anisotropy;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  // the canvas is rounded up to whole texels, so the proportions are quoted
  // against what was actually drawn
  return {
    texture,
    material: makeTitleMaterial(texture, FILL),
    width: w / k / cap,
    height: h / k / cap,
    padTop: PAD,
    column: column / cap,
    widest: widest / cap,
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
 * The sheet the column is printed on, for a given widest-letter allowance.
 *
 * The letters are sized to run from {@link TOP} to {@link END} — unless that
 * would make the widest of them wider than `maxInk`, the share of the screen
 * the other sections' blocks fill. That is a phone: the frame is a quarter the
 * width there, so the letters are sized to fit it and the column simply ends
 * sooner, rather than being cropped at the sides.
 */
function buildSheet(art: TitleArt, maxInk: number) {
  const capW = Math.min((END - TOP) / art.column, maxInk / art.widest);

  return wallSheet(tunnelPath(), titleTable(), {
    top: TOP - art.padTop * capW,
    width: art.width * capW,
    height: art.height * capW,
    cols: COLS,
    rows: ROWS,
    inset: INSET,
  });
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

    const release = (a: TitleArt) => {
      a.texture.dispose();
      a.material.dispose();
    };

    drawTitle(TEXT, anisotropy).then((next) => {
      if (!next) return;
      drawn = next;

      if (alive) setArt(next);
      else release(next);
    });

    return () => {
      alive = false;
      if (drawn) release(drawn);
    };
  }, [anisotropy]);

  /**
   * The widest a letter may be: the share of the viewport the other sections'
   * blocks fill, measured where the type sits. The wall is that depth from the
   * pose the About section is held at, and the throat keeps the camera the same
   * distance off the crown as it curls, so the frame at the wall is the frame
   * the column is read in.
   */
  const maxInk = useMemo(() => {
    const frame = poseFrame(
      ABOUT_POSE,
      camera.fov,
      size.width / Math.max(1, size.height),
      WALL_Z,
    );
    return frame.width * blockFill(up.md);
  }, [camera.fov, size.width, size.height, up.md]);

  const geometry = useMemo(
    () => (art ? buildSheet(art, maxInk) : null),
    [art, maxInk],
  );

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!art || !geometry) return null;

  return (
    <mesh
      geometry={geometry}
      material={art.material}
      // after the shell, which it is tested against, and before the grid, so
      // the wall's lines are ruled over the type rather than cut out by it
      renderOrder={0.5}
      frustumCulled={false}
    />
  );
}
