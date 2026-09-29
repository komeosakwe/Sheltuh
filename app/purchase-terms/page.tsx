import type { Metadata } from "next";
import Link from "next/link";
import ContentPage, { ContentSection } from "@/components/ContentPage";

export const metadata: Metadata = { title: "Purchase Terms — Sheltüh" };

export default function PurchaseTermsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Purchase Terms"
      intro="What you’re agreeing to when you buy a ticket."
      draft
    >
      <ContentSection title="The price">
        <p>
          The total shown at checkout includes the ticket price and any booking fee. The booking fee
          is 4% of the ticket price plus A$0.50 per paid ticket, and is paid by either the buyer or
          the organiser as shown on the event. Free tickets carry no fee. All prices are in
          Australian dollars.
        </p>
      </ContentSection>
      <ContentSection title="Your order">
        <p>
          Paid orders are processed by Stripe. Your tickets are emailed to the address you provide
          once payment is confirmed. Free tickets are issued immediately.
        </p>
      </ContentSection>
      <ContentSection title="Sold-out and unavailable tickets">
        <p>
          If tickets sell out, or an event is taken down, while your payment is being processed, your
          order won’t be fulfilled and you’ll be refunded in full.
        </p>
      </ContentSection>
      <ContentSection title="Refunds">
        <p>
          See <Link href="/refunds">Request a refund</Link>. Nothing here limits your rights under
          the Australian Consumer Law.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
