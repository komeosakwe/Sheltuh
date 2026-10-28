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
    >
      <ContentSection title="What you get">
        <ul>
          <li>Ticketing with payouts to your own Stripe account.</li>
          <li>Free events listed for free.</li>
          <li>Booking fee: {describeBookingFee()}. You or your buyer can cover it.</li>
          <li>Every organiser checked by a person.</li>
        </ul>
        <div className="mt-6">
          <ButtonLink href="/organisers/apply">Apply as an organiser</ButtonLink>
        </div>
      </ContentSection>
    </ContentPage>
  );
}
