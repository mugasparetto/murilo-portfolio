"use client";

import type { CSSProperties, ReactNode } from "react";
import { asImageWidthSrcSet, asLink, isFilled } from "@prismicio/client";
import { PrismicNextLink } from "@prismicio/next";
import type { Content } from "@prismicio/client";

import { publishCardSlot } from "./cardSlots";

/**
 * The cards themselves: markup, laid over the canvas and moved by the frame
 * loop.
 *
 * DOM rather than geometry because of what is *in* them — links the browser
 * treats as links, a thumbnail it decodes and caches on its own, and type that
 * is still type at every distance the flight passes them at. A texture would be
 * none of those things, and drei's <Html> is this same idea with a per-card
 * wrapper and its own occlusion pass that neither of them needs here.
 *
 * Nothing about their position or size is written in React. They start hidden
 * and <TunnelCards /> — which is inside the <Canvas /> and can see the camera —
 * writes `width`, `height`, `transform`, `opacity` and `display` straight onto
 * them. The size is the one the card lands at on this screen (see ./cardFit),
 * which is why everything inside is measured against the card rather than the
 * viewport: the card is a size container, and its type and spacing are `cqw`
 * clamped to sensible ends.
 *
 * The host's box is the *canvas's* box and not the viewport's, deliberately:
 * `100vh` and `innerHeight` are an address bar apart on iOS, and the cards are
 * placed by projecting against a camera whose aspect came from the canvas. Two
 * different boxes would put the card a bar's height off its own beams for as
 * long as the bar was out.
 *
 * ── The look ──────────────────────────────────────────────────────────────
 *
 * The About section's skill card, with the work in it: a black plate with a
 * 2px white edge, a numbered header in the section's muted caps, and the title
 * in the display face. The thumbnail is set in greyscale where there is a
 * pointer to bring it into colour; on a touch screen it is in colour from the
 * start. The two actions are the nav's: a white square for the main one, an
 * outlined one beside it, each with the hero CTA's fly-through arrow. See
 * globals.css, under `work-card`.
 */

type WorkItem = Content.WorksSliceDefaultPrimaryWorksItem;

export type WorksCardsProps = {
  works: WorkItem[];
};

/** the linked work's own fields, once Prismic has filled the link in */
function workData(item: WorkItem) {
  const link = item.works;

  return link && "data" in link
    ? (link.data as Partial<Content.WorkDocumentData> | undefined)
    : undefined;
}

/**
 * The works that actually point at something: an entry whose link was never
 * set, or whose document has since been unpublished, would otherwise be a card
 * called "Untitled" that goes nowhere. The tunnel is built for this many.
 */
export function linkedWorks(items: WorkItem[]) {
  return items.filter(
    (item) => isFilled.contentRelationship(item.works) && !item.works.isBroken,
  );
}

/** what a card is called, on the card and wherever else it is named */
export function workTitle(item: WorkItem) {
  return workData(item)?.title ?? "Untitled";
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The card's own scale, as custom properties for what is inside it.
 *
 * In `cqw`, so read against the card. That is only true *inside* it: a
 * container's units resolve against the container above it, so these are set
 * here and used only by the card's children. `display: none` rides along
 * because the driver toggles it, and it has to start hidden.
 */
const CARD_STYLE = {
  display: "none",
  "--pad": "clamp(0.75rem, 3.4cqw, 1.5rem)",
  "--meta": "clamp(0.625rem, 1.9cqw, 0.875rem)",
  "--title": "clamp(1.125rem, 4.4cqw, 2.25rem)",
  "--btn": "clamp(2.5rem, 7.5cqw, 3rem)",
} as CSSProperties;

/**
 * About the width the card lands at, for the thumbnail's `srcset`: half the
 * screen's height at 1.36:1 on a landscape screen, square on a portrait one,
 * inside the page margins. See ./cardFit for the exact rule.
 */
const THUMB_SIZES =
  "(orientation: portrait) min(90vw, 50vh), min(840px, 95vw, 68vh)";

/** the arrows are drawn square-ended, like the nav's hamburger bars */
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      className={className}
    >
      <path d="M4 12H19" />
      <path d="M13.5 6.5L19 12L13.5 17.5" />
    </svg>
  );
}

function ArrowUpRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      className={className}
    >
      <path d="M6 18L17 7" />
      <path d="M8.5 6H18V15.5" />
    </svg>
  );
}

