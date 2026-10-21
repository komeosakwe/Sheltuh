import { SUPPORT_EMAIL } from "@/lib/contact";
import { publicEventUrl } from "@/lib/event-url";
import type { EmailMessage } from "./email";
import { formatTicketDate, formatTicketTime } from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The waitlist's two emails (docs/architecture.md, "Waitlist"): a guest's
 * confirmation link, and "tickets are available again". Both are
 * transactional, about one event the person asked to hear about, and the
 * second carries a working leave link (Spam Act 2003: a functional
 * unsubscribe facility) in the body and as `List-Unsubscribe`.
 *
 * Brand Direction One colours (docs/design/brand-direction-one.md §2): black
 * on cream and white, Signal Orange only as the one call-to-action fill,
 * with black text on it (6.18:1). Table markup and inline styles, as the
 * ticket email, and everything essential is real text.
 */

const CREAM = "#fffae7";
const CARD = "#ffffff";
export const INK = "#000000";
export const MUTED = "#6b675e";
const SIGNAL = "#ff4800";
const SANS = `'Instrument Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

/** The one call-to-action (Signal Orange fill, black text). Shared with lib/server/follower-email.ts. */
export function button(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0"><tr>` +
    `<td bgcolor="${SIGNAL}" style="background-color:${SIGNAL};border:1px solid ${INK};border-radius:8px">` +
    `<a href="${escapeHtml(href)}" style="display:block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:bold;color:${INK};text-decoration:none">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

/** The brand email page (cream, one white card). Shared with lib/server/follower-email.ts. */
export function page(title: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background-color:${CREAM};font-family:${SANS};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background-color:${CARD};border:1px solid ${INK};border-radius:12px">
<tr><td style="padding:32px 30px">
${body}
</td></tr></table>
<p style="max-width:600px;margin:16px auto 0 auto;text-align:center;font-size:13px;line-height:20px;color:${MUTED}">${footer}</p>
</body>
</html>`;
}

function eventBlock(event: EventRecord): string {
  const place = where(event);
  return (
    `<p style="margin:0 0 4px 0;font-size:20px;line-height:26px;font-weight:bold">${escapeHtml(event.title)}</p>` +
    `<p style="margin:0 0 4px 0;font-size:16px;line-height:24px">${escapeHtml(when(event))}</p>` +
    (place ? `<p style="margin:0 0 24px 0;font-size:16px;line-height:24px">${escapeHtml(place)}</p>` : "")
  );
}

export const supportFooter = `Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED}">${escapeHtml(SUPPORT_EMAIL)}</a><br>Sheltüh &middot; Melbourne`;

/** A guest's confirm-to-join email. Nothing is added to the list until the link's page is confirmed. */
export function buildWaitlistConfirmationEmail(
  to: string,
  event: EventRecord,
  link: string,
  hoursValid: number,
): EmailMessage {
  const heading = "Confirm you want to join the waitlist";
  const text = [
    heading,
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

  const html = page(
    heading,
    `<h1 style="margin:0 0 16px 0;font-size:28px;line-height:34px">${heading}</h1>` +
      eventBlock(event) +
      button("Confirm and join", link) +
      `<p style="margin:0 0 8px 0;font-size:15px;line-height:22px">The link works for ${hoursValid} hours. Open it and press Confirm: we&rsquo;ll email you if tickets are released. Joining doesn&rsquo;t reserve a ticket or charge you.</p>` +
      `<p style="margin:0;font-size:15px;line-height:22px;color:${MUTED}">Didn&rsquo;t ask for this? Ignore this email: you won&rsquo;t be added.</p>`,
    supportFooter,
  );

  return { to, subject: `Confirm the waitlist: ${event.title}`, text, html };
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
  const heading = "Tickets are available again";
  const text = [
    heading,
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

  const html = page(
    heading,
    `<h1 style="margin:0 0 16px 0;font-size:28px;line-height:34px">${heading}</h1>` +
      eventBlock(event) +
      button("Get tickets", eventLink) +
      `<p style="margin:0 0 24px 0;font-size:15px;line-height:22px">Some tickets have just been released. They&rsquo;re first come, first served: being on the waitlist doesn&rsquo;t hold one for you, and they may be gone by the time you look.</p>` +
      `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">You&rsquo;re getting this because you joined the waitlist for ${escapeHtml(event.title)} on Sheltüh. <a href="${escapeHtml(leaveLink)}" style="color:${INK}">Leave the waitlist</a> to stop emails about this event.</p>`,
    supportFooter,
  );

  return {
    to,
    subject: `Tickets are available again: ${event.title}`,
    text,
    html,
    headers: { "List-Unsubscribe": `<${leaveLink}>` },
  };
}
