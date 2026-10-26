import { SUPPORT_EMAIL } from "@/lib/contact";
import { publicEventUrl } from "@/lib/event-url";
import { subjectLine, type EmailMessage } from "./email";
import { button, escapeHtml, eventBlock, heading, INK, MUTED, page } from "./email-layout";
import { formatTicketDate, formatTicketTime } from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The waitlist's two emails (docs/architecture.md, "Waitlist"): a guest's
 * confirmation link, and "tickets are available again". Both are
 * transactional, about one event the person asked to hear about, and the
 * second carries a working leave link (Spam Act 2003: a functional
 * unsubscribe facility) in the body and as `List-Unsubscribe`.
 *
 * The brand look (white page, one white card, Signal Orange only on the button,
 * black text on it) is lib/server/email-layout.ts, shared with every email.
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

export function when(event: EventRecord): string {
  return `${formatTicketDate(event.startsAt, event.endsAt)}, ${formatTicketTime(event.startsAt, event.endsAt)}`;
}

export function where(event: EventRecord): string {
  return [event.venueName, event.suburb].filter(Boolean).join(", ");
}

function eventDetails(event: EventRecord): string {
  return eventBlock(event.title, [when(event), where(event)]);
}

/** A guest's confirm-to-join email. Nothing is added to the list until the link's page is confirmed. */
export function buildWaitlistConfirmationEmail(
  to: string,
  event: EventRecord,
  link: string,
  hoursValid: number,
): EmailMessage {
  const headline = "Confirm you want to join the waitlist";
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
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    body:
      heading(headline) +
      eventDetails(event) +
      button("Confirm and join", link) +
      `<p style="margin:0 0 8px 0;font-size:15px;line-height:22px">The link works for ${hoursValid} hours. Open it and press Confirm: we&rsquo;ll email you if tickets are released. Joining doesn&rsquo;t reserve a ticket or charge you.</p>` +
      `<p style="margin:0;font-size:15px;line-height:22px;color:${MUTED}">Didn&rsquo;t ask for this? Ignore this email: you won&rsquo;t be added.</p>`,
  });

  return { to, subject: subjectLine(`Confirm the waitlist: ${event.title}`), text, html };
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
  const text = [
    headline,
    "",
    event.title,
    when(event),
    where(event),
    "",
    `Get tickets: ${eventLink}`,
    "",
    "Some tickets have just been released. They're first come, first served: being on the waitlist doesn't hold one for you, and they may be gone by the time you look.",
    "",
    `You're getting this because you joined the waitlist for ${event.title} on Sheltüh.`,
    `Leave the waitlist (no more emails about this event): ${leaveLink}`,
    "",
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    body:
      heading(headline) +
      eventDetails(event) +
      button("Get tickets", eventLink) +
      `<p style="margin:0 0 24px 0;font-size:15px;line-height:22px">Some tickets have just been released. They&rsquo;re first come, first served: being on the waitlist doesn&rsquo;t hold one for you, and they may be gone by the time you look.</p>` +
      `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">You&rsquo;re getting this because you joined the waitlist for ${escapeHtml(event.title)} on Sheltüh. <a href="${escapeHtml(leaveLink)}" style="color:${INK}">Leave the waitlist</a> to stop emails about this event.</p>`,
  });

  return {
    to,
    subject: subjectLine(`Tickets are available again: ${event.title}`),
    text,
    html,
    headers: { "List-Unsubscribe": `<${leaveLink}>` },
  };
}
