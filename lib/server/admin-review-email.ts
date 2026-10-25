import { subjectLine, type EmailMessage } from "./email";
import { isPlainEmailAddress } from "./email-address";
import { button, escapeHtml, eventBlock, heading, MUTED, page } from "./email-layout";
import { formatTicketDate, formatTicketTime } from "./ticket-email";

/**
 * The admins' "waiting for your review" emails (docs/architecture.md, "Admin
 * review emails"): an event an organiser submitted (or resubmitted) for
 * review, and an organiser application (new or resubmitted). Internal and
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

/** The organiser applications queue (it opens on pending applications). */
export function organiserReviewQueueLink(siteUrl: string): string {
  return `${siteUrl}/admin/organisers`;
}

/** "Saturday 6 March 2027, 8:00 pm AEDT": when the event starts, in Melbourne time. */
export function reviewEventStart(startsAt: string): string {
  return `${formatTicketDate(startsAt)}, ${formatTicketTime(startsAt)}`;
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
  resubmitted: boolean;
  siteUrl: string;
}): EmailMessage {
  const { to, siteUrl, resubmitted } = input;
  // Organiser-supplied: kept to one line each.
  const title = subjectLine(input.title);
  const organiserName = subjectLine(input.organiserName);
  const starts = reviewEventStart(input.startsAt);
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
