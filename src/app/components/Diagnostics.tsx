"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { postBypassed, setPostBypassed, swayOn, setSwayOn } from "./diagFlags";
import { pxToVh } from "@/app/helpers/viewport";

/**
 * A frame profiler and a bisect harness, for finding where a dropped frame
 * actually went.
 *
 * `<Stats />` reports one number, and one number can't tell a scene that costs
 * too much to draw apart from a main thread that never got round to drawing
 * it. This reports the three buckets that can:
 *
 * - **js** — everything between the first `useFrame` and the last, which is
 *   every scene callback plus the composer's own render dispatch. Main-thread
 *   work this scene asked for.
 * - **gpu** — wall time the GPU spent on the frame, where the driver exposes
 *   `EXT_disjoint_timer_query_webgl2`. Absent on plenty of machines, which is
 *   what the third bucket is for.
 * - **other** — the frame interval less `js`. Style, layout, paint, compositing,
 *   backdrop-filter re-samples, and any GPU time the CPU ended up waiting on.
 *   Big here and small in `js` means the cost isn't in this file's language.
 *
 * `long` counts `longtask` entries — main-thread blocks over 50ms, from
 * anywhere on the page, R3F or not.
 *
 * `calls` / `tris` are per *frame*, not per `render()`: `gl.info.autoReset` is
 * turned off and reset here instead, so the fluid sim's pass and every
 * composer pass are counted together. A jump in them across a scroll window is
 * geometry entering the frustum; a jump in `progs` is a shader compiling mid
 * scroll, which reads as one enormous frame rather than as a low rate.
 *
 * ── The toggles ───────────────────────────────────────────────────────────
 *
 * Bisecting beats reasoning: turn half the frame off and see whether the drop
 * goes with it.
 *
 *   1  hero scene      2  about scene     3  DOM overlays
 *   4  postprocessing  5  dpr 1 / native  6  pointer sway
 *   0  reset counters
 *
 * The scenes go by `visible`, so nothing unmounts and no geometry is rebuilt —
 * the toggle costs a frame, not a hitch.
 *
 * The overlays go by `visibility` on the bands themselves, matched by their
 * `data-overlay-band` attribute through a stylesheet this file injects. Three
 * things about that are deliberate:
 *
 * - **The bands, not `<main>`.** `<main>` is the <Canvas />'s `eventSource`,
 *   and a hidden element is not a hit-test target — hiding it stops the pointer
 *   listeners, freezes `state.pointer` and leaves <ParallaxRig /> holding an
 *   arbitrary camera offset. That folded a cost driver, and a wrong pose, into
 *   a toggle labelled "DOM". The sway is key 6 now, on its own.
 * - **`!important`.** Each driver writes `band.style.visibility = "visible"`
 *   inline the moment its band comes on screen, and a style attribute outranks
 *   any ordinary rule. An important author declaration is the one thing above
 *   it, so this is the only mechanism the drivers can't undo mid-scroll.
 * - **`visibility`, not `display`.** `display: none` zeroes the band's box, and
 *   <AboutOverlay />'s `measure()` reads exactly that box: the column's height
 *   and the face's slot. With the slot gone <Scene /> reads "no column" and
 *   hides the head, which would put scene cost in the DOM bucket. Hidden boxes
 *   keep their geometry, so every measurement stays honest while raster, render
 *   surface and composited draw all go.
 *
 * What key 3 does *not* take out: the drivers keep running, computing their
 * offset and writing `transform` to a hidden band. That's the point — they cost
 * a projection and a string, and the question this toggle asks is about paint.
 * <SiteNav /> also stays, being mounted outside `<main>` and opaque anyway.
 *
 * Dev-only: <SceneManager /> mounts it behind `NODE_ENV`, so none of this
 * reaches a build.
 */

/**
 * Hides the overlay bands for key 3. See the toggle notes above for why it is
 * `visibility`, why it is `!important`, and why it matches the bands rather
 * than `<main>`.
 */
const DOM_OFF_RULE =
  '[data-diag-dom="off"] [data-overlay-band]{visibility:hidden!important}';

/** how often the panel is written, in ms — DOM work, so not every frame */
const PANEL_INTERVAL = 250;

/** samples kept for the percentiles: about two seconds at 82fps */
const WINDOW = 180;

type Ring = {
  values: Float32Array;
  index: number;
  count: number;
};

