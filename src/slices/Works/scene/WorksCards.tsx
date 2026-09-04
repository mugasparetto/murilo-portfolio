"use client";

import { useEffect } from "react";
import { asImageSrc } from "@prismicio/client";
import { PrismicNextLink } from "@prismicio/next";
import type { Content } from "@prismicio/client";

import { TUNNEL } from "../scene-core/presets";
import { publishCardCount, publishCardSlot } from "./cardSlots";

/**
 * The cards themselves: markup, laid over the canvas and moved by the frame
 * loop.
 *
 * DOM rather than geometry because of what is *in* them — a link the browser
 * treats as a link, a thumbnail it decodes and caches on its own, and type that
 * is still type at every distance the flight passes them at. A texture would be
 * none of those things, and drei's <Html> is this same idea with a per-card
 * wrapper and its own occlusion pass that neither of them needs here.
 *
 * Nothing about their position is written in React. They start hidden and
 * <TunnelCards /> — which is inside the <Canvas /> and can see the camera —
 * writes `transform`, `opacity` and `display` straight onto them once a frame.
 * See ./cardSlots, which is the handle between the two.
 *
 * The host's box is the *canvas's* box and not the viewport's, deliberately:
 * `100vh` and `innerHeight` are an address bar apart on iOS, and the cards are
 * placed by projecting against a camera whose aspect came from the canvas. Two
 * different boxes would put the card a bar's height off its own beams for as
 * long as the bar was out.
 */

export type WorksCardsProps = {
  works: Content.WorksSliceDefaultPrimaryWorksItem[];
};

export default function WorksCards({ works }: WorksCardsProps) {
  // How many slots the tunnel should light. Written once here rather than
  // derived inside the frame loop, which has no idea what Prismic returned.
  useEffect(() => {
    publishCardCount(works.length);
    return () => publishCardCount(0);
  }, [works.length]);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 h-screen w-full overflow-hidden">
      {works.map((item, i) => {
        const link = item.works;
        const data =
          link && "data" in link
            ? (link.data as Partial<Content.WorkDocumentData> | undefined)
            : undefined;

        const title = data?.title ?? "Untitled";
        const year = data?.year ?? "";
        const thumb = data?.thumbnail
          ? asImageSrc(data.thumbnail, { w: 720 })
          : null;

        return (
          <article
            key={i}
            ref={(el) => {
              publishCardSlot(i, el);
              return () => publishCardSlot(i, null);
            }}
            // `display` is toggled by the driver; starting hidden keeps the
            // cards out of the way for the frames before it has run
            style={{
              display: "none",
              width: TUNNEL.cardW,
              height: TUNNEL.cardH,
            }}
            className="pointer-events-auto absolute top-0 left-0 origin-top-left flex-col justify-between overflow-hidden bg-[rgba(4,9,18,0.88)] p-4 will-change-transform"
          >
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-45"
                loading="lazy"
                decoding="async"
              />
            )}

            {/* a scrim, so the type holds whatever the thumbnail is doing */}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(4,9,18,0.95)] via-[rgba(4,9,18,0.6)] to-[rgba(4,9,18,0.25)]" />

            <div className="relative">
              <div className="text-[12px] tracking-[0.04em] text-[#7fe3ff]">
                {year}
              </div>
              <h3 className="mt-1 text-[22px] leading-[1.1] font-normal text-[#eef6ff]">
                {title}
              </h3>
            </div>

            <PrismicNextLink
              field={link}
              className="relative self-start border border-[rgba(127,229,255,0.4)] px-3 py-1.5 text-[12px] text-[#b8c6d6] transition-colors hover:border-[#7fe3ff] hover:text-white"
            >
              Open case study
            </PrismicNextLink>
          </article>
        );
      })}
    </div>
  );
}
