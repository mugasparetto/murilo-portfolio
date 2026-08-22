"use client";

import {
  useRef,
  useEffect,
  CSSProperties,
  ReactNode,
  MouseEventHandler,
} from "react";
import * as THREE from "three";

type ButtonSize = "sm" | "md" | "lg";

export interface SpecularButtonProps {
  children?: ReactNode;
  size?: ButtonSize;
  radius?: number;
  tint?: string;
  tintOpacity?: number;
  blur?: number;
  textColor?: string;
  lineColor?: string;
  baseColor?: string;
  intensity?: number;
  shineSize?: number;
  shineFade?: number;
  thickness?: number;
  speed?: number;
  followMouse?: boolean;
  proximity?: number;
  autoAnimate?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  type?: "button" | "submit" | "reset";
}

interface ShaderProps {
  radius: number;
  lineColor: string;
  baseColor: string;
  intensity: number;
  shineSize: number;
  shineFade: number;
  thickness: number;
  speed: number;
  followMouse: boolean;
  proximity: number;
  autoAnimate: boolean;
}

const PAD = 20;
const TAU = Math.PI * 2;

/**
 * Rate the shine is drawn at.
 *
 * This is a second WebGL context with a frame loop of its own, and until it was
 * capped that loop ran at the panel's refresh rate — on a 165Hz display, three
 * draws for every one the scene got, since <FrameCap /> only owns the R3F loop.
 * The two contexts then trade places on the GPU three times as often as
 * anything asked them to, and the rect read below landed at the same rate.
 *
 * Same reasoning <FrameCap /> and <SolidIcon />'s shared ticker are capped for:
 * a slow specular sweep has nothing to spend the extra frames on, and they come
 * out of a budget the scene has already spoken for.
 */
const FPS = 60;

// Shortest signed turn from `a` to `b`, whatever range either one is in.
//
// JS `%` keeps the sign of its left operand, so the usual
// `((b - a + 3PI) % 2PI) - PI` shorthand quietly breaks once the two angles
// are more than a turn and a half apart: it then reports a turn of well over
// half a circle, and the light takes the long way round at whatever rate the
// smoothing below can manage. Both angles are kept wrapped now, but this
// stays correct regardless of what it is handed.
const shortestTurn = (a: number, b: number) => {
  const d = (b - a) % TAU;
  return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d;
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-[0.8rem] px-[16px] py-[8px]",
  md: "text-[1rem] px-[30px] py-[14px]",
  lg: "text-[1.15rem] px-10 py-[18px]",
};

