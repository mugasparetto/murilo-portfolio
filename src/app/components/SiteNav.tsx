"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { blockInset } from "@/slices/Hero/scene/Name";

/**
 * Targets are placeholders: no slice renders an `id` yet, so these scroll
 * nowhere until the sections carry one.
 */
const LINKS = [
  { label: "About", href: "#about" },
  { label: "Works", href: "#work" },
  { label: "Contact", href: "#contact" },
];

export default function SiteNav() {
  // Below md the bar is a 40px hamburger anchored bottom-left; `open` grows it
  // up and to the right into the stacked menu. Every rule driven by this state
  // is `max-md:`-scoped, so the desktop bar never reads it.
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // The panel floats over the canvas with no backdrop to click away on, so
    // dismissal listens for the tap instead — the only gesture a phone has.
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className={`pointer-events-none text-center fixed bottom-(--block-inset) md:bottom-6 left-(--block-inset) z-50 flex w-10 flex-col items-start rounded-sm border border-white bg-black transition-[width] duration-300 ease-out max-md:overflow-hidden md:left-1/2 md:w-auto md:-translate-x-1/2 md:flex-row md:items-center md:px-4 md:py-2 ${open ? "max-md:pointer-events-auto max-md:w-40" : ""}`}
      style={blockInset}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-nav-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        // 38px, not 40: the 1px border on either side makes up the difference,
        // so the collapsed bar stays the square it was.
        className="pointer-events-auto order-1 grid size-9.5 shrink-0 place-items-center focus-visible:outline-2 focus-visible:-outline-offset-4 md:hidden"
      >
        {/* Three 2px rules at y = 0 / 5 / 10; opening slides the outer two onto
            the middle and crosses them, so the whole morph is transform-only. */}
        <span aria-hidden className="relative block h-3 w-3.5">
          <span
            className={`absolute left-0 top-0 h-0.5 w-full bg-white transition-transform duration-300 ease-out ${open ? "translate-y-1.25 rotate-45" : ""}`}
          />
          <span
            className={`absolute left-0 top-1.25 h-0.5 w-full bg-white transition-opacity duration-200 ease-out ${open ? "opacity-0" : ""}`}
          />
          <span
            className={`absolute bottom-0 left-0 h-0.5 w-full bg-white transition-transform duration-300 ease-out ${open ? "-translate-y-1.25 -rotate-45" : ""}`}
          />
        </span>
      </button>

      {/* 0fr -> 1fr animates the height the way `auto` can't, and `visibility`
          rides the same transition so the collapsed links leave the tab order
          without cutting the closing animation short. Both wrappers go
          `contents` at md, handing M. and the list back to the nav's flex row
          exactly as they sat before. */}
      <div
        id="site-nav-menu"
        className={`grid w-full transition-[grid-template-rows,visibility] duration-300 ease-out md:contents ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr] max-md:invisible"}`}
      >
        {/* The collapsing row itself carries no padding: under border-box a
            `height: 0` row still stands its padding tall, so the closed bar
            would come out 24px short of square. The inset lives on the two
            children instead, where the clip swallows it. */}
        <div className="min-h-0 overflow-hidden md:contents">
          <Link
            href="#"
            onClick={() => setOpen(false)}
            className="pointer-events-auto mb-3 block font-display text-2xl max-md:px-3 max-md:pt-3 md:mb-0 md:mr-8 md:inline"
          >
            M.
          </Link>

          <ul className="pointer-events-auto relative flex flex-col gap-3 text-xs uppercase tracking-[0.15em] max-md:px-3 max-md:pb-3 md:h-full md:flex-row md:items-center md:gap-6 md:text-sm md:tracking-[0.2em]">
            {LINKS.map(({ label, href }) => (
              <li key={label}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`group block whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 md:inline ${label === "Contact" ? "rounded-xs bg-white px-4 py-2 text-black max-md:w-full max-md:text-center" : "py-1 text-white/70 md:py-0"}`}
                >
                  {/* Two stacked copies: the first slides out the bottom while the
                      second drops in from the top, so the label reads as a roll. */}
                  <span className="relative inline-block overflow-hidden align-middle">
                    <span className="block transition-transform duration-300 ease-out group-hover:translate-y-full group-focus-visible:translate-y-full">
                      {label}
                    </span>
                    <span
                      aria-hidden
                      className={`absolute inset-0 block -translate-y-full transition-transform duration-300 ease-out group-hover:translate-y-0 group-focus-visible:translate-y-0 ${label === "Contact" ? "" : "text-white"}`}
                    >
                      {label}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
