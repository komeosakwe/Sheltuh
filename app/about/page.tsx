import type { Metadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = { title: "About — Sheltüh" };

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow="About"
      title="A guide to Australia’s creative rooms"
    >
      <ContentSection title="Why we exist">
        <p>Good nights get found too late, and it’s hard to go alone. Sheltüh puts what’s on and who’s going in one place.</p>
      </ContentSection>
      <ContentSection title="Curated, not scraped">
        <p>Every organiser is checked by a person before they can publish.</p>
      </ContentSection>
      <ContentSection title="Honest prices">
        <p>The price you see is what you pay. Free events stay free.</p>
      </ContentSection>
      <ContentSection title="Have something on?">
        <div>
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
