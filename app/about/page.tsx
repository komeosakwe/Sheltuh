import type { Metadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = { title: "About — Sheltüh" };

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow="About"
      title="A guide to Australia’s creative rooms"
      intro="Sheltüh is a curated guide to live music, art, workshops, pop-ups and theatre across Australia — with tickets."
    >
      <ContentSection title="Why we exist">
        <p>
          Too many good nights are found too late, on someone’s Instagram Story the day after. And
          it’s hard to go to something new when you don’t know anyone who’s going. Sheltüh is built
          to fix both: one place to find what’s on, made for the people who make and go to it.
        </p>
      </ContentSection>
      <ContentSection title="Curated, not scraped">
        <p>
          Every organiser is approved before they can list, and every event is reviewed by a person
          before it goes live. We’d rather show fewer, better events than everything.
        </p>
      </ContentSection>
      <ContentSection title="Honest prices">
        <p>
          The price you see is what you pay. Booking fees are shown up front, and free events stay
          free.
        </p>
      </ContentSection>
      <ContentSection title="Have something on?">
        <p>Organisers, venues and promoters are welcome to apply.</p>
        <div className="mt-5">
          <ButtonLink href="/partners">Become a partner</ButtonLink>
        </div>
      </ContentSection>
      <ContentSection title="Credits">
        <p>
          Suburb centres derived from Australian Bureau of Statistics,{" "}
          <a href="https://data.gov.au/data/dataset/9c172870-f5e5-4d5b-82bf-51488ed6baf3">
            ASGS Edition 4 (2026) Suburbs and Localities
          </a>
          , licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. We changed
          the data: each suburb is reduced to one centre point, a few centres are moved, and water-only
          localities are left out.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
