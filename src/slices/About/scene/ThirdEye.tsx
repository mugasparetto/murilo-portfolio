import {
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { setPageCursor } from "@/app/helpers/cursor";
import { displayShader } from "@/app/components/fluidShader";
import { defaultParams } from "@/slices/Hero/scene-core/params";

// ─── Geometry ─────────────────────────────────────────────────────────────────
//
// Everything below is in the head sprite's own world units. The eye is a child
// of that sprite's group, which is unscaled, so these are the same units the
// snap offsets and the piece bounds are written in.
//
// `EYE_SCALE` then shrinks the whole eye on top of that, so the lengths here are
// the eye at full size rather than what lands on screen. `position` is the one
// exception — it sits on the scaled group itself, so it is read in the sprite's
// units, unscaled, and stays a straight UV → world conversion.

/**
 * Where the eye sits on the skull cap, in the head texture's UV space.
 *
 * **This is the only knob for placing the eye.** It feeds two things that have
 * to agree — where the quad sits on the sprite, and which patch of skin the lid
 * resamples — so move the eye by changing these numbers and nothing else. In
 * particular the `- 0.5` in `position` below is the UV → centred-world
 * conversion, not an offset: nudging it slides the quad without sliding the
 * skin window with it, and the lid then redraws the wrong piece of forehead.
 *
 * Measured off `top.webp` rather than eyeballed: the cap is fully opaque down
 * to v ≈ 0.74 and spans the width there, so an eye centred here keeps the whole
 * lid quad on solid, bright forehead. Push it much lower and the quad's bottom
 * edge runs off the cap's feathered cut, where the skin the lid redraws is only
 * part opaque — and the orb shows straight through it. Sideways there is more
 * room than you need: the quad stays fully opaque out to u ≈ 0.68 (and to
 * u ≈ 0.36 the other way) before its edge reaches the dome's.
 */
const CENTRE_UV = { u: 0.63, v: 0.77 };

/** Half-extents of the aperture at full open. Roughly 1.8:1, like a real eye. */
const APERTURE = { width: 34, height: 19 };

/**
 * The lid quad — the patch of forehead that gets redrawn over the orb.
 *
 * It has to cover the orb wherever the gaze wanders (`ORB_RADIUS` + `GAZE`),
 * not just the aperture: past the aperture's edge this quad's skin is the only
 * thing hiding the orb. Whatever margin is left over is what the outline and
 * its antialiasing run in.
 */
const LID = { width: 104, height: 60 };

/**
 * Overall size of the eye, applied as a scale on its group so every number here
 * can stay written at full size.
 *
 * **It has to reach `uSkinSize` as well**, and that is the whole catch. The lid's
 * skin window is the quad's footprint expressed in the texture's UVs, and this
 * scale is part of that footprint — leave it out and the lid resamples a patch
 * `1 / EYE_SCALE` wider than it covers, redraws the forehead at the wrong
 * magnification, and the quad reads as a rectangle pasted on the head instead of
 * a hole in it. Aperture, rim and gaze all ride along on their own, being
 * fractions of the quad rather than lengths in UV space.
 */
const EYE_SCALE = 0.85;

/** The iris — the disc carrying the door's material. */
const ORB_RADIUS = 17;
/**
 * How much of the door's pattern the iris shows. 1 is the whole field, the same
 * framing the door draws; above that crops to the middle, so the swirl reads at
 * a larger scale on a disc a fraction of the door's size. Below 1 pulls back and
 * tiles, since the pattern is not periodic — treat 1 as the floor.
 */
const IRIS_ZOOM = 1.25;
/** The pupil, concentric with the iris. */
const PUPIL_RADIUS = 7.0;
const BEAD_RADIUS = 3.4;
/** Where the highlight sits on the orb, as a fraction of the iris radius. */
const BEAD_OFFSET = { x: 0.4, y: 0.42 };

/** How far the orb drifts from centre while it looks around. */
const GAZE = { x: 8, y: 4 };

/**
 * Lid curve exponent. The two lids are `(1 - x²)^n`, mirrored about the seam,
 * so they meet at the same two corners however open the eye is — which is what
 * lets a blink be one scalar rather than a rebuilt shape. 1 is a parabola;
 * above that the corners taper to sharper points.
 */
const LID_CORNER = 1.15;

/** Half-thickness of the outline hugging the aperture, in world units. */
const RIM_WIDTH = 1.2;
const RIM_COLOR = "#ffffff";

// ─── Timing ───────────────────────────────────────────────────────────────────

/** Beat between the face finishing assembly and the eye starting to open. */
const OPEN_DELAY = 0.3;
const OPEN_DURATION = 1.2;
/** Overshoot on the reveal, so it snaps wide and settles rather than easing in. */
const OPEN_OVERSHOOT = 0.12;

/**
 * How long the eye takes to shut when the scene is put back to the start.
 *
 * A good deal slower than a blink's own shut, which is a tic you barely catch:
 * this is the eye deliberately closing, and it is the first half of the reset.
 * <Head /> times the second half against it, which is why it is exported.
 */
export const CLOSE_DURATION = 0.35;

const BLINK_DURATION = 0.26;
/** Fraction of a blink spent closing. The rest is the slower reopen. */
const BLINK_CLOSE = 0.38;
const BLINK_INTERVAL: readonly [number, number] = [2.2, 6];
const DOUBLE_BLINK_CHANCE = 0.5;

/**
 * Half-extents of the click target, as a multiple of the aperture's. A little
 * past the lash line so the rim and the corners answer to a click too, and well
 * short of the lid quad, which runs on into forehead that shouldn't.
 */
const HIT_PADDING = 1.25;

const SACCADE_INTERVAL: readonly [number, number] = [0.7, 1.8];
/** Approach to a new gaze target, per 60Hz frame. High = a flick, not a glide. */
const GAZE_LERP = 0.16;

/**
 * Master switch for the pointer mode. `false` pins the eye to the idle saccade
 * animation whatever the pointer does; `true` lets the threshold below hand the
 * gaze back and forth between the two. Everything else about the eye — the
 * reveal, the blinks, the spin — is the same either way; only where `gazeTarget`
 * comes from changes.
 */
const FOLLOW_POINTER = true;

/**
 * How close the pointer has to come before it has the eye's attention, measured
 * from the eye's own position on screen in units of half the viewport height —
 * so 1 reaches the top and bottom edges from a centred eye. Inside it the eye
 * tracks the cursor; outside it goes back to looking around on its own.
 *
 * Aspect-corrected where it is measured, so this is a circle on screen rather
 * than a shape that stretches with the window. `POINTER_REACH` below is
 * deliberately *not* — the two are different jobs, and the note there says why.
 */
const POINTER_RANGE = 0.4;

/**
 * Extra range the pointer keeps once it already has the eye, as a fraction of
 * `POINTER_RANGE`. Without a gap between the two edges a cursor parked on the
 * boundary — or just drifting a pixel either way — flips the eye between modes
 * every frame, and the gaze jitters between the cursor and a random point.
 */
const POINTER_RANGE_HYSTERESIS = 0.15;

/**
 * How far the pointer has to be from the eye for the gaze to reach the edge of
 * its ellipse, measured in NDC — so 1 is half the screen, and these are a
 * little under half of that each way. Keep them inside `POINTER_RANGE` or the
 * eye hands the gaze back before it has used its full travel.
 *
 * NDC is the right space for this because the pointer is a screen thing, not a
 * world one: the offset is read between the eye's own projected position and
 * the cursor, every frame, so the tracking holds while the head is dragged
 * across the screen and while the parallax rig sways the camera. Unlike the
 * range, this one is left uncorrected for aspect and split per axis, for the
 * same reason `GAZE` is: it is a gain on an eye that is wider than it is tall,
 * not a distance, and evening the axes out would leave the vertical unused.
 */
const POINTER_REACH = { x: 0.45, y: 0.4 };

/**
 * Approach to the pointer, per 60Hz frame. Lower than `GAZE_LERP`: a saccade is
 * a flick between two rest points, but this is a follow, and at flick speed it
 * reads as the orb being welded to the cursor.
 */
const POINTER_LERP = 0.29;

/** Idle spin of the orb, rad/s, and the burst it opens with. */
const SPIN_IDLE = 0.22;
const SPIN_BURST = 8;
/** Fraction of the spin burst still left one second later. */
const SPIN_DAMP = 0.12;
/** Extra turn per world unit of sideways gaze — the orb rolls as it looks. */
const SPIN_ROLL = 0.05;

// ─── Lid shader ───────────────────────────────────────────────────────────────
//
// The lid is the forehead, not a shape laid over it: it draws the same texture
// the head sprite is already drawing there, sampled through the same map
// pipeline, and punches the aperture out of its alpha. So the eye is a hole in
// the skin, the skin keeps its own shading and grain right up to the lash line,
// and opening the eye costs one uniform instead of a rebuilt geometry.
//
// It patches a MeshBasicMaterial rather than being a ShaderMaterial of its own
// on purpose. A raw shader would have to reproduce three's map decode and
// output encode exactly or the quad would read as a lighter rectangle sitting
// on the forehead; going through the built-in chunks, it cannot drift.
//
// For the same reason it maps the sprite's *own* texture object rather than a
// clone framed on the eye. R3F stamps `colorSpace = SRGBColorSpace` onto every
// texture it assigns through a JSX prop, and colour space picks the GL internal
// format — so a clone, assigned imperatively and never stamped, uploads as raw
// RGBA8 next to the sprite's SRGB8_ALPHA8. Its texels then skip the hardware
// decode, get treated as if they were already linear, and the quad comes out
// visibly brighter than the forehead around it. The window is applied to the
// UVs instead, in the vertex shader below, where there is nothing to diverge.

const LID_PARS_VERTEX = /* glsl */ `
uniform vec2 uSkinCentre;
uniform vec2 uSkinSize;
varying vec2 vQuadUv;
`;

const LID_SKIN_UV = /* glsl */ `
vQuadUv = uv;
vMapUv = uSkinCentre + (uv - 0.5) * uSkinSize;
`;

const LID_PARS = /* glsl */ `
uniform vec2 uAperture;
uniform float uOpen;
uniform float uCorner;
uniform float uRim;
uniform vec3 uRimColor;
varying vec2 vQuadUv;
`;

const LID_APERTURE = /* glsl */ `
{
  // Aperture space: the corners sit at x = ±1, the fully open lids at y = ±1.
  vec2 q = (vQuadUv - 0.5) / uAperture;
  float ax = abs(q.x);
  float axc = min(ax, 1.0);

  float lid = pow(1.0 - axc * axc, uCorner) * uOpen;

  // Vertical distance over the lid's own slope ≈ perpendicular distance, which
  // is what keeps the outline an even thickness instead of pinching to nothing
  // where the curve dives into the corners.
  float slope = 2.0 * uCorner * uOpen * axc
              * pow(max(1.0 - axc * axc, 1e-4), uCorner - 1.0);
  float dy = (abs(q.y) - lid) / length(vec2(slope, 1.0));

  // Past the corners the nearest point on the outline is the corner itself.
  float dx = ax - 1.0;
  float d = dx > 0.0 ? length(vec2(dx, dy)) : dy;

  float aa = fwidth(d) + 1e-5;
  float hole = 1.0 - smoothstep(-aa, aa, d);
  float rim = 1.0 - smoothstep(uRim - aa, uRim + aa, abs(d));

  diffuseColor.rgb = mix(diffuseColor.rgb, uRimColor, rim);
  diffuseColor.a = max(diffuseColor.a * (1.0 - hole), rim);
}
`;

// ─── Orb material ─────────────────────────────────────────────────────────────

/** Mirrors <FluidMaterial />'s conversion, so the palette lands where the door's does. */
function hexToLinearVec3(hex: string) {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * The door's distortion comes off a live fluid sim the pointer stirs. The eye
 * runs the same display shader against a velocity field that is simply zero:
 * same palette, same swirl, same clock, and no second 512×1024 ping-pong to pay
 * for on a surface the pointer never reaches.
 */
const STILL_FLUID = new THREE.DataTexture(new Uint8Array(4), 1, 1);
STILL_FLUID.needsUpdate = true;

/**
 * The door's vertex shader with a window on the quad's UVs.
 *
 * Zoom belongs here rather than in `iResolution`: the display shader normalises
 * `fragCoord` by the smaller axis, so on a square resolution the two cancel to
 * `vUv * 2 - 1` and the numbers there only set the aspect. `vUv` is the pattern's
 * only other input — the fluid lookup is a 1×1 still — so cropping it is the
 * whole of the zoom, and the shared fragment shader stays unforked.
 */
const ORB_VERTEX = /* glsl */ `
uniform float uZoom;
varying vec2 vUv;
void main() {
  vUv = 0.5 + (uv - 0.5) / uZoom;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThirdEyeHandle = {
  /** Start the reveal. Ignored once it has already been asked to open. */
  open: () => void;
  /**
   * Shut the eye over {@link CLOSE_DURATION} and put it away, leaving it
   * exactly as it was before it was ever asked to open — ready to be revealed
   * again by the next `open()`. Ignored unless the eye is open and idle.
   */
  close: () => void;
};

type Props = {
  ref?: RefObject<ThirdEyeHandle | null>;
  /** The head slice's texture — the lid redraws it over the orb. */
  skin: THREE.Texture;
  /** World scale of the head sprite, so the lid can find its own patch of skin. */
  spriteScale: [number, number, number];
  /**
   * Clicking the open eye. It is the one thing in the finished scene still
   * asking to be touched, so it is what puts the scene back to the start —
   * see `handleReset` in <Head />, which is where that actually happens.
   */
  onReset?: () => void;
};

type Phase = "hidden" | "opening" | "idle" | "closing";

/** Scratch for the pointer test below. Never outlives the frame it is written in. */
const eyeNdc = new THREE.Vector3();

const randomIn = ([lo, hi]: readonly [number, number]) =>
  lo + Math.random() * (hi - lo);

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 0 → 1 → 0 across one blink, shutting faster than it reopens. */
function blinkCurve(t: number) {
  return t < BLINK_CLOSE
    ? smooth(t / BLINK_CLOSE)
    : 1 - smooth((t - BLINK_CLOSE) / (1 - BLINK_CLOSE));
}

/** Ease out past 1 and back, so the reveal snaps wide and settles. */
function easeOutBack(t: number) {
  const u = t - 1;
  return 1 + u * u * ((OPEN_OVERSHOOT + 1) * u + OPEN_OVERSHOOT);
}

/**
 * Everything the frame loop mutates, at the values it mounts with.
 *
 * A factory rather than a literal in the ref, because the end of `close()` has
 * to put the eye back to exactly this, and a second list of the same fields is
 * a list that will drift from this one.
 */
const initialState = () => ({
  phase: "hidden" as Phase,
  delay: 0,
  /** Reveal progress, 0–1. */
  reveal: 0,
  /** Shut progress, 0–1, once the eye has been asked to close. */
  closing: 0,
  /** Blink progress, 0–1, or < 0 when the eye is not blinking. */
  blink: -1,
  /** Seconds of idle left before the next blink. */
  untilBlink: 0,
  /** Whether the blink running now is the first of a pair. */
  doubleBlink: false,
  gaze: new THREE.Vector2(),
  gazeTarget: new THREE.Vector2(),
  untilSaccade: 0,
  /** Whether the pointer currently holds the gaze. Drives the hysteresis. */
  following: false,
  spin: 0,
  spinVel: 0,
});

export default function ThirdEye({ ref, skin, spriteScale, onReset }: Props) {
  const group = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const pupil = useRef<THREE.Mesh>(null);
  const bead = useRef<THREE.Mesh>(null);

  const position = useMemo<[number, number, number]>(
    () => [
      (CENTRE_UV.u - 0.5) * spriteScale[0],
      (CENTRE_UV.v - 0.5) * spriteScale[1],
      // A hair in front of the sprite plane. Nothing in the stack below writes
      // depth — renderOrder decides what covers what — so this only has to
      // clear the sprite it is drawn over.
      1,
    ],
    [spriteScale],
  );

  const lidUniforms = useMemo(
    () => ({
      // The patch of head texture under the quad, so the lid samples exactly
      // what the sprite is already drawing there.
      uSkinCentre: { value: new THREE.Vector2(CENTRE_UV.u, CENTRE_UV.v) },
      uSkinSize: {
        value: new THREE.Vector2(
          (LID.width * EYE_SCALE) / spriteScale[0],
          (LID.height * EYE_SCALE) / spriteScale[1],
        ),
      },
      uAperture: {
        value: new THREE.Vector2(
          APERTURE.width / LID.width,
          APERTURE.height / LID.height,
        ),
      },
      uOpen: { value: 0 },
      uCorner: { value: LID_CORNER },
      uRim: { value: RIM_WIDTH / APERTURE.height },
      // Already in the working colour space — Color converts from sRGB on the
      // way in, and this is mixed into diffuseColor before the output encode.
      uRimColor: { value: new THREE.Color(RIM_COLOR) },
    }),
    [spriteScale],
  );

  const lidMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: skin,
      transparent: true,
      depthWrite: false,
    });

    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, lidUniforms);

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${LID_PARS_VERTEX}`)
        // Overwrites the map UVs the chunk just wrote, so the quad shows its
        // own window of the head texture. vQuadUv keeps the quad's raw UVs —
        // the aperture is placed on the quad, not on the texture.
        .replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>\n${LID_SKIN_UV}`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${LID_PARS}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>\n${LID_APERTURE}`,
        );
    };

    return m;
  }, [skin, lidUniforms]);

  const orbMat = useMemo(() => {
    const p = defaultParams;

    return new THREE.ShaderMaterial({
      uniforms: {
        iTime: { value: 0 },
        // Square, unlike the door's 1:2 quad — the pattern has to read at the
        // same scale in both directions on something round.
        iResolution: { value: new THREE.Vector2(128, 128) },
        iFluid: { value: STILL_FLUID },
        uZoom: { value: IRIS_ZOOM },
        uSeed: { value: 0 },
        uDistortionAmount: { value: p.distortionAmount },
        uColor1: { value: hexToLinearVec3(p.color1) },
        uColor2: { value: hexToLinearVec3(p.color2) },
        uColor3: { value: hexToLinearVec3(p.color3) },
        uColor4: { value: hexToLinearVec3(p.color4) },
        uColorIntensity: { value: p.colorIntensity },
        uSoftness: { value: p.softness },
      },
      vertexShader: ORB_VERTEX,
      fragmentShader: displayShader,
      // The shader returns alpha 1, so this blends exactly as the opaque door
      // does. It is only here to put the orb in the transparent queue, where
      // renderOrder decides the stacking and nothing writes depth.
      transparent: true,
      depthWrite: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      // `skin` itself is the sprite's, and <Head /> owns it — only the
      // materials built here are ours to drop.
      lidMat.dispose();
      orbMat.dispose();
    };
  }, [lidMat, orbMat]);

  // The frame loop reaches the uniforms through a ref rather than through the
  // memo — the compiler treats anything a hook returned as frozen, and this is
  // the route <MetaBalls /> takes for the same reason. Re-pointed on the
  // (never, in practice) chance either set is rebuilt.
  const live = useRef({ lid: lidUniforms, orb: orbMat.uniforms });

  useEffect(() => {
    live.current = { lid: lidUniforms, orb: orbMat.uniforms };
  }, [lidUniforms, orbMat]);

  const state = useRef(initialState());

  /** Whether the pointer is over the eye, so the cursor can be handed back. */
  const hovering = useRef(false);

  /**
   * Click the open eye to put the scene back to the start.
   *
   * Idle only: the eye is not something to press at while it is still coming
   * open, and a reset booked mid-reveal would take the scene apart under an
   * animation that is still playing.
   */
  const handlePointerDown = useCallback(() => {
    if (state.current.phase !== "idle") return;
    onReset?.();
  }, [onReset]);

  const handlePointerOver = useCallback(() => {
    if (state.current.phase !== "idle") return;
    hovering.current = true;
    setPageCursor("pointer");
  }, []);

  const handlePointerOut = useCallback(() => {
    if (!hovering.current) return;
    hovering.current = false;
    // Back to what <PolygonSprite /> leaves over the head it is done with: by
    // the time the eye is clickable the face is assembled and no longer grabs.
    setPageCursor("default");
  }, []);

  // The About scene unmounts when it goes inactive, and R3F drops a hovered
  // object without telling it — so without this, scrolling away mid-hover
  // leaves the pointer cursor over the whole page.
  useEffect(() => handlePointerOut, [handlePointerOut]);

  useImperativeHandle(ref, () => ({
    open: () => {
      const s = state.current;
      if (s.phase !== "hidden") return;

      s.phase = "opening";
      s.delay = OPEN_DELAY;
      s.spinVel = SPIN_BURST;
      s.untilSaccade = randomIn(SACCADE_INTERVAL);
    },
    close: () => {
      const s = state.current;
      if (s.phase !== "idle") return;

      s.phase = "closing";
      s.closing = 0;
      // A blink caught mid-flight would be reopening the lids underneath the
      // shut, so it is dropped rather than played out.
      s.blink = -1;
      s.doubleBlink = false;

      // Inert from here — every handler above is idle-only — so the cursor goes
      // back now rather than waiting for the lids to meet. Clearing the flag is
      // also what stops the real `pointerout`, which the eye is about to fire
      // as it vanishes, from doing this a second time.
      handlePointerOut();
    },
  }));

  useFrame(({ clock, camera, pointer, size }, delta) => {
    const s = state.current;
    if (s.phase === "hidden") return;

    // Capped so a hitch can't skip a blink or fling the gaze past its target.
    const dt = Math.min(delta, 1 / 20);

    if (s.delay > 0) {
      s.delay -= dt;
      return;
    }

    if (group.current && !group.current.visible) group.current.visible = true;

    if (s.phase === "opening") {
      s.reveal = Math.min(s.reveal + dt / OPEN_DURATION, 1);
      if (s.reveal >= 1) {
        s.phase = "idle";
        s.untilBlink = randomIn(BLINK_INTERVAL);
      }
    }

    // ── Blinks, and the one shut that isn't one ───────────────────────────────
    //
    // Both come out as `shut`, which is what the lid is driven by: the eye
    // closing for good is the same movement as a blink, just slower and without
    // the reopen.
    let shut = 0;

    if (s.phase === "closing") {
      s.closing += dt / CLOSE_DURATION;

      if (s.closing >= 1) {
        // Shut. Everything the loop drives is put back by hand here, because
        // `hidden` stops it dead and none of it is written again until the next
        // reveal starts from the top.
        live.current.lid.uOpen.value = 0;
        if (group.current) group.current.visible = false;

        if (orb.current) {
          orb.current.position.set(0, 0, 0);
          orb.current.rotation.z = 0;
        }
        pupil.current?.position.set(0, 0, 0);
        bead.current?.position.set(0, 0, 0);

        state.current = initialState();
        return;
      }

      shut = smooth(s.closing);
    }

    if (s.phase === "idle") {
      if (s.blink >= 0) {
        s.blink += dt / BLINK_DURATION;
        if (s.blink >= 1) {
          if (s.doubleBlink) {
            s.doubleBlink = false;
            s.blink = 0;
          } else {
            s.blink = -1;
            s.untilBlink = randomIn(BLINK_INTERVAL);
          }
        }
      } else {
        s.untilBlink -= dt;
        if (s.untilBlink <= 0) {
          s.blink = 0;
          s.doubleBlink = Math.random() < DOUBLE_BLINK_CHANCE;
        }
      }

      if (s.blink >= 0) shut = blinkCurve(Math.min(s.blink, 1));
    }

    live.current.lid.uOpen.value = easeOutBack(s.reveal) * (1 - shut);

    // ── Gaze ──────────────────────────────────────────────────────────────────
    //
    // Two modes, one target: whichever is running only ever writes `gazeTarget`
    // and leaves the lerp below to carry the orb there, so the eye keeps the
    // same weight either way. Which one runs is decided per frame by how far the
    // pointer is from the eye — inside `POINTER_RANGE` the cursor has its
    // attention, past that it goes back to looking around on its own.
    let following = false;

    if (FOLLOW_POINTER && group.current) {
      // Where the eye itself lands on screen, which is neither the middle of it
      // nor a fixed spot: the head is draggable and the camera sways.
      group.current.getWorldPosition(eyeNdc).project(camera);

      const offsetX = pointer.x - eyeNdc.x;
      const offsetY = pointer.y - eyeNdc.y;

      const distance = Math.hypot(
        (offsetX * size.width) / size.height,
        offsetY,
      );
      following =
        distance <
        POINTER_RANGE * (s.following ? 1 + POINTER_RANGE_HYSTERESIS : 1);

      if (following) {
        let nx = offsetX / POINTER_REACH.x;
        let ny = offsetY / POINTER_REACH.y;

        // Clamp to the unit circle rather than per axis, so a pointer off the
        // corner saturates on the ellipse's diagonal instead of overshooting to
        // its bounding box and popping the orb outside the aperture.
        const reach = Math.hypot(nx, ny);
        if (reach > 1) {
          nx /= reach;
          ny /= reach;
        }

        s.gazeTarget.set(nx * GAZE.x, ny * GAZE.y);
      } else if (s.following) {
        // The pointer has just left. Restart the idle clock instead of letting
        // an expired one fire immediately, so the eye holds the look it was
        // giving for a beat before it drifts off — the same beat a person takes
        // to lose interest, rather than snapping away the instant you step out.
        s.untilSaccade = randomIn(SACCADE_INTERVAL);
      }
    }

    s.following = following;

    if (!following) {
      s.untilSaccade -= dt;
      if (s.untilSaccade <= 0) {
        s.untilSaccade = randomIn(SACCADE_INTERVAL);
        // The sqrt spreads the picks evenly over the ellipse instead of piling
        // them up in the middle, so the eye actually uses its corners.
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random());
        s.gazeTarget.set(
          Math.cos(angle) * radius * GAZE.x,
          Math.sin(angle) * radius * GAZE.y,
        );
      }
    }

    const previousX = s.gaze.x;
    const gazeLerp = following ? POINTER_LERP : GAZE_LERP;
    s.gaze.lerp(s.gazeTarget, 1 - Math.pow(1 - gazeLerp, dt * 60));

    // ── Spin ──────────────────────────────────────────────────────────────────
    s.spinVel += (SPIN_IDLE - s.spinVel) * (1 - Math.pow(SPIN_DAMP, dt));
    s.spin += s.spinVel * dt + (s.gaze.x - previousX) * SPIN_ROLL;

    if (orb.current) {
      orb.current.position.set(s.gaze.x, s.gaze.y, 0);
      orb.current.rotation.z = s.spin;
    }

    if (pupil.current) {
      pupil.current.position.set(s.gaze.x, s.gaze.y, 0);
    }

    if (bead.current) {
      bead.current.position.set(
        s.gaze.x + ORB_RADIUS * BEAD_OFFSET.x,
        s.gaze.y + ORB_RADIUS * BEAD_OFFSET.y,
        0,
      );
    }

    live.current.orb.iTime.value = clock.getElapsedTime();
  });

  return (
    <group ref={group} position={position} scale={EYE_SCALE} visible={false}>
      {/* Behind the orb, covering the whole aperture: what the white of the eye
          would be, in a scene that only owns black and white. Drawn over the
          forehead and then covered straight back up by the lid. */}
      <mesh renderOrder={11}>
        <planeGeometry args={[LID.width, LID.height]} />
        <meshBasicMaterial color="black" transparent depthWrite={false} />
      </mesh>

      <mesh ref={orb} material={orbMat} renderOrder={12}>
        <circleGeometry args={[ORB_RADIUS, 64]} />
      </mesh>

      {/* Pupil and highlight are siblings of the iris rather than children: they
          travel with the gaze but sit still through the spin, and parenting
          would hand them the rotation too. The frame loop keeps both pinned. */}
      <mesh ref={pupil} renderOrder={13}>
        <circleGeometry args={[PUPIL_RADIUS, 48]} />
        <meshBasicMaterial color="black" transparent depthWrite={false} />
      </mesh>

      <mesh ref={bead} renderOrder={14}>
        <circleGeometry args={[BEAD_RADIUS, 32]} />
        <meshBasicMaterial color="white" transparent depthWrite={false} />
      </mesh>

      <mesh material={lidMat} renderOrder={15}>
        <planeGeometry args={[LID.width, LID.height]} />
      </mesh>

      {/* Click target. A mesh of its own rather than handlers on
          the group or on the lid: R3F raycasts an interactive object's
          descendants too, so hanging them on the group would test the orb and
          both discs on every pointermove, and the lid quad reaches out into
          forehead that shouldn't answer to a click. A unit circle under the
          aperture's own half-extents, so the target is the ellipse the eye
          actually is; `material.visible` skips the draw and leaves the mesh
          raycastable. */}
      <mesh
        scale={[APERTURE.width * HIT_PADDING, APERTURE.height * HIT_PADDING, 1]}
        onPointerDown={handlePointerDown}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
