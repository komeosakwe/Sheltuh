import type { StateCode } from "@/lib/time-zones";
import { subjectLine, type EmailMessage } from "./email";
import { isPlainEmailAddress } from "./email-address";
import { button, escapeHtml, eventBlock, heading, INK, MUTED, page, SANS } from "./email-layout";
import { formatTicketDate, formatTicketTime, type EventZone } from "./ticket-email";

/**
 * The admins' "waiting for your review" emails (docs/architecture.md, "Admin
 * review emails"): an event an organiser submitted (or resubmitted) for
 * review, and an organiser application (new or resubmitted); and the
 * "an organiser published an event" email (an approved organiser's event
 * that went live without review, for admins to check after the fact). Internal and
 * transactional: no marketing, no tracking, nothing about buyers. Only what
 * an admin needs to know something is waiting (the event's title, its
 * organiser's name and its start; the applicant's organiser name) and the
 * link to the queue, where everything else is.
 *
 * The subjects and preheaders are fixed: an applicant's or organiser's own
 * text (an event title, an organiser name) never goes in them, so it can't
 * be used to send admins a convincing message from our signed address. It
 * appears only in the body, labelled as what the organiser submitted.
 */

/** Most addresses read from ADMIN_NOTIFY_EMAILS (the rest are ignored). */
export const MAX_ADMIN_NOTIFY_EMAILS = 20;

/**
 * ADMIN_NOTIFY_EMAILS: a comma-separated list of plain addresses. Blank
 * entries are skipped, invalid ones ignored (`ignored` counts them, so the
 * caller can log how many without logging what), repeats (ignoring case)
 * kept once, at most MAX_ADMIN_NOTIFY_EMAILS.
 */
export function parseAdminNotifyEmails(value: string | undefined): { emails: string[]; ignored: number } {
  const emails: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const raw of (value ?? "").split(",")) {
    const email = raw.trim();
    if (email === "") continue;
    if (!isPlainEmailAddress(email) || emails.length >= MAX_ADMIN_NOTIFY_EMAILS) {
      ignored += 1;
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return { emails, ignored };
}

/** The event review queue, filtered to events waiting for review. */
export function eventReviewQueueLink(siteUrl: string): string {
  return `${siteUrl}/admin/events?status=pending_review`;
}

/**
 * The published events queue's "recently published" view (events that went
 * live in the last 14 days, newest first: GET /api/admin/events?recent=1).
 * Until the admin UI has that view, the link opens the published list.
 */
export function recentlyPublishedQueueLink(siteUrl: string): string {
  return `${siteUrl}/admin/events?status=published&view=recent`;
}

/** The organiser applications queue (it opens on pending applications). */
export function organiserReviewQueueLink(siteUrl: string): string {
  return `${siteUrl}/admin/organisers`;
}

/**
 * "Saturday 6 March 2027, 8:00 pm AEDT": when the event starts, in its zone
 * (`where`; Melbourne by default: "Saturday 6 March 2027, 8:00 pm Perth time (AWST)").
 */
export function reviewEventStart(startsAt: string, where: EventZone = {}): string {
  return `${formatTicketDate(startsAt, undefined, where)}, ${formatTicketTime(startsAt, undefined, where)}`;
}

const FOOTER_TEXT = "You're getting this because you're a Sheltüh admin.";
const FOOTER_HTML = `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">You&rsquo;re getting this because you&rsquo;re a Sheltüh admin.</p>`;

/** The label over the organiser's own text, so it never reads as ours. */
const SUBMITTED_LABEL = "As submitted by the organiser:";
const SUBMITTED_LABEL_HTML = `<p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(SUBMITTED_LABEL)}</p>`;
const PREHEADER = "Open the review queue to approve or reject it.";

/** "Event submitted for review" (or "resubmitted"), to one admin. */
export function buildEventReviewEmail(input: {
  to: string;
  title: string;
  organiserName: string;
  startsAt: string;
  /** The event's zone and state (absent: Melbourne). */
  timeZone?: string;
  state?: StateCode | null;
  resubmitted: boolean;
  siteUrl: string;
}): EmailMessage {
  const { to, siteUrl, resubmitted } = input;
  // Organiser-supplied: kept to one line each.
  const title = subjectLine(input.title);
  const organiserName = subjectLine(input.organiserName);
  const starts = reviewEventStart(input.startsAt, { timeZone: input.timeZone, state: input.state });
  const link = eventReviewQueueLink(siteUrl);
  const headline = resubmitted ? "An event was resubmitted for review" : "An event is waiting for review";

  const text = [
    headline,
    "",
    SUBMITTED_LABEL,
    `Title: ${title}`,
    `Organiser: ${organiserName}`,
    `Starts ${starts}`,
    "",
    `Review it: ${link}`,
    "",
    FOOTER_TEXT,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    preheader: PREHEADER,
    body:
      heading(escapeHtml(headline)) +
      SUBMITTED_LABEL_HTML +
      eventBlock(title, [`Organiser: ${organiserName}`, `Starts ${starts}`]) +
      button("Open the review queue", link) +
      FOOTER_HTML,
  });

  const subject = resubmitted ? "Event resubmitted for review" : "Event submitted for review";
  return { to, subject, text, html };
}

