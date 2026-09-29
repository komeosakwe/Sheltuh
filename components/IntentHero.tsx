"use client";

import { useState } from "react";
import EventArt from "@/components/EventArt";
import { ButtonLink } from "@/components/ui/Button";
import { Burst, Marquee, RoundBadge } from "@/components/ui/Sticker";

type Intent = "discover" | "connect" | "make";

const INTENTS: { id: Intent; label: string; blurb: string }[] = [
  { id: "discover", label: "I want to discover", blurb: "Something new tonight." },
  { id: "connect", label: "I want to connect", blurb: "With creative people." },
  { id: "make", label: "I want to make", blurb: "Or share an event." },
];

// Decorative hero artwork, drawn with the same local poster renderer as events.
const HERO_POSTERS = [
  { pattern: "burst", background: "#0b0b0b", primary: "#ff3d2e", secondary: "#f3f0e8" },
  { pattern: "halftone", background: "#e8ff3a", primary: "#0b0b0b", secondary: "#0b0b0b" },
  { pattern: "waves", background: "#2b3cff", primary: "#f3f0e8", secondary: "#ffb3d1" },
] as const;

export default function IntentHero() {
  const [intent, setIntent] = useState<Intent>("discover");
  const active = INTENTS.find((option) => option.id === intent) ?? INTENTS[0];

  return (
    <>
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-14 lg:grid-cols-12">
        <div className="flex flex-col justify-between gap-10 lg:col-span-7">
          <p className="eyebrow text-muted">Melbourne &middot; Naarm</p>
          <h1 className="display-xl">
            Find your room.
            <br />
            Find your people.
          </h1>
          <div className="flex flex-col gap-6">
            <div role="radiogroup" aria-label="What are you here for?" className="flex flex-wrap gap-2">
              {INTENTS.map((option) => {
                const selected = intent === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setIntent(option.id)}
                    className={`rounded-full border border-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                      selected ? "bg-foreground text-background" : "hover:bg-foreground/10"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="max-w-sm text-base leading-relaxed text-muted">
              {active.blurb} Sheltüh surfaces the rooms, nights and events that fit.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="#feed">See what&rsquo;s on</ButtonLink>
              <ButtonLink href="/organisers/apply" variant="outline">
                Have something on?
              </ButtonLink>
            </div>
          </div>
        </div>

        {/* Asymmetric poster collage: tall lead image, offset supporting tiles. */}
        <div aria-hidden="true" className="relative hidden min-h-[520px] lg:col-span-5 lg:block">
          <EventArt poster={HERO_POSTERS[0]} title="Sheltüh" className="absolute right-0 top-0 h-[430px] w-[78%]" />
          <EventArt poster={HERO_POSTERS[1]} title="Sheltüh" className="absolute bottom-0 left-0 h-[220px] w-[46%]" />
          <EventArt poster={HERO_POSTERS[2]} title="Sheltüh" className="absolute bottom-6 right-0 h-[150px] w-[38%]" />
          <RoundBadge className="absolute left-2 top-16 h-28 w-28 text-foreground" />
          <Burst className="absolute right-[-8px] top-[-14px] h-10 w-10 text-foreground" />
        </div>
      </section>

      <Marquee items={["Live music", "Art", "Workshops", "Pop-ups", "Theatre", "Melbourne"]} />
    </>
  );
}
