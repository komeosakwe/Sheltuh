import { placeName } from "@/lib/place";
import { cachedDateTimeFormat, PLATFORM_TIME_ZONE } from "@/lib/time-zones";
import { subjectLine, type EmailMessage } from "./email";
import {
  button,
  displayHeading,
  emailFooter,
  emailFooterText,
  escapeHtml,
  eventBlock,
  INK,
  page,
  paragraph,
  paragraphHtml,
  wordmarkHtml,
  wordmarkImage,
} from "./email-layout";
import { organiserPageLink } from "./follower-email";
import { eventPublicLink, tellAFriendHtml, tellAFriendLinks, tellAFriendText } from "./share-email";
import { ticketDirectionsLink, ticketPageLink, ticketWhen } from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The reminder sent to a ticket holder the day before an event, or the
 * morning of it (private.queue_event_reminders, docs/architecture.md, "Event
 * reminders"). One email per person per event, on the shared brand layout
 * (lib/server/email-layout.ts). It is service information about a purchase
 * the person made, so it has no unsubscribe link and no marketing; its footer
 * says why they got it. Sent as an automatic message (`Auto-Submitted`), so
 * out-of-office replies and the like don't answer it.
 */

/** "today" when the event starts on the same calendar day as `now` in the event's own zone, otherwise "tomorrow". */
export function reminderDay(startsAt: string, now: Date, timeZone: string = PLATFORM_TIME_ZONE): "today" | "tomorrow" {
  const dayKey = cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return dayKey.format(new Date(startsAt)) === dayKey.format(now) ? "today" : "tomorrow";
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
  const heading = day === "today" ? "It’s today." : "See you tomorrow.";
  const intro = "A reminder about an event you have tickets for.";
  const reason = "You’re getting this one-off reminder because you have tickets for this event on Sheltüh.";
  const whenLines = [when.date, ...when.lines];
  const eventLink = event.slug ? eventPublicLink(siteUrl, event.slug) : null;

  const body =
    displayHeading(heading, 16) +
    paragraph(intro, 24) +
    eventBlock(title, [...whenLines, venue, address], directions ? 12 : 24) +
    (directions
      ? paragraphHtml(
          `<a href="${escapeHtml(directions)}" style="color:${INK};text-decoration:underline">Get directions</a>`,
          24,
        )
      : "") +
    button("View your tickets", ticketsLink, "0 0 24px 0") +
    paragraphHtml(
      `Hosted by <a href="${escapeHtml(organiserLink)}" style="color:${INK};text-decoration:underline">${escapeHtml(organiserName)}</a>`,
      0,
    ) +
    (eventLink ? tellAFriendHtml(tellAFriendLinks(title, when.date, eventLink)) : "");

  const html = page({
    title: subject,
    preheader: `${when.date}, ${when.lines[0] ?? ""}`.trim(),
    header: wordmarkHtml,
    siteUrl,
    body,
    footer: emailFooter({ reason, siteUrl }),
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
    `Hosted by ${organiserName}: ${organiserLink}`,
    "",
    ...(eventLink ? [...tellAFriendText(title, when.date, eventLink), ""] : []),
    emailFooterText({ reason, siteUrl }),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html,
    inlineImages: [wordmarkImage()],
    headers: { "Auto-Submitted": "auto-generated" },
  };
}