function ring(): Ring {
  return { values: new Float32Array(WINDOW), index: 0, count: 0 };
}

function push(r: Ring, v: number) {
  r.values[r.index] = v;
  r.index = (r.index + 1) % WINDOW;
  if (r.count < WINDOW) r.count++;
}

function mean(r: Ring) {
  if (!r.count) return 0;
  let sum = 0;
  for (let i = 0; i < r.count; i++) sum += r.values[i];
  return sum / r.count;
}

/** p95, off a copy — sorting the ring itself would scramble the write order */
const sortScratch = new Float32Array(WINDOW);

function p95(r: Ring) {
  if (!r.count) return 0;
  const slice = sortScratch.subarray(0, r.count);
  slice.set(r.values.subarray(0, r.count));
  slice.sort();
  return slice[Math.min(r.count - 1, Math.floor(r.count * 0.95))];
}

function fmt(ms: number) {
  return ms.toFixed(1).padStart(5);
}

/**
 * GPU timing, where the driver has it.
 *
 * A query can't be read back in the frame that issued it without stalling the
 * pipeline — which would defeat the measurement — so they go in a ring and are
 * collected a few frames later. `GPU_DISJOINT_EXT` means the driver preempted
 * something mid-query and every outstanding result is nonsense, so the whole
 * ring is dropped when it trips.
 */
function makeGpuTimer(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) return null;

  const pool: WebGLQuery[] = [];
  const pending: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;

  return {
    begin() {
      if (open) return;
      const q = pool.pop() ?? gl.createQuery();
      if (!q) return;
      open = q;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    },
    /** ms for whichever earlier frame has finished, or null */
    end(): number | null {
      if (open) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(open);
        open = null;
      }

      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        pool.push(...pending);
        pending.length = 0;
        return null;
      }

      const q = pending[0];
      if (!q) return null;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return null;

      pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      pool.push(q);
      return ns / 1e6;
    },
    dispose() {
      if (open) gl.endQuery(ext.TIME_ELAPSED_EXT);
      [...pool, ...pending].forEach((q) => gl.deleteQuery(q));
    },
  };
}

