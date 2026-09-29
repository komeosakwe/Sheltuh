import type { Metadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Become a partner — Sheltüh" };

export default function PartnersPage() {
  return (
    <ContentPage
      eyebrow="Partners"
      title="A network of rooms and promoters"
      intro="We’re building a network of Melbourne venues, promoters and makers. If you run rooms, nights or workshops, we’d like to list you."
    >
      <ContentSection title="What you get">
        <ul>
          <li>Your events in front of people looking for what’s on in Melbourne.</li>
          <li>Ticketing with payouts to your own Stripe account.</li>
          <li>Free events listed for free.</li>
          <li>A booking fee of 4% + A$0.50 per paid ticket, which you or your buyer can cover.</li>
        </ul>
      </ContentSection>
      <ContentSection title="How it works">
        <ul>
          <li>Apply as an organiser. We review every application.</li>
          <li>Create your event with photos and ticket types. We review it before it goes live.</li>
          <li>Connect Stripe when you’re ready to sell paid tickets.</li>
        </ul>
        <div className="mt-6">
          <ButtonLink href="/organisers/apply">Apply as an organiser</ButtonLink>
        </div>
      </ContentSection>
    </ContentPage>
  );
}
