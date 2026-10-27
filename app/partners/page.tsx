import type { Metadata, ResolvingMetadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { ButtonLink } from "@/components/ui/Button";
import { describeBookingFee } from "@/lib/fees";
import { inheritedShareImages, pageShareMetadata, siteOrigin } from "@/lib/share-metadata";

/** Title, canonical URL and link preview: this page is the one shared with venues and promoters. */
export async function generateMetadata(_props: PageProps<"/partners">, parent: ResolvingMetadata): Promise<Metadata> {
  return pageShareMetadata(
    {
      title: "Become a partner — Sheltüh",
      description:
        "List your events on Sheltüh: organisers checked by a person, ticketing with payouts to your own Stripe account, and free events listed for free.",
      path: "/partners",
    },
    siteOrigin(),
    await inheritedShareImages(parent),
  );
}

export default function PartnersPage() {
  return (
    <ContentPage
      eyebrow="Partners"
      title="A network of rooms and promoters"
      intro="We’re building a network of venues, promoters and makers across Australia. If you run rooms, nights or workshops, we’d like to list you."
    >
      <ContentSection title="What you get">
        <ul>
          <li>Your events in front of people looking for what’s on near them.</li>
          <li>Ticketing with payouts to your own Stripe account.</li>
          <li>Free events listed for free.</li>
          <li>A booking fee of {describeBookingFee()}, which you or your buyer can cover.</li>
        </ul>
      </ContentSection>
      <ContentSection title="How it works">
        <ul>
          <li>Apply as an organiser. Every organiser is checked by a person before they can publish.</li>
          <li>Create your event with photos and ticket types, then publish it. We review events that are reported.</li>
          <li>Connect Stripe when you’re ready to sell paid tickets.</li>
        </ul>
        <div className="mt-6">
          <ButtonLink href="/organisers/apply">Apply as an organiser</ButtonLink>
        </div>
      </ContentSection>
    </ContentPage>
  );
}
