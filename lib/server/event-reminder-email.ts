import { formatEventDateShort } from "@/lib/format";
import { cachedDateTimeFormat, PLATFORM_TIME_ZONE } from "@/lib/time-zones";
import { subjectLine, type EmailMessage } from "./email";
import {
  type KitDetailRow,
  kitButtons,
  kitDetails,
  kitFooter,
  kitFooterText,
  kitHeader,
  kitHelp,
  kitHelpText,
  kitIntro,
  kitLink,
  kitPage,
  kitStack,
  kitTicketCard,
} from "./email-kit";
import { ticketWordmarkImage } from "./email-ticket-layout";
import {
  eventImageEmailUrl,
  formatStubTime,
  TICKET_EMAIL_REASON,
  ticketCalendarLinks,
  ticketDirectionsLink,
  ticketEmailWhen,
  ticketAddressLine,
  ticketPageLink,
} from "./ticket-email";
import type { EventRecord } from "./types";

/**
 * The reminder sent to a ticket holder the day before an event, or the
 * morning of it (private.queue_event_reminders, docs/architecture.md, "Event
 * reminders"). One email per person per event, on the shared layout
 * (lib/server/email-kit.ts, Latte's 1120 frame). It is service information about
 * a purchase the person made, so it has no unsubscribe link and no marketing;
 * its footer says why they got it. Sent as an automatic message (`Auto-Submitted`), so
 * out-of-office replies and the like don't answer it.
 */

/** Calendar days from `now` to the event's start, both in the event's own zone (0 today, 1 tomorrow, negative if past). */

export function reminderDaysAway(startsAt: string, now: Date, timeZone: string = PLATFORM_TIME_ZONE): number {
  const dayKey = cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = (d: Date) => Date.parse(`${dayKey.format(d)}T00:00:00Z`);
  return Math.round((day(new Date(startsAt)) - day(now)) / 86_400_000);
}

/** "today" when the event starts on the same calendar day as `now` in the event's own zone, otherwise "tomorrow". */
export function reminderDay(startsAt: string, now: Date, timeZone: string = PLATFORM_TIME_ZONE): "today" | "tomorrow" {
  return reminderDaysAway(startsAt, now, timeZone) <= 0 ? "today" : "tomorrow";
}

/**
 * The reminder (Latte's 1120 "Reminder (day before)" frame), on the shared
 * layout (lib/server/email-kit.ts): "Tomorrow · Sat 14 Nov" and "See you
 * tomorrow at {event}.", the compact Ticket card (date and time, title,
 * venue, image), the date row with its calendar links and the venue row with
 * Get directions, "Open your ticket", "Need a hand?" and the footer. The
 * frame's "Before you go" box is left out: its lines (doors, age, phones) are
 * the organiser's, and events don't carry them yet. Organiser-supplied text
 * (the title, the venue) is cleaned with subjectLine first.
 */
export function buildEventReminderEmail(input: {
  to: string;
  orderId: string;
  event: EventRecord;
  organiserId: string;
  siteUrl: string;
  now: Date;
}): EmailMessage {
  const { to, orderId, siteUrl, now } = input;
  // Organiser-supplied text: control, invisible and bidi characters become a space and line breaks go.
  const title = subjectLine(input.event.title);
  const event = input.event;
  const day = reminderDay(event.startsAt, now, event.timeZone);
  const when = ticketEmailWhen(event.startsAt, event.endsAt, event);
  const venue = subjectLine(event.venueName ?? "");
  // "16 Catherine St, Coburg North VIC", as the ticket email writes it (the suburb and state added when missing).
  const address = subjectLine(ticketAddressLine(event));
  const directions = ticketDirectionsLink(event);
  const calendar = ticketCalendarLinks(event, siteUrl);
  const ticketsLink = ticketPageLink(siteUrl, orderId);
  const shortDate = formatEventDateShort(event.startsAt, event.timeZone ?? PLATFORM_TIME_ZONE);
  const subject = subjectLine(`${day === "today" ? "Today" : "Tomorrow"}: ${title}`);
  const eyebrow = `${day === "today" ? "Today" : "Tomorrow"} · ${shortDate}`;
  const heading = `See you ${day} at ${title}.`;
  const footer = { siteUrl, tone: "customer" as const, reason: TICKET_EMAIL_REASON };
  const calendarLinks = [
    calendar.google ? ["Google", calendar.google] : null,
    calendar.apple ? ["Apple", calendar.apple] : null,
    calendar.outlook ? ["Outlook", calendar.outlook] : null,
  ].filter((l): l is [string, string] => l !== null);

  const rows: KitDetailRow[] = [
    {
      icon: "calendar",
      title: when.date,
      lines: when.lines,
      ...(calendarLinks.length
        ? { linkHtml: `Add to calendar: ${calendarLinks.map(([label, href]) => kitLink(href, label)).join(" &middot; ")}` }
        : {}),
    },
    ...(venue || address
      ? [
          {
            icon: "pin" as const,
            title: venue || address,
            lines: venue && address ? [address] : [],
            ...(directions ? { linkHtml: kitLink(directions, "Get directions&nbsp;&#8599;") } : {}),
          },
        ]
      : []),
  ];

  const html = kitPage({
    title: subject,
    preheader: [when.lines[0] ?? "", venue].filter(Boolean).join(" · "),
    siteUrl,
    tone: "customer",
    body: kitStack([
      kitHeader(),
      kitIntro(eyebrow, heading),
      kitTicketCard({
        dateLine: `${shortDate} · ${formatStubTime(event.startsAt, event.endsAt, event)}`,
        title,
        venue,
        imageUrl: eventImageEmailUrl(siteUrl, event.imageUrl),
      }),
      kitDetails(siteUrl, rows),
      kitButtons([{ label: "Open your ticket", href: ticketsLink, kind: "primary" }]),
      kitHelp("customer"),
      kitFooter(footer),
    ]),
  });

  const text = [
    eyebrow,
    heading,
    "",
    title,
    `${shortDate} · ${formatStubTime(event.startsAt, event.endsAt, event)}`,
    ...(venue ? [venue] : []),
    "",
    when.date,
    ...when.lines,
    ...(calendarLinks.length ? [`Add to calendar — ${calendarLinks.map(([label, href]) => `${label}: ${href}`).join(" · ")}`] : []),
    ...(venue ? [`Venue: ${venue}`] : []),
    ...(address ? [`Address: ${address}`] : []),
    ...(directions ? [`Get directions: ${directions}`] : []),
    "",
    `Open your ticket: ${ticketsLink}`,
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html,
    inlineImages: [ticketWordmarkImage()],
    headers: { "Auto-Submitted": "auto-generated" },
  };
}