const PUBLISHED_PREHEADER = "It's live now. Open the list to check it, or unpublish it.";
const PUBLISHED_LEAD = "It went live without review. Check it, and unpublish it if it shouldn't be on Sheltüh.";

/**
 * "Event published by an organiser", to one admin: an approved organiser's
 * event went live without review. The title, the organiser's name, when it
 * starts (in the event's zone) and where its tickets are: "on Sheltüh", or
 * "sold on {host}" for an external ticket link (the link's host as the
 * browser shows it, punycode included, never the organiser's wording). No
 * description, venue or buyer data.
 */
export function buildEventPublishedEmail(input: {
  to: string;
  title: string;
  organiserName: string;
  startsAt: string;
  /** The event's zone and state (absent: Melbourne). */
  timeZone?: string;
  state?: StateCode | null;
  /** The external ticket link's host; absent for Sheltüh ticketing. */
  ticketHost?: string;
  siteUrl: string;
}): EmailMessage {
  const { to, siteUrl } = input;
  // Organiser-supplied: kept to one line each.
  const title = subjectLine(input.title);
  const organiserName = subjectLine(input.organiserName);
  const starts = reviewEventStart(input.startsAt, { timeZone: input.timeZone, state: input.state });
  const tickets = input.ticketHost ? `Tickets: sold on ${subjectLine(input.ticketHost)}` : "Tickets: on Sheltüh";
  const link = recentlyPublishedQueueLink(siteUrl);
  const headline = "An organiser published an event";

  const text = [
    headline,
    "",
    PUBLISHED_LEAD,
    "",
    SUBMITTED_LABEL,
    `Title: ${title}`,
    `Organiser: ${organiserName}`,
    `Starts ${starts}`,
    tickets,
    "",
    `Check it: ${link}`,
    "",
    FOOTER_TEXT,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    preheader: PUBLISHED_PREHEADER,
    body:
      heading(escapeHtml(headline)) +
      `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${escapeHtml(PUBLISHED_LEAD)}</p>` +
      SUBMITTED_LABEL_HTML +
      eventBlock(title, [`Organiser: ${organiserName}`, `Starts ${starts}`, tickets]) +
      button("Open recently published events", link) +
      FOOTER_HTML,
  });

  return { to, subject: "Event published by an organiser", text, html };
}

/** "Organiser application to review", to one admin (a new application or a resubmitted one). */
export function buildOrganiserReviewEmail(input: { to: string; organiserName: string; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  const organiserName = subjectLine(input.organiserName);
  const link = organiserReviewQueueLink(siteUrl);
  const headline = "An organiser application is waiting for review";

  const text = [
    headline,
    "",
    SUBMITTED_LABEL,
    `Organiser name: ${organiserName}`,
    "",
    `Review it: ${link}`,
    "",
    FOOTER_TEXT,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    preheader: PREHEADER,
    body:
      heading(escapeHtml(headline)) +
      SUBMITTED_LABEL_HTML +
      eventBlock(organiserName, []) +
      button("Open the organiser queue", link) +
      FOOTER_HTML,
  });

  return { to, subject: "Organiser application to review", text, html };
}
