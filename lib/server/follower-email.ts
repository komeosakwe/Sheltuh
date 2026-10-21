import { SUPPORT_EMAIL } from "@/lib/contact";
import { publicEventUrl } from "@/lib/event-url";
import { subjectLine, type EmailMessage } from "./email";
import type { EventRecord } from "./types";
import { button, escapeHtml, INK, MUTED, page, supportFooter, when, where } from "./waitlist-email";

/**
 * "New from {organiser}": the email a member chose (when following) to get
 * when an organiser they follow publishes new events (docs/architecture.md,
 * "Following organisers"). At most one a day per organiser per member; it
 * lists every event announced since the last one. Brand Direction One, as
 * the waitlist emails. Every email carries its own unsubscribe link (a page
 * that POSTs the fragment's token), in the body and as `List-Unsubscribe`
 * (Spam Act 2003: a functional unsubscribe facility).
 */

/** Most events one email lists (the rest: "and N more" with the organiser's page). */
export const FOLLOWER_EMAIL_MAX_EVENTS = 6;

/** The unsubscribe link: a page that POSTs the fragment's token when its button is pressed (as the waitlist's). */
export function followerUnsubscribeLink(siteUrl: string, token: string): string {
  return `${siteUrl}/following/unsubscribe#token=${token}`;
}

/** The organiser's public page. */
export function organiserPageLink(siteUrl: string, organiserId: string): string {
  return `${siteUrl}/organisers/${encodeURIComponent(organiserId)}`;
}

function eventItem(event: EventRecord, siteUrl: string): string {
  const place = where(event);
  const link = publicEventUrl(event.slug, siteUrl);
  return (
    `<p style="margin:0 0 4px 0;font-size:18px;line-height:24px;font-weight:bold">` +
    `<a href="${escapeHtml(link)}" style="color:${INK}">${escapeHtml(event.title)}</a></p>` +
    `<p style="margin:0 0 20px 0;font-size:15px;line-height:22px">${escapeHtml(when(event))}` +
    (place ? `<br>${escapeHtml(place)}` : "") +
    `</p>`
  );
}

/**
 * `events`: the new events still published and upcoming, soonest first (at
 * least one). `total`: how many there are in all (more than `events` when
 * the list was cut at FOLLOWER_EMAIL_MAX_EVENTS).
 */
export function buildFollowerNewEventsEmail(input: {
  to: string;
  organiserName: string;
  organiserId: string;
  events: EventRecord[];
  total: number;
  siteUrl: string;
  unsubscribeLink: string;
}): EmailMessage {
  const { to, events, total, siteUrl, unsubscribeLink } = input;
  // Organiser-supplied: kept to one line, so it can't bend the subject header.
  const organiserName = subjectLine(input.organiserName);
  const organiserLink = organiserPageLink(siteUrl, input.organiserId);
  const heading =
    total === 1 ? `New from ${organiserName}` : `${total} new events from ${organiserName}`;
  const more = total - events.length;
  const firstLink = publicEventUrl(events[0].slug, siteUrl);

  const text = [
    heading,
    "",
    ...events.flatMap((event) => [
      event.title,
      when(event),
      where(event),
      publicEventUrl(event.slug, siteUrl),
      "",
    ]),
    ...(more > 0 ? [`And ${more} more: ${organiserLink}`, ""] : []),
    `You're getting this because you follow ${organiserName} on Sheltüh and asked to hear about their new events.`,
    `Stop these emails (you'll still follow ${organiserName}): ${unsubscribeLink}`,
    "",
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page(
    heading,
    `<h1 style="margin:0 0 20px 0;font-size:28px;line-height:34px">${escapeHtml(heading)}</h1>` +
      events.map((event) => eventItem(event, siteUrl)).join("") +
      button(total === 1 ? "See the event" : "See the first event", firstLink) +
      (more > 0
        ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:22px">And ${more} more on <a href="${escapeHtml(organiserLink)}" style="color:${INK}">${escapeHtml(organiserName)}&rsquo;s page</a>.</p>`
        : "") +
      `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">You&rsquo;re getting this because you follow ${escapeHtml(organiserName)} on Sheltüh and asked to hear about their new events. <a href="${escapeHtml(unsubscribeLink)}" style="color:${INK}">Stop these emails</a> (you&rsquo;ll still follow them).</p>`,
    supportFooter,
  );

  return {
    to,
    subject: subjectLine(total === 1 ? `New from ${organiserName}: ${events[0].title}` : heading),
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribeLink}>` },
  };
}
