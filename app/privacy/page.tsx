import type { Metadata } from "next";
import Link from "next/link";
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
          <li>
            If you use Who&rsquo;s Going: the display name you choose, when you confirmed you&rsquo;re
            18 or older, and which events you&rsquo;ve added yourself to.
          </li>
        </ul>
        <p>We only collect what we need to run the service.</p>
      </ContentSection>
      <ContentSection title="Who’s Going">
        <p>
          Who&rsquo;s Going is off unless you turn it on, one event at a time. You can add yourself to
          an event when you&rsquo;re signed in with a verified email address and hold a ticket for it
          booked with that same email. To check that, we match your account email against the
          event&rsquo;s ticket orders.
        </p>
        <ul>
          <li>
            People signed in to Sheltüh see your display name and initials on the events you&rsquo;ve
            added yourself to.
          </li>
          <li>People who aren&rsquo;t signed in only see how many people are going.</li>
          <li>
            We never show your email address, which ticket you hold, or the other events you&rsquo;ve
            added yourself to.
          </li>
          <li>Nothing is shown once an event has ended.</li>
        </ul>
        <p>
          You can remove yourself from an event at any time on its page, change your display name or
          delete your Who&rsquo;s Going profile on your{" "}
          <Link href="/account">account page</Link>. Deleting the profile takes you off every event.
          To report a display name that shouldn&rsquo;t be there, email{" "}
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a>.
        </p>
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
