import { placeName } from "@/lib/place";
import { cachedDateTimeFormat, PLATFORM_TIME_ZONE } from "@/lib/time-zones";
import { subjectLine, type EmailMessage } from "./email";
import { emailFooterText, escapeHtml, SANS } from "./email-layout";
import {
  brandHeader,
  compactFooter,
  coverImage,
  icon,
  type EmailIcon,
  MODERN_COLOURS,
  modernHeading,
  modernPage,
  modernParagraph,
  outlineButton,
  primaryButton,
  stack,
  textStyle,
} from "./email-modern-layout";
import { organiserPageLink } from "./follower-email";
import { eventPublicLink, tellAFriendCompactHtml, tellAFriendLinks, tellAFriendText } from "./share-email";
import { ticketDirectionsLink, ticketPageLink, ticketWhen } from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The reminder sent to a ticket holder the day before an event, or the
 * morning of it (private.queue_event_reminders, docs/architecture.md, "Event
 * reminders"). One email per person per event, in the modern layout
 * (lib/server/email-modern-layout.ts: header, cover image, details card with
 * icons, full-width buttons, compact footer). It is service information about
 * a purchase the person made, so it has no unsubscribe link and no marketing;
 * its footer says why they got it. Sent as an automatic message (`Auto-Submitted`), so
 * out-of-office replies and the like don't answer it.
 */

/** Calendar days from `now` to the event's start, both in the event's own zone (0 today, 1 tomorrow, negative if past). */
/** The time's underline: 2px in the accent, set clear of the descenders. */
const TIME_UNDERLINE = `text-decoration:underline;text-decoration-color:${MODERN_COLOURS.accent};text-decoration-thickness:2px;text-underline-offset:4px`;

export function reminderDaysAway(startsAt: string, now: Date, timeZone: string = PLATFORM_TIME_ZONE): number {
  const dayKey = cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = (d: Date) => Date.parse(`${dayKey.format(d)}T00:00:00Z`);
  return Math.round((day(new Date(startsAt)) - day(now)) / 86_400_000);
}

/** "today" when the event starts on the same calendar day as `now` in the event's own zone, otherwise "tomorrow". */
export function reminderDay(startsAt: string, now: Date, timeZone: string = PLATFORM_TIME_ZONE): "today" | "tomorrow" {
  return reminderDaysAway(startsAt, now, timeZone) <= 0 ? "today" : "tomorrow";
}

export function buildEventReminderEmail(input: {
  to: string;
  /** The order the reminder is for: its ticket page is the button's link. */
  orderId: string;
  event: EventRecord;
  organiserId: string;
  siteUrl: string;
  /** When it is built, to say "today" or "tomorrow" in the event's zone. */
  now: Date;
}): EmailMessage {
  const { to, orderId, organiserId, siteUrl, now } = input;
  // Organiser-supplied text: control, invisible and bidi characters become a space and line breaks go.
  const title = subjectLine(input.event.title);
  const organiserName = subjectLine(input.event.organiserName);
  const event = input.event;
  const day = reminderDay(event.startsAt, now, event.timeZone);
  const when = ticketWhen(event.startsAt, event.endsAt, event);
  const venue = subjectLine(event.venueName ?? "");
  const address = subjectLine(event.venueAddress ?? "") || placeName(event.suburb ?? "", event.state);
  const directions = ticketDirectionsLink(event);
  const ticketsLink = ticketPageLink(siteUrl, orderId);
  const organiserLink = organiserPageLink(siteUrl, organiserId);
  const subject = subjectLine(`${day === "today" ? "Today" : "Tomorrow"}: ${title}`);
  const heading = day === "today" ? "Today’s the day." : "Tomorrow, you’re in.";
  const intro = "A reminder about an event you have tickets for.";
  const reason = "You’re getting this one-off reminder because you have tickets for this event on Sheltüh.";
  const whenLines = [when.date, ...when.lines];
  const eventLink = event.slug ? eventPublicLink(siteUrl, event.slug) : null;

  const { ink, muted, border } = MODERN_COLOURS;
  const rowCell = (name: EmailIcon, iconAlt: string, lines: string) =>
    `<td width="36" valign="top" style="width:36px;padding:2px 0 0 0">${icon(siteUrl, name, iconAlt)}</td><td valign="top" style="overflow-wrap:break-word;word-wrap:break-word">${lines}</td>`;
  const line = (value: string, style: string, gap = 0) => `<p style="margin:0${gap ? ` 0 ${gap}px 0` : ""};${style}">${escapeHtml(value)}</p>`;
  const rows = [
    // Each row is [icon, alt, lines]; the venue's name is its first line and the address, muted, sits under it.
    ["calendar", "Date", line(when.date, textStyle(16, 24, { weight: 600 }))],
    // The time is the detail people come back for: underlined in the accent.
    ["clock", "Time", when.lines.map((l) => line(l, textStyle(16, 24, { weight: 600, extra: TIME_UNDERLINE }))).join("")],
    [
      "pin",
      "Venue",
      (venue ? line(venue, textStyle(16, 24, { weight: 600 })) : "") +
        (address ? line(address, venue ? textStyle(15, 22, { colour: muted }) : textStyle(16, 24)) : ""),
    ],
  ] as const;
  const detailRows = rows
    .filter(([, , lines]) => lines !== "")
    .map(
      ([name, iconAlt, lines]) =>
        `<tr><td style="padding:16px 20px;border-top:1px solid ${border}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${rowCell(name, iconAlt, lines)}</tr></table></td></tr>`,
    )
    .join("");
  const details =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MODERN_COLOURS.bg}" style="background-color:${MODERN_COLOURS.bg};border:1px solid ${border};border-radius:16px;border-collapse:separate">` +
    `<tr><td style="padding:20px 20px 16px 20px;overflow-wrap:break-word;word-wrap:break-word;${textStyle(20, 28, { weight: 600 })}">${escapeHtml(title)}</td></tr>` +
    detailRows +
    `</table>`;
  const hostedBy = modernParagraph(
    `Organised by <a href="${escapeHtml(organiserLink)}" style="color:${ink};text-decoration:underline">${escapeHtml(organiserName)}</a>`,
    textStyle(14, 22, { colour: muted }),
  );

  const html = modernPage({
    title: subject,
    preheader: `${when.date}, ${when.lines[0] ?? ""}`.trim(),
    siteUrl,
    body: stack([
      [brandHeader(siteUrl, "Event Reminder"), 32],
      [coverImage(siteUrl, event.imageUrl, `Event image for ${title}`), 32],
      [modernHeading(escapeHtml(heading)), 8],
      [modernParagraph(escapeHtml(intro), textStyle(18, 28, { colour: muted })), 32],
      [details, 24],
      [primaryButton("View your tickets", ticketsLink, { siteUrl, name: "ticket" }), directions ? 16 : 32],
      [directions ? outlineButton("Get directions", directions, { siteUrl, name: "navigate" }) : "", 32],
      [hostedBy, eventLink ? 8 : 32],
      [eventLink ? tellAFriendCompactHtml(tellAFriendLinks(title, when.date, eventLink), { ink, muted, font: SANS }) : "", 32],
      [compactFooter({ reason, siteUrl }), 0],
    ]),
  });

  const text = [
    heading,
    "",
    intro,
    "",
    title,
    ...whenLines,
    ...(venue ? [`Venue: ${venue}`] : []),
    ...(address ? [`Address: ${address}`] : []),
    ...(directions ? [`Get directions: ${directions}`] : []),
    "",
    `View your tickets: ${ticketsLink}`,
    "",
    `Organised by ${organiserName}: ${organiserLink}`,
    "",
    ...(eventLink ? [...tellAFriendText(title, when.date, eventLink), ""] : []),
    emailFooterText({ reason, siteUrl }),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html,
    headers: { "Auto-Submitted": "auto-generated" },
  };
}
