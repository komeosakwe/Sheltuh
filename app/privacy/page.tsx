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
    >
      <ContentSection title="What we collect">
        <ul>
          <li>
            Your email address and password when you create an account, or, if we offer sign-in with
            Google or Apple and you use it, what they share with us (see{" "}
            <a href="#google-apple">Signing in with Google or Apple</a>).
          </li>
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
      <ContentSection title="Signing in with Google or Apple" id="google-apple">
        <p>
          If we offer sign-in with Google or Apple, you can use it to create an account or sign in
          instead of a password. If you do, they ask you first, then share some details with us
          through Supabase, which runs our sign-in:
        </p>
        <ul>
          <li>
            Google: your name, email address, the web address of your profile photo, and your Google
            account ID.
          </li>
          <li>
            Apple: your email address (your real one, or a private relay address if you choose Hide
            My Email), an Apple account ID and, if you let Apple share it, your name. Apple only
            sends your name the first time.
          </li>
        </ul>
        <p>
          We use only the email address and the account ID: to sign you in, and to send your
          tickets and account emails. The other details are kept with your sign-in record, but we
          don&rsquo;t use them or show them to anyone. Your Who&rsquo;s Going display name is
          always the one you choose.
        </p>
        <ul>
          <li>
            If the email address Google or Apple shares is verified and already belongs to a
            Sheltüh account, you&rsquo;re signed in to that account: the two are linked
            automatically, and your password keeps working. So anyone who can sign in to that Google
            or Apple account can sign in to your Sheltüh account. Keep it secure.
          </li>
          <li>
            With Apple&rsquo;s Hide My Email, your account&rsquo;s email is a private relay address
            (ending in @privaterelay.appleid.com) that Apple forwards to you. It won&rsquo;t match an
            account you made with your own address, so you&rsquo;ll have a separate Sheltüh account.
            Your account page shows the address; for Who&rsquo;s Going, book tickets with it. You
            can manage forwarding in your Apple account settings.
          </li>
          <li>
            Google&rsquo;s and Apple&rsquo;s own privacy policies apply to what you give them.
            Signing out of Sheltüh doesn&rsquo;t sign you out of Google or Apple.
          </li>
        </ul>
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
      <ContentSection title="Your location" id="location">
        <p>
          Search can put what&rsquo;s on near you first. It&rsquo;s up to you whether to use it, and
          how.
        </p>
        <ul>
          <li>
            If you choose &ldquo;Use my current location&rdquo;, your browser asks you first. If you
            allow it, your device&rsquo;s position is used only in your browser, to find the nearest
            suburb we know, and is then thrown away. It isn&rsquo;t sent to us, stored, or put in a
            web address.
          </li>
          <li>
            You can type a suburb instead. Either way, only the suburb&rsquo;s name is kept: on this
            device, in your browser&rsquo;s storage, so the search bar remembers it; and in the
            address of the search results page (for example /search?near=Fitzroy).
          </li>
          <li>
            Like any address you visit, that one reaches our website and our hosting
            provider&rsquo;s request logs. The suburb isn&rsquo;t saved in our database, isn&rsquo;t
            linked to your account, and isn&rsquo;t sent with our event searches: results are put in
            order in your browser.
          </li>
          <li>We don&rsquo;t work out where you are from your IP address.</li>
        </ul>
        <p>
          To forget the suburb, choose &ldquo;Anywhere in Australia&rdquo; under the search
          bar&rsquo;s location (or search with the location left empty), or clear this
          site&rsquo;s data in your browser. Search results pages you&rsquo;ve visited, suburb and
          all, stay in your browser&rsquo;s history until you clear it there. You can turn
          location off for this site in your browser&rsquo;s settings at any time.
        </p>
      </ContentSection>
      <ContentSection title="Payments">
        <p>
          Card payments are handled by Stripe. We never see or store your card number. Stripe’s
          own privacy policy applies to the information you give it.
        </p>
        <p>
          Stripe&rsquo;s script loads on our payment page, including when you open it and
          don&rsquo;t pay, and collects information about your device and how the page is used, to
          help prevent fraud. Stripe&rsquo;s privacy policy covers that too.
        </p>
      </ContentSection>
      <ContentSection title="Who we share it with">
        <p>
          We use service providers to run Sheltüh — for hosting, sign-in, our database (located in Sydney),
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
