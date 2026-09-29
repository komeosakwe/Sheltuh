import type { Metadata } from "next";
import Link from "next/link";
import ContentPage, { ContentSection } from "@/components/ContentPage";

export const metadata: Metadata = { title: "Terms of Use — Sheltüh" };

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Terms of Use"
      intro="The basic rules for using Sheltüh."
      draft
    >
      <ContentSection title="Using Sheltüh">
        <p>
          Sheltüh is a guide to events and a way to buy tickets to them. By using it you agree to
          these terms. Please use it lawfully and don’t misuse the service or other people’s
          accounts.
        </p>
      </ContentSection>
      <ContentSection title="Events are run by organisers">
        <p>
          Events are created and run by independent organisers. We review events before they’re
          listed, but the organiser is responsible for the event itself. Details can change; check
          the event page before you go.
        </p>
      </ContentSection>
      <ContentSection title="Organisers">
        <p>
          Organisers must have the right to list their event and to use any photos or text they
          upload. We may decline, remove or unpublish an event or organiser at any time, for
          example if it’s inaccurate, unlawful or unsafe.
        </p>
      </ContentSection>
      <ContentSection title="Your account">
        <p>
          Keep your sign-in details safe. You’re responsible for activity on your account.
        </p>
      </ContentSection>
      <ContentSection title="Your rights">
        <p>
          Nothing in these terms limits any right you have under the Australian Consumer Law. Buying
          tickets is also covered by our <Link href="/purchase-terms">Purchase Terms</Link>.
        </p>
      </ContentSection>
      <ContentSection title="Contact">
        <p>
          <a href="mailto:support@sheltuh.com.au">support@sheltuh.com.au</a>
        </p>
      </ContentSection>
    </ContentPage>
  );
}
