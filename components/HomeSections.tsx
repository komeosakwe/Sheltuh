"use client";

import { useState } from "react";
import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { Burst } from "@/components/ui/Sticker";

const REASONS = [
  {
    label: "Every event reviewed by a person",
    note: "Curated, not scraped.",
    poster: { pattern: "rings", background: "#0b0b0b", primary: "#f3f0e8", secondary: "#e8ff3a" },
  },
  {
    label: "The price you see is the price you pay",
    note: "Booking fees shown up front.",
    poster: { pattern: "halftone", background: "#e8ff3a", primary: "#0b0b0b", secondary: "#0b0b0b" },
  },
  {
    label: "Free events stay free",
    note: "No fee on free tickets.",
    poster: { pattern: "waves", background: "#2b3cff", primary: "#f3f0e8", secondary: "#ffb3d1" },
  },
] as const;

/**
 * "What else?" — a typographic list beside a poster panel. Pointing at (or
 * tapping) a line highlights it and cross-fades the poster to that line's own.
 */
export function WhatElse() {
  const [active, setActive] = useState(0);

  return (
    <section
      aria-labelledby="what-else"
      className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-5 py-12 sm:gap-12 sm:px-8 sm:py-24 lg:grid-cols-12"
    >
      {/* Decorative panel: desktop only, it cost a full phone screen before the list. */}
      <div aria-hidden="true" className="relative hidden aspect-[4/5] lg:col-span-5 lg:block">
        {REASONS.map((reason, index) => (
          <div
            key={reason.label}
            className={`absolute inset-0 motion-safe:transition-opacity motion-safe:duration-500 ${
              index === active ? "opacity-100" : "opacity-0"
            }`}
          >
            <EventArt poster={reason.poster} title="Sheltüh" className="h-full w-full" />
          </div>
        ))}
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <h2 id="what-else" className="display-md reveal mb-8">
          What else?
        </h2>
        <ul className="reveal flex flex-col gap-6">
          {REASONS.map((reason, index) => (
            <li
              key={reason.label}
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive(index)}
              className={`cursor-default transition-opacity duration-300 ${
                index === active ? "opacity-100" : "opacity-35"
              }`}
            >
              <p className="font-heading text-3xl uppercase leading-[0.95] tracking-tight sm:text-4xl">
                {reason.label}
              </p>
              <p className="mt-2 text-sm text-muted">{reason.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Partner band: a black block with the invitation and a pill CTA. */
export function PartnerBand() {
  return (
    <section aria-labelledby="partners" className="bg-foreground text-background">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 py-12 sm:px-8 sm:py-24 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <h2 id="partners" className="display-lg reveal">
            A network of rooms and promoters
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-background/70">
            We’re building a network of Melbourne venues, promoters and makers who keep live culture
            thriving. Run a room or a night? List it with us.
          </p>
          <div className="mt-8">
            <ButtonLink href="/partners" variant="light">
              Become a partner
            </ButtonLink>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="display-md hidden flex-wrap items-center gap-x-5 gap-y-3 text-background/90 lg:col-span-5 lg:col-start-8 lg:flex"
        >
          {["Live music", "Art", "Workshops", "Pop-ups", "Theatre"].map((word) => (
            <span key={word} className="flex items-center gap-5">
              {word}
              <Burst className="h-4 w-4 text-highlight" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