export default function Diagnostics() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const setDpr = useThree((s) => s.setDpr);
  const nativeDpr = useThree((s) => s.viewport.dpr);

  const state = useRef({
    frameStart: 0,
    lastStart: 0,
    longTasks: 0,
    longMs: 0,
    calls: 0,
    tris: 0,
    programs: 0,
    peakPrograms: 0,
    gpuOk: false,
    lowDpr: false,
    interval: ring(),
    js: ring(),
    gpu: ring(),
  }).current;

  const panel = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof makeGpuTimer>>(null);

  // ── the panel, and the counters that don't come from the frame loop ──────
  useEffect(() => {
    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed",
      "left:8px",
      "bottom:8px",
      "z-index:2147483647",
      "pointer-events:none",
      "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
      "white-space:pre",
      "color:#9effa8",
      "background:rgba(0,0,0,.82)",
      "border:1px solid rgba(158,255,168,.25)",
      "border-radius:4px",
      "padding:7px 9px",
    ].join(";");
    document.body.appendChild(el);
    panel.current = el;

    const sheet = document.createElement("style");
    sheet.textContent = DOM_OFF_RULE;
    document.head.appendChild(sheet);

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks++;
          state.longMs += entry.duration;
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Safari has no longtask observer; the bucket just stays at zero
    }

    return () => {
      observer?.disconnect();
      el.remove();
      sheet.remove();
      // the attribute outlives the sheet otherwise, and would hide every band
      // the moment the harness came back
      delete document.documentElement.dataset.diagDom;
      panel.current = null;
    };
  }, [state]);

  // ── the toggles ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;

      switch (e.key) {
        case "1": {
          const g = scene.getObjectByName("scene-hero");
          if (g) g.visible = !g.visible;
          break;
        }
        case "2": {
          const g = scene.getObjectByName("scene-about");
          if (g) g.visible = !g.visible;
          break;
        }
        case "3": {
          const root = document.documentElement;
          root.dataset.diagDom = root.dataset.diagDom === "off" ? "on" : "off";
          break;
        }
        case "4":
          setPostBypassed(!postBypassed());
          break;
        case "5":
          state.lowDpr = !state.lowDpr;
          setDpr(state.lowDpr ? 1 : nativeDpr);
          break;
        case "6":
          setSwayOn(!swayOn());
          break;
        case "0":
          state.longTasks = 0;
          state.longMs = 0;
          state.peakPrograms = 0;
          state.interval = ring();
          state.js = ring();
          state.gpu = ring();
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, setDpr, nativeDpr, state]);

  // ── per-frame counters ──────────────────────────────────────────────────
  useEffect(() => {
    const ctx = gl.getContext();
    timer.current =
      typeof WebGL2RenderingContext !== "undefined" &&
      ctx instanceof WebGL2RenderingContext
        ? makeGpuTimer(ctx)
        : null;
    state.gpuOk = !!timer.current;

    // One figure for the whole frame rather than for its last `render()`.
    // Deliberately reaching into the renderer: `info` is three's own mutable
    // counter block, not React state, and turning its self-reset off is the
    // only way to total a frame that renders several times.
    const info = gl.info;
    /* eslint-disable-next-line react-hooks/immutability */
    info.autoReset = false;

    return () => {
      timer.current?.dispose();
      timer.current = null;
      info.autoReset = true;
    };
  }, [gl, state]);

  // first in the frame — before every scene callback
  useFrame(() => {
    const now = performance.now();

    if (state.lastStart) push(state.interval, now - state.lastStart);
    state.lastStart = now;
    state.frameStart = now;

    gl.info.reset();
    timer.current?.begin();
  }, -1000);

  // last in the frame — after the composer has rendered
  useFrame(() => {
    // Nothing else will draw with the composer gone: a `useFrame` at any
    // priority but 0 turns R3F's own render off, and this file has two.
    if (postBypassed()) gl.render(scene, camera);

    push(state.js, performance.now() - state.frameStart);

    const gpuMs = timer.current?.end();
    if (gpuMs != null) push(state.gpu, gpuMs);

    state.calls = gl.info.render.calls;
    state.tris = gl.info.render.triangles;
    state.programs = gl.info.programs?.length ?? 0;
    if (state.programs > state.peakPrograms) {
      state.peakPrograms = state.programs;
    }
  }, 1000);

  // ── the readout ─────────────────────────────────────────────────────────
  useEffect(() => {
    const on = (v: boolean) => (v ? "on " : "OFF");

    const id = setInterval(() => {
      const el = panel.current;
      if (!el) return;

      const interval = mean(state.interval);
      const fps = interval > 0 ? 1000 / interval : 0;
      const js = mean(state.js);
      const other = Math.max(0, interval - js);
      // same unit the rig reads, so the readout can be trusted on iOS too
      const vh = pxToVh(window.scrollY);

      const gpuLine = state.gpuOk
        ? `gpu    ${fmt(mean(state.gpu))}  p95 ${fmt(p95(state.gpu))}`
        : "gpu        —  (no timer ext)";

      const domOn = document.documentElement.dataset.diagDom !== "off";
      const hero = scene.getObjectByName("scene-hero")?.visible ?? true;
      const about = scene.getObjectByName("scene-about")?.visible ?? true;

      el.textContent = [
        `fps  ${fps.toFixed(1).padStart(6)}`,
        `frame  ${fmt(interval)}  p95 ${fmt(p95(state.interval))}`,
        `js     ${fmt(js)}  p95 ${fmt(p95(state.js))}`,
        gpuLine,
        `other  ${fmt(other)}`,
        `long   ${String(state.longTasks).padStart(5)}  ${state.longMs.toFixed(0)}ms`,
        `calls  ${String(state.calls).padStart(5)}  tris ${(state.tris / 1e6).toFixed(2)}M`,
        `progs  ${String(state.programs).padStart(5)}  peak ${state.peakPrograms}`,
        `scroll ${vh.toFixed(0).padStart(5)}vh  (115-250 = move)`,
        "",
        `1 hero ${on(hero)}  2 about ${on(about)}`,
        `3 dom  ${on(domOn)}  4 post ${on(!postBypassed())}`,
        `5 dpr ${state.lowDpr ? "1.0" : nativeDpr.toFixed(1)}  6 sway ${on(swayOn())}`,
        "0 reset",
      ].join("\n");
    }, PANEL_INTERVAL);

    return () => clearInterval(id);
  }, [state, scene, nativeDpr]);

  return null;
}
