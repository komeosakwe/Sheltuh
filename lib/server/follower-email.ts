import { organiserPageLink, publicEventUrl } from "@/lib/event-url";
import { subjectLine, type EmailMessage } from "./email";
import { escapeHtml } from "./email-layout";
import { kitButtons, kitFooter, kitFooterText, kitHeader, kitHelp, kitHelpText, kitIntro, kitLink, kitPage, kitStack, kitText } from "./email-kit";
import { ticketWordmarkImage } from "./email-ticket-layout";
import type { EventRecord } from "./types";
import { emailEventDetails, when, where } from "./waitlist-email";

/**
 * "New from {organiser}": the email a member chose (when following) to get
 * when an organiser they follow publishes new events (docs/architecture.md,
 * "Following organisers"). At most one a day per organiser per member; it
 * lists every event announced since the last one. The brand look is shared
 * with every email (lib/server/email-kit.ts). Every email carries its own
 * unsubscribe link (a page that POSTs the fragment's token), in the body and
 * as `List-Unsubscribe` (Spam Act 2003: a functional unsubscribe facility).
 */

/** Most events one email lists (the rest: "and N more" with the organiser's page). */
export const FOLLOWER_EMAIL_MAX_EVENTS = 6;

/** The unsubscribe link: a page that POSTs the fragment's token when its button is pressed (as the waitlist's). */
export function followerUnsubscribeLink(siteUrl: string, token: string): string {
  return `${siteUrl}/following/unsubscribe#token=${token}`;
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
  const footer = {
    siteUrl,
    tone: "customer" as const,
    reason: `You’re getting this because you follow ${organiserName} on Sheltüh and asked to hear about their new events.`,
    reasonLink: { label: "Stop these emails", href: unsubscribeLink, after: " (you’ll still follow them)." },
  };

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
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");

  const html = kitPage({
    title: heading,
    preheader: events.map((event) => event.title).join(" · "),
    siteUrl,
    tone: "customer",
    body: kitStack([
      kitHeader(),
      kitIntro("", heading),
      kitStack(
        events.map((event) => emailEventDetails(event, siteUrl, publicEventUrl(event.slug, siteUrl))),
        24,
      ),
      kitButtons([{ label: total === 1 ? "See the event" : "See the first event", href: firstLink, kind: "primary" }]),
      more > 0 ? kitText(`And ${more} more on ${kitLink(organiserLink, `${escapeHtml(organiserName)}&rsquo;s page`)}.`) : "",
      kitHelp("customer"),
      kitFooter(footer),
    ]),
  });

  return {
    to,
    subject: subjectLine(total === 1 ? `New from ${organiserName}: ${events[0].title}` : heading),
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribeLink}>` },
    inlineImages: [ticketWordmarkImage()],
  };
}