// GLSL ES 1.00 — three injects `attribute vec3 position` and the precision
// header, so the fullscreen triangle only needs its clip-space passthrough.
const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shapeSDF(vec2 p) { return sdRoundedRect(p, uHalfSize, uRadius); }

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = shapeSDF(p);
  vec2 L = vec2(cos(uAngle), sin(uAngle));

  // Dark base stroke hugging the edge for a sense of thickness
  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;

  // Symmetric specular: the edges facing toward/away from the light both
  // catch a streak. The angular window (size + fade) is measured with an
  // elliptical normal so it varies continuously along straight edges.
  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);
  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float hi = line * rim * edgeClamp * uIntensity;

  vec3 col = uBaseColor * base + uLineColor * hi;
  float a = clamp(base + hi, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

const SpecularButton = ({
  children = "Get Started",
  size = "lg",
  radius = 18,
  tint = "#ffffff",
  tintOpacity = 0,
  blur = 0,
  textColor = "#f5f5f5",
  lineColor = "#ffffff",
  baseColor = "#525252",
  intensity = 1,
  shineSize = 10,
  shineFade = 40,
  thickness = 1,
  speed = 0.35,
  followMouse = true,
  proximity = 50,
  autoAnimate = false,
  disabled = false,
  onClick,
  className = "",
  type = "button",
}: SpecularButtonProps) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLSpanElement>(null);
  // Live shader settings read by the rAF loop, mirrored from props so the
  // WebGL effect never has to tear down on a prop change.
  const propsRef = useRef<ShaderProps>({
    radius,
    lineColor,
    baseColor,
    intensity,
    shineSize,
    shineFade,
    thickness,
    speed,
    followMouse,
    proximity,
    autoAnimate,
  });

  useEffect(() => {
    propsRef.current = {
      radius,
      lineColor,
      baseColor,
      intensity,
      shineSize,
      shineFade,
      thickness,
      speed,
      followMouse,
      proximity,
      autoAnimate,
    };
  });

  useEffect(() => {
    const btn = btnRef.current;
    const fx = fxRef.current;
    if (!btn || !fx) return;

    const dpr = window.devicePixelRatio || 1;
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    // Fullscreen triangle in clip space — no camera transform involved.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );

    const uniforms = {
      uCenter: { value: new THREE.Vector2(0, 0) },
      uHalfSize: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0 },
      uAngle: { value: 2.4 },
      uPx: { value: dpr },
      uLineColor: { value: new THREE.Color(1, 1, 1) },
      uBaseColor: { value: new THREE.Color(0.32, 0.32, 0.32) },
      uIntensity: { value: 1 },
      uShineSize: { value: 0.17 },
      uShineFade: { value: 0.7 },
      uThickness: { value: 1 },
      uBaseWidth: { value: dpr },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.Camera();

    fx.appendChild(renderer.domElement);

    const sizeRef = { w: 1, h: 1 };

    // The button's own box, cached.
    //
    // Reading it is a layout read, and a layout read from a `pointermove`
    // handler is a forced synchronous reflow of the whole page: Lenis scrolls
    // the document from its own rAF, so the layout is dirty again by the time
    // the next move arrives and the browser has to redo it on the spot, at
    // pointer rate. Cached here and refreshed in the frame loop below, only
    // once something it depends on has actually happened.
    const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 1, height: 1 };
    let rectDirty = true;

    const readRect = () => {
      const r = btn.getBoundingClientRect();
      rect.left = r.left;
      rect.top = r.top;
      rect.right = r.right;
      rect.bottom = r.bottom;
      rect.width = r.width;
      rect.height = r.height;
      rectDirty = false;
    };

    const resize = () => {
      // Fractional size + explicit center keep the SDF pinned to the exact
      // CSS border, instead of drifting up to a pixel from offsetWidth rounding.
      readRect();
      const w = rect.width;
      const h = rect.height;
      sizeRef.w = w;
      sizeRef.h = h;
      // updateStyle = false: the canvas is sized by CSS (w-full/h-full).
      renderer.setSize(w + PAD * 2, h + PAD * 2, false);
      uniforms.uCenter.value.set((PAD + w / 2) * dpr, (PAD + h / 2) * dpr);
      uniforms.uHalfSize.value.set((w / 2) * dpr, (h / 2) * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(btn);
    resize();

    // ── Whether anyone can actually see this ────────────────────────────
    //
    // Neither half of this is optional, because there are two quite different
    // ways for the button to be on the page and not on screen, and each one is
    // invisible to the check that catches the other.
    //
    // Scrolled away is the observer's job. Hidden outright is not: an
    // IntersectionObserver reports geometry, and a `visibility: hidden`
    // ancestor still has a box, so it goes on intersecting exactly as if it
    // were in view. That is not a corner case here — <HeadlineOverlay /> mounts
    // hidden and stays that way until <HeadlineDriver /> has placed it, and the
    // driver lives in the hero *scene*. Switch that scene off and the band is
    // hidden for the life of the page while everything inside it carries on
    // running: a WebGL context redrawing an invisible canvas every refresh, and
    // a `getBoundingClientRect` on every pointer move and every scroll.
    //
    // Ordered cheap-first — the flag is free, and `checkVisibility` is a style
    // question, so it is only asked about a button that is at least in view.
    let onScreen = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { rootMargin: "20% 0px" },
    );
    io.observe(btn);

    const isLive = () =>
      onScreen &&
      (btn.checkVisibility?.({
        visibilityProperty: true,
        contentVisibilityAuto: true,
      }) ?? true);

    // Scrolling moves the button without resizing it, so the observer above
    // never hears about it — and neither does it hear about a transform, which
    // is how a button carried by an animated overlay gets where it is drawn.
    // <HeadlineOverlay /> is exactly that: laid out at the top of the viewport
    // and translated down to the name's bottom edge every frame, hundreds of
    // pixels from where the box was first read, with no event of any kind.
    const markRectDirty = () => {
      rectDirty = true;
    };
    window.addEventListener("scroll", markRectDirty, { passive: true });
    window.addEventListener("resize", markRectDirty);

    // Light angle steers toward the pointer (anywhere on the page) and falls
    // back to a slow sweep when the pointer hasn't moved yet.
    //
    // The handler only banks where the pointer is; the angle itself is worked
    // out once a frame in `update`, which is the only place the cached box is
    // known to be current — and is also where it belongs, since several moves
    // can arrive between two frames and only the last of them is ever drawn.
    let pointerAngle: number | null = null;
    let proximityT = 0;
    let pointerX = 0;
    let pointerY = 0;
    let seenPointer = false;
    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      seenPointer = true;
      // A move is the one moment the cached box is certain to be measured
      // against something, so it is also the cue to refresh it — which covers
      // the transform case above without watching for it. This is only the
      // flag: the read itself still happens at most once per frame, in
      // `update`, never at pointer rate from in here.
      markRectDirty();
    };
    window.addEventListener("pointermove", onPointerMove);

    const aimAtPointer = () => {
      if (!seenPointer) return;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
      const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
      const dist = Math.hypot(dx, dy);
      // Over the button itself the light settles on the diagonal (framing the
      // corners) and gently sways with the cursor position within the button.
      if (dist === 0) {
        const nx = (pointerX - cx) / (rect.width / 2);
        const ny = (cy - pointerY) / (rect.height / 2);
        pointerAngle =
          Math.atan2(2 / rect.height, -2 / rect.width) + nx * 0.3 + ny * 0.15;
      } else {
        pointerAngle = Math.atan2(cy - pointerY, pointerX - cx);
      }
      const t = Math.max(0, 1 - dist / Math.max(propsRef.current.proximity, 1));
      proximityT = t * t * (3 - 2 * t);
    };

    let angle = 2.4;
    let idleAngle = 2.4;
    let bright = 0;
    let last = performance.now();
    let lastDraw = -Infinity;
    let raf = 0;

    const update = (now: number) => {
      raf = requestAnimationFrame(update);

      // Ahead of everything, so a skipped refresh costs one comparison. `last`
      // is deliberately left alone: `dt` is then measured from the frame that
      // actually drew, and the sweep runs at the speed it is authored at
      // whatever the cap or the panel happen to be.
      if (now - lastDraw < 1000 / FPS) return;
      lastDraw = now;

      // Nothing below is worth doing for a button nobody can see — and the two
      // expensive parts of it, the layout read and the draw, are exactly the
      // two that were still happening. See `isLive` above.
      if (!isLive()) return;

      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const p = propsRef.current;

      // Inside rAF the reflow this may cost is one the frame was going to pay
      // anyway, and only when the page has actually moved under the button.
      if (rectDirty) readRect();
      aimAtPointer();

      // Wrapped rather than free-running: an idle sweep left alone for a few
      // minutes piles up hundreds of radians, and the shader reads the angle
      // as a single highp float, which loses angular precision as the
      // magnitude climbs.
      idleAngle = (idleAngle + p.speed * dt) % TAU;
      const steer =
        p.followMouse &&
        pointerAngle != null &&
        (!p.autoAnimate || proximityT > 0);
      const target = steer ? pointerAngle! : idleAngle;
      angle += shortestTurn(angle, target) * (1 - Math.exp(-dt * 7));
      angle = ((angle % TAU) + TAU) % TAU;

      // Shine fades in with pointer proximity unless autoAnimate keeps it on
      const brightTarget = p.autoAnimate ? 1 : proximityT;
      bright += (brightTarget - bright) * (1 - Math.exp(-dt * 8));

      // Colors are authored as raw shader values, so parse without any
      // sRGB -> linear conversion.
      uniforms.uLineColor.value.setStyle(
        p.lineColor,
        THREE.LinearSRGBColorSpace,
      );
      uniforms.uBaseColor.value.setStyle(
        p.baseColor,
        THREE.LinearSRGBColorSpace,
      );
      uniforms.uAngle.value = angle;
      uniforms.uRadius.value =
        Math.min(p.radius, Math.min(sizeRef.w, sizeRef.h) / 2) * dpr;
      uniforms.uIntensity.value = p.intensity * bright;
      uniforms.uShineSize.value = (p.shineSize * Math.PI) / 180;
      uniforms.uShineFade.value = (p.shineFade * Math.PI) / 180;
      uniforms.uThickness.value = p.thickness * dpr;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", markRectDirty);
      window.removeEventListener("resize", markRectDirty);
      if (renderer.domElement.parentNode === fx)
        fx.removeChild(renderer.domElement);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`relative m-0 inline-flex cursor-pointer items-center justify-center border-none font-medium leading-none tracking-[0.01em] outline-none transition-transform duration-150 active:scale-[0.97] disabled:cursor-default disabled:opacity-55 disabled:active:scale-100 [color:var(--sb-text-color)] [border-radius:var(--sb-radius)] [background:color-mix(in_srgb,var(--sb-tint)_calc(var(--sb-tint-opacity)*100%),transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.25)] focus-visible:outline-2 focus-visible:outline-offset-[3px] ${SIZES[size] || SIZES.md}${className ? ` ${className}` : ""}`}
      style={
        {
          "--sb-radius": `${radius}px`,
          "--sb-tint": tint,
          "--sb-tint-opacity": tintOpacity,
          "--sb-text-color": textColor,
          // Emitted only when it would do something. `blur(0px)` is still a
          // non-empty filter list, so the browser gives the button a render
          // surface and captures the backdrop behind it — over a canvas that
          // redraws every frame, for a blur of nothing. The default is 0 and
          // the one call site (<HeadlineOverlay />) is opaque black anyway, so
          // this was pure cost.
          ...(blur > 0 ? { backdropFilter: `blur(${blur}px)` } : null),
        } as CSSProperties
      }
    >
      <span
        ref={fxRef}
        aria-hidden="true"
        className="pointer-events-none absolute -inset-5 z-[1] [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full"
      />
      <span className="relative z-[2]">{children}</span>
    </button>
  );
};

export default SpecularButton;
