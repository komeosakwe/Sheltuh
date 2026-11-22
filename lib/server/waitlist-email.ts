import { publicEventUrl } from "@/lib/event-url";
import { eventPlaceName } from "@/lib/place";
import { subjectLine, type EmailMessage } from "./email";
import { escapeHtml } from "./email-layout";
import { kitButtons, kitFooter, kitFooterText, kitHeader, kitHelp, kitHelpText, kitIntro, kitPage, kitStack, kitText } from "./email-kit";
import { ticketWordmarkImage } from "./email-ticket-layout";
import { emailEventCard, formatTicketDate, formatTicketTime } from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The waitlist's two emails (docs/architecture.md, "Waitlist"): a guest's
 * confirmation link, and "tickets are available again". Both are
 * transactional, about one event the person asked to hear about, and the
 * second carries a working leave link (Spam Act 2003: a functional
 * unsubscribe facility) in the body and as `List-Unsubscribe`.
 *
 * The brand look (white page, one white card, Signal Orange only on the button,
 * black text on it) is lib/server/email-kit.ts, shared with every email.
 * Everything essential is real text.
 */

/**
 * The link a guest follows to confirm joining. The token is in the fragment
 * (never sent to a server, so it's not in logs or Referers), and the page
 * only confirms when its button is pressed, so a mail scanner opening the
 * link can't join anyone.
 */
export function waitlistConfirmLink(siteUrl: string, token: string): string {
  return `${siteUrl}/waitlist/confirm#token=${token}`;
}

/** A notification's leave link: as the confirmation link, a page that POSTs the fragment's token when pressed. */
export function waitlistLeaveLink(siteUrl: string, token: string): string {
  return `${siteUrl}/waitlist/leave#token=${token}`;
}

/** The event page's tickets section. */
export function waitlistEventLink(siteUrl: string, slug: string): string {
  return `${publicEventUrl(slug, siteUrl)}#tickets`;
}

/** The event's date and time, in its zone (the ticket email's formatTicketDate and formatTicketTime). */
export function when(event: EventRecord): string {
  return `${formatTicketDate(event.startsAt, event.endsAt, event)}, ${formatTicketTime(event.startsAt, event.endsAt, event)}`;
}

export function where(event: EventRecord): string {
  return [event.venueName, eventPlaceName(event)].filter(Boolean).join(", ");
}

/**
 * The event as the waitlist and follower emails show it: the compact Ticket
 * card (date and time, title, venue name, image; `href` links the title),
 * then the full date and time and the place (venue, suburb and state:
 * where()) on one muted line, so an event with no venue name, or a generic
 * one ("Town Hall"), still says which town it's in.
 */
export function emailEventDetails(event: EventRecord, siteUrl: string, href?: string): string {
  const place = where(event);
  return kitStack(
    [emailEventCard(event, siteUrl, href), kitText(escapeHtml([when(event), place].filter(Boolean).join(" · ")), { muted: true })],
    16,
  );
}

/** The site's origin, from a link the handler built on it. */
function linkOrigin(link: string): string {
  try {
    return new URL(link).origin;
  } catch {
    return "";
  }
}

/** A guest's confirm-to-join email. Nothing is added to the list until the link's page is confirmed. */
export function buildWaitlistConfirmationEmail(
  to: string,
  event: EventRecord,
  link: string,
  hoursValid: number,
): EmailMessage {
  const headline = "Confirm you want to join the waitlist";
  const siteUrl = linkOrigin(link);
  const footer = { siteUrl, tone: "customer" as const };
  const text = [
    headline,
    "",
    event.title,
    when(event),
    where(event),
    "",
    `Confirm here (the link works for ${hoursValid} hours): ${link}`,
    "",
    "Open the link and press Confirm. We'll email you if tickets are released.",
    "Joining doesn't reserve a ticket or charge you.",
    "Didn't ask for this? Ignore this email: you won't be added.",
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");

  const html = kitPage({
    title: headline,
    preheader: `${event.title} · ${when(event)}`,
    siteUrl,
    tone: "customer",
    body: kitStack([
      kitHeader(),
      kitIntro("", headline),
      emailEventDetails(event, siteUrl),
      kitButtons([{ label: "Confirm and join", href: link, kind: "primary" }]),
      kitStack(
        [
          kitText(
            `The link works for ${hoursValid} hours. Open it and press Confirm: we&rsquo;ll email you if tickets are released. Joining doesn&rsquo;t reserve a ticket or charge you.`,
          ),
          kitText("Didn&rsquo;t ask for this? Ignore this email: you won&rsquo;t be added.", { muted: true }),
        ],
        8,
      ),
      kitHelp("customer"),
      kitFooter(footer),
    ]),
  });

  return { to, subject: subjectLine(`Confirm the waitlist: ${event.title}`), text, html, inlineImages: [ticketWordmarkImage()] };
}

/**
 * "Tickets are available again", to someone on the waitlist. First come,
 * first served: nothing is held for them. `eventLink` is the event page's
 * tickets section; `leaveLink` takes them off this event's list.
 */
export function buildWaitlistAvailableEmail(
  to: string,
  event: EventRecord,
  eventLink: string,
  leaveLink: string,
): EmailMessage {
  const headline = "Tickets are available again";
  const siteUrl = linkOrigin(eventLink);
  const footer = {
    siteUrl,
    tone: "customer" as const,
    reason: `You’re getting this because you joined the waitlist for ${event.title} on Sheltüh.`,
    reasonLink: { label: "Leave the waitlist", href: leaveLink, after: " to stop emails about this event." },
  };
  const text = [
    headline,
    "",
    event.title,
    when(event),
    where(event),
    "",
    `Buy tickets: ${eventLink}`,
    "",
    "Some tickets have just been released. They're first come, first served: being on the waitlist doesn't hold one for you, and they may be gone by the time you look.",
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");

  const html = kitPage({
    title: headline,
    preheader: `${event.title} · ${when(event)}`,
    siteUrl,
    tone: "customer",
    body: kitStack([
      kitHeader(),
      kitIntro("", headline),
      emailEventDetails(event, siteUrl),
      kitButtons([{ label: "Buy tickets", href: eventLink, kind: "primary" }]),
      kitText(
        "Some tickets have just been released. They&rsquo;re first come, first served: being on the waitlist doesn&rsquo;t hold one for you, and they may be gone by the time you look.",
      ),
      kitHelp("customer"),
      kitFooter(footer),
    ]),
  });

  return {
    to,
    subject: subjectLine(`Tickets are available again: ${event.title}`),
    text,
    html,
    headers: { "List-Unsubscribe": `<${leaveLink}>` },
    inlineImages: [ticketWordmarkImage()],
  };
}
