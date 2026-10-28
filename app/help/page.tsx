import type { Metadata } from "next";
import Link from "next/link";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { describeBookingFee } from "@/lib/fees";

export const metadata: Metadata = { title: "Help & FAQs — Sheltüh" };

export default function HelpPage() {
  return (
    <ContentPage
      eyebrow="Fan support"
      title="Help & FAQs"
    >
      <ContentSection title="How do I buy tickets?">
        <p>
          Open an event, pick your tickets and check out. Cards are handled by Stripe and never
          reach Sheltüh. Free tickets need no payment.
        </p>
      </ContentSection>
      <ContentSection title="Where are my tickets?">
        <p>
          They’re emailed to the address you used at checkout. Check spam, then email{" "}
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a> with the event name.
        </p>
      </ContentSection>
      <ContentSection title="What is the booking fee?">
        <p>
          {describeBookingFee()}. Free tickets carry none. The total is shown before you check out.
        </p>
      </ContentSection>
      <ContentSection title="What if I need a refund?">
        <p>
          See <Link href="/refunds">Request a refund</Link>. Orders we can’t fulfil are refunded
          automatically.
        </p>
      </ContentSection>
      <ContentSection title="How do I list an event?">
        <p>
          <Link href="/organisers/apply">Apply as an organiser</Link>. Once approved, you can
          publish events. Paid tickets need a Stripe account for payouts.
        </p>
      </ContentSection>
      <ContentSection title="How do I report an event?">
        <p>
          Use Report this event at the bottom of its page, or email{" "}
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a>.
        </p>
      </ContentSection>
      <ContentSection title="Still stuck?">
        <p>
          Email <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
