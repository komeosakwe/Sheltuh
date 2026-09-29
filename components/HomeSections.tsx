import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { Burst } from "@/components/ui/Sticker";

const REASONS = [
  { label: "Every event reviewed by a person", note: "Curated, not scraped." },
  { label: "The price you see is the price you pay", note: "Booking fees shown up front." },
  { label: "Free events stay free", note: "No fee on free tickets." },
];

/** "What else?" — a poster panel beside a hover-highlighted typographic list. */
export function WhatElse() {
  return (
    <section
      aria-labelledby="what-else"
      className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12"
    >
      <div aria-hidden="true" className="lg:col-span-5">
        <EventArt
          poster={{ pattern: "rings", background: "#0b0b0b", primary: "#f3f0e8", secondary: "#e8ff3a" }}
          title="Sheltüh"
          className="aspect-[4/5] w-full"
        />
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <h2 id="what-else" className="display-md mb-8">
          What else?
        </h2>
        <ul className="group/list flex flex-col gap-3">
          {REASONS.map((reason) => (
            <li
              key={reason.label}
              className="transition-opacity group-hover/list:opacity-35 hover:opacity-100! focus-within:opacity-100!"
            >
              <p className="text-2xl font-medium leading-snug sm:text-3xl">{reason.label}</p>
              <p className="text-sm text-muted">{reason.note}</p>
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
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <h2 id="partners" className="display-lg">
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
          className="display-md flex flex-wrap items-center gap-x-5 gap-y-3 text-background/90 lg:col-span-5 lg:col-start-8"
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
