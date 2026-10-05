import type { Metadata } from "next";
import Link from "next/link";
import ContentPage, { ContentSection } from "@/components/ContentPage";
import { SUPPORT_EMAIL } from "@/lib/contact";

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
          <li>
            If you use messages: the messages you send and receive, who you&rsquo;ve blocked, and any
            reports you make.
          </li>
        </ul>
        <p>We only collect what we need to run the service.</p>
      </ContentSection>
      <ContentSection title="Who’s Going" id="whos-going">
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
            Your display name is saved with your account, so you can add yourself to other events in
            one tap. It&rsquo;s the same on every event you add yourself to, so people signed in to
            Sheltüh can see which of those events you&rsquo;ve joined.
          </li>
          <li>We never show your email address or which ticket you hold.</li>
          <li>
            Other people who&rsquo;ve added themselves to the same event can send you a message request
            (see <a href="#messages">Messages</a>).
          </li>
          <li>Nothing is shown once an event has ended.</li>
        </ul>
        <p>
          You can remove yourself from an event at any time on its page. You can change your display
          name, or delete your Who&rsquo;s Going profile to leave every event at once, on your{" "}
          <Link href="/account">account page</Link>. To report a display name that shouldn&rsquo;t be
          there, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </ContentSection>
      <ContentSection title="Messages" id="messages">
        <p>
          Members who&rsquo;ve both added themselves to the same event&rsquo;s Who&rsquo;s Going list
          can message each other on Sheltüh.
        </p>
        <ul>
          <li>
            First contact is a single message request, without links. Nothing more can be sent until
            the other person replies, and replying is how they accept.
          </li>
          <li>
            People you message see your display name and the event you&rsquo;re both going to, never
            your email address.
          </li>
          <li>
            If you decline a request, we won&rsquo;t notify the sender, but they won&rsquo;t be able to
            message you again. If you block someone, we won&rsquo;t notify them, but they&rsquo;ll no
            longer see your conversation or be able to message you, and you won&rsquo;t see each other
            on Who&rsquo;s Going lists. You can unblock people from your blocked members list.
          </li>
          <li>
            If you report someone, we keep a copy of the reported message, up to 20 messages from the
            conversation before it and their display name, so our team can review it, even if the
            messages or either account are later deleted.
          </li>
        </ul>
        <p>How long we keep it:</p>
        <ul>
          <li>Conversations and their messages are deleted 12 months after the last message.</li>
          <li>Reports are kept for 2 years after they&rsquo;re resolved, then deleted.</li>
          <li>
            Deleting your Who&rsquo;s Going profile deletes your conversations straight away, for both
            of you. Reports keep their copies.
          </li>
        </ul>
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
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We handle personal
          information in line with the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
