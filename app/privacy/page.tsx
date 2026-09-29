import type { Metadata } from "next";
import ContentPage, { ContentSection } from "@/components/ContentPage";

export const metadata: Metadata = { title: "Privacy Policy — Sheltüh" };

export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="What we collect, why, and who else sees it."
      draft
    >
      <ContentSection title="What we collect">
        <ul>
          <li>Your email address and password when you create an account.</li>
          <li>
            The email address you enter at checkout, so we can send your tickets, and your order
            details.
          </li>
          <li>
            If you apply as an organiser: your organisation name, contact email, description,
            categories and website.
          </li>
          <li>Event details and photos that organisers submit.</li>
        </ul>
        <p>We only collect what we need to run the service.</p>
      </ContentSection>
      <ContentSection title="Payments">
        <p>
          Card payments are handled by Stripe. We never see or store your card number. Stripe’s
          own privacy policy applies to the information you give it.
        </p>
      </ContentSection>
      <ContentSection title="Who we share it with">
        <p>
          We use service providers to run Sheltüh — for hosting, our database (located in Sydney),
          payments and sending email. They only handle data on our behalf. Organisers can see the
          orders for their own events. We don’t sell your personal information.
        </p>
      </ContentSection>
      <ContentSection title="Marketing email">
        <p>
          We’ll only send you marketing email if you’ve agreed to it, and every message will have a
          way to unsubscribe. Ticket and account emails are not marketing.
        </p>
      </ContentSection>
      <ContentSection title="Your choices">
        <p>
          You can ask to access or correct the personal information we hold about you, or to delete
          your account, by emailing{" "}
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a>. We handle personal
          information in line with the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