/**
 * An arrow and its copy, stacked, so a hover can send one out the way it
 * points and bring the other in behind it. `dir` is that way, in screen axes.
 */
function Fly({
  dir,
  icon: Icon,
}: {
  dir: [number, number];
  icon: (props: { className?: string }) => ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="grid size-[42%] *:col-start-1 *:row-start-1"
      style={{ "--fly-x": dir[0], "--fly-y": dir[1] } as CSSProperties}
    >
      <Icon className="fly-lead size-full" />
      <Icon className="fly-copy size-full" />
    </span>
  );
}

/** the square both actions are cut from */
const ACTION =
  "fly-button peer grid size-(--btn) place-items-center overflow-hidden rounded-sm outline-white focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * An action and the caption that names it on hover or focus. The icon is the
 * whole of the button, so the caption is for the pointer; a screen reader has
 * the link's own label.
 */
function Action({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-full mb-2 translate-y-1 rounded-xs bg-white px-2 py-1.5 text-[length:var(--meta)] leading-none tracking-[0.15em] whitespace-nowrap text-black uppercase opacity-0 transition-[opacity,translate] duration-300 ease-out peer-hover:translate-y-0 peer-hover:opacity-100 peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100 motion-reduce:translate-y-0"
      >
        {hint}
      </span>
    </div>
  );
}

export default function WorksCards({ works }: WorksCardsProps) {
  return (
    <div className="pointer-events-none fixed inset-0 z-10 h-screen w-full overflow-hidden">
      {works.map((item, i) => {
        const link = item.works;
        const data = workData(item);

        const title = workTitle(item);
        const year = data?.year ?? "";
        const thumb =
          data?.thumbnail && isFilled.image(data.thumbnail)
            ? asImageWidthSrcSet(data.thumbnail, {
                widths: [480, 720, 960, 1280, 1680],
              })
            : null;
        const live =
          data?.live_url && isFilled.link(data.live_url)
            ? asLink(data.live_url)
            : null;

        return (
          <article
            key={i}
            ref={(el) => {
              publishCardSlot(i, el);
              return () => publishCardSlot(i, null);
            }}
            style={CARD_STYLE}
            className="work-card @container pointer-events-auto absolute top-0 left-0 origin-top-left flex-col overflow-hidden rounded-sm border-2 border-white bg-black will-change-transform"
          >
            <div className="flex shrink-0 items-center justify-between px-(--pad) py-[calc(var(--pad)*0.55)] text-[length:var(--meta)] leading-[1.46] tracking-[0.1em] text-white/72 uppercase tabular-nums">
              <span>{pad(i + 1)}/</span>
              {year && <span>{year}</span>}
            </div>

            {/* The thumbnail opens the work too: the biggest target on the
                card. Out of the tab order and hidden from assistive tech, since
                the button below is the same link with a name. */}
            <PrismicNextLink
              field={link}
              tabIndex={-1}
              aria-hidden
              className="relative block min-h-0 flex-1 overflow-hidden bg-white/5"
            >
              {thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb.src}
                  srcSet={thumb.srcset}
                  sizes={THUMB_SIZES}
                  alt=""
                  className="work-thumb absolute inset-0 size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )}
            </PrismicNextLink>

            <div className="flex shrink-0 items-end justify-between gap-(--pad) p-(--pad)">
              <h3 className="line-clamp-2 min-w-0 font-display text-[length:var(--title)] leading-[1.1] font-extrabold text-white uppercase [overflow-wrap:anywhere]">
                {title}
              </h3>

              <div className="flex shrink-0 gap-2">
                <Action hint="View project">
                  <PrismicNextLink
                    field={link}
                    aria-label={`View project: ${title}`}
                    className={`${ACTION} bg-white text-black`}
                  >
                    <Fly dir={[1, 0]} icon={ArrowRight} />
                  </PrismicNextLink>
                </Action>

                {live && (
                  <Action hint="Live site">
                    <a
                      href={live}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Visit the live site: ${title} (opens in a new tab)`}
                      className={`${ACTION} border border-white text-white transition-colors duration-300 hover:bg-white hover:text-black`}
                    >
                      <Fly dir={[1, -1]} icon={ArrowUpRight} />
                    </a>
                  </Action>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
