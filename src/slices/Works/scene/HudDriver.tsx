"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { flight } from "./flight";
import {
  HUD_SUBMERGED,
  hudElements,
  hudLayout,
  railAt,
  useHud,
} from "./hud";

/**
 * Drives <WorksHud /> from the flight.
 *
 * Lives in the canvas for <TunnelCards />'s reason — the flight is only known
 * inside a `useFrame` — and runs at the same 0.6, after <Scene /> has written
 * this frame's flight at 0.5. See ./hud for why whether it shows and the count
 * go through React state while everything else doesn't.
 *
 * The row's arrival is one number on the stage, and the markup's CSS does the
 * rest:
 *
 *   --hud-c  0..1, how far the corner row has drawn in
 */
export default function HudDriver({ count }: { count: number }) {
  /** what was last written, so an idle frame writes nothing */
  const written = useRef<{
    v: number;
    t: number;
    stage: HTMLElement | null;
    fill: HTMLElement | null;
  }>({ v: NaN, t: -1, stage: null, fill: null });

  useFrame(() => {
    const L = hudLayout(count);

    // vh of scroll since the HUD appeared: negative above it
    const v = (flight.progress - L.revealT) * L.flightVh;

    // off above the curl, and off again once the water has closed over — the
    // wash takes the whole frame there and the HUD would be floating on it
    const on = flight.active && v >= 0 && flight.submersion < HUD_SUBMERGED;

    let index = 0;
    for (let i = 0; i < L.reachS.length; i++) {
      if (flight.s >= L.reachS[i]) index = i + 1;
    }

    const state = useHud.getState();
    if (state.on !== on || state.index !== index) {
      useHud.setState({ on, index });
    }

    if (!on) return;

    const { stage, fill, cursor } = hudElements();
    const last = written.current;

    // A freshly mounted element has to be written once whether or not the
    // scroll moved, or a reload mid-section would sit at the start until it
    // did — hence the element checks alongside the values.

    // Held at the end of the choreography rather than counting on through the
    // rest of the flight: past there nothing reads it, and a custom property
    // written every frame restyles everything under it for nothing.
    const held = Math.min(v, L.cornerToV + 1);

    if (Math.abs(held - last.v) >= 0.01 || stage !== last.stage) {
      last.v = held;
      last.stage = stage;

      if (stage) {
        const c = (held - L.cornerFromV) / (L.cornerToV - L.cornerFromV);

        stage.style.setProperty(
          "--hud-c",
          Math.min(1, Math.max(0, c)).toFixed(4),
        );
      }
    }

    const t = flight.progress;

    if (Math.abs(t - last.t) >= 1e-4 || fill !== last.fill) {
      last.t = t;
      last.fill = fill;

      // not the progress itself: the rail is a timeline of the cards, with
      // their ticks evenly spaced — see ./hud
      const x = railAt(L, t);

      if (fill) fill.style.transform = `scaleX(${x.toFixed(4)})`;
      if (cursor) {
        cursor.style.transform = `translateX(${(x * 100).toFixed(2)}%)`;
      }
    }
  }, 0.6);

  return null;
}
