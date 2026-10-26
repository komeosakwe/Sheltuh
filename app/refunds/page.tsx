import type { Metadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";

export const metadata: Metadata = { title: "Request a refund — Sheltüh" };

export default function RefundsPage() {
  return (
    <ContentPage
      eyebrow="Fan support"
      title="Request a refund"
      intro="How refunds work, and how to ask for one."
      draft
    >
      <ContentSection title="How to ask">
        <p>
          Email <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a> with the event
          name, the email address you bought with, and what went wrong. We’ll reply as soon as we
          can.
        </p>
      </ContentSection>
      <ContentSection title="Each event’s refund policy">
        <p>
          Every event shows its own refund policy beside its tickets, and again before you pay:
          either no refunds for change of mind, or refunds for any reason up to a set number of
          days before the event. Events with tickets sold on another site follow that site’s terms.
        </p>
      </ContentSection>
      <ContentSection title="When you’re refunded">
        <p>Whatever the event’s policy:</p>
        <ul>
          <li>The event is cancelled.</li>
          <li>
            Your paid order couldn’t be fulfilled (for example, tickets sold out while you were
            paying) — this is refunded automatically.
          </li>
          <li>
            The event or your tickets are materially different from what was advertised, or another
            consumer guarantee under the Australian Consumer Law applies.
          </li>
        </ul>
      </ContentSection>
      <ContentSection title="Your rights">
        <p>
          Nothing on this page limits your rights under the Australian Consumer Law. Refunds are
          returned to the original payment method; the time it takes to appear depends on your bank.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
