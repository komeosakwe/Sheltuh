import type { Metadata } from "next";
import Link from "next/link";
import ContentPage, { ContentSection } from "@/components/ContentPage";

export const metadata: Metadata = { title: "Help & FAQs — Sheltüh" };

export default function HelpPage() {
  return (
    <ContentPage
      eyebrow="Fan support"
      title="Help & FAQs"
      intro="Quick answers about buying tickets and listing events."
    >
      <ContentSection title="How do I buy tickets?">
        <p>
          Open an event, choose how many tickets you want and check out. Paid tickets are paid
          securely on Stripe’s own checkout page. Free tickets are issued straight away with no
          payment step.
        </p>
      </ContentSection>
      <ContentSection title="Where are my tickets?">
        <p>
          We email your tickets to the address you used at checkout. Can’t find them? Check your
          spam folder, then email{" "}
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a> with the event name and
          your email address.
        </p>
      </ContentSection>
      <ContentSection title="What is the booking fee?">
        <p>
          A booking fee of 4% of the ticket price plus A$0.50 applies to each paid ticket. Free
          tickets never carry a fee. The organiser chooses whether the buyer pays it or they absorb
          it; either way the total you pay is shown before you check out.
        </p>
      </ContentSection>
      <ContentSection title="What if I need a refund?">
        <p>
          See <Link href="/refunds">Request a refund</Link>. If a paid order can’t be fulfilled —
          for example, the last tickets sold out while you were paying — it’s refunded
          automatically.
        </p>
      </ContentSection>
      <ContentSection title="How do I list an event?">
        <p>
          <Link href="/organisers/apply">Apply as an organiser</Link>. Once you’re approved you can
          create events, which are reviewed before they go live. To sell paid tickets you’ll also
          connect a Stripe account for payouts.
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
