import { SUPPORT_EMAIL } from "@/lib/contact";
import { subjectLine, type EmailMessage } from "./email";
import { emailFooterText, escapeHtml } from "./email-layout";
import {
  brandHeader,
  compactFooter,
  coverImage,
  MODERN_COLOURS,
  modernPage,
  modernParagraph,
  stack,
  textStyle,
} from "./email-modern-layout";
import { organiserPageLink } from "./follower-email";

/**
 * An organiser's message to the people holding tickets for their event
 * (docs/architecture.md, "Messages to ticket holders"). Sheltüh sends it from
 * its own address with no Reply-To (a reply would hand the organiser the
 * buyer's address); the footer says who it is from and why the reader got it,
 * links the organiser's page and offers a way to report it and a way to stop
 * this organiser's messages (a "Stop messages from {organiser}" link, plus
 * List-Unsubscribe and List-Unsubscribe-Post headers). The text is the
 * organiser's, shown as escaped plain text in a labelled block; there is no
 * marketing, and it is sent as an automatic message (`Auto-Submitted`).
 * Its look is lib/server/email-modern-layout.ts: the event's artwork (when it
 * has any), the event name, who it is from, then the message as the focus, in
 * a tinted card.
 */

/** The report link: a mailto to support naming the message (its id reveals nothing about the reader). */
export function holderMessageReportLink(messageId: string, organiserName: string): string {
  const subject = subjectLine(`Report a message from ${organiserName}`);
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Message reference: ${messageId}\n\nWhat's wrong with it?\n`)}`;
}

/** The "Stop messages from {organiser}" page. The token is in the fragment, which browsers never send. */
export function holderMessageStopLink(siteUrl: string, token: string): string {
  return `${siteUrl}/holder-messages/stop#token=${token}`;
}

/** The List-Unsubscribe URL: the API endpoint, so a mail client's one-click POST (RFC 8058) reaches it; opening it in a browser redirects to the page. */
export function holderMessageOneClickUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/api/holder-messages/stop?token=${encodeURIComponent(token)}`;
}

/** Escaped plain text as HTML: line breaks kept. */
function textBlock(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export function buildHolderMessageEmail(input: {
  to: string;
  messageId: string;
  eventTitle: string;
  organiserName: string;
  organiserId: string;
  subject: string;
  body: string;
  siteUrl: string;
  /**
   * The event's stored image path (EventRecord.imageUrl, like "/api/events/{id}/image?v=1"), if it has artwork.
   * Shown across the top when the site is https and the path is the site's own (`eventImageEmailUrl`); else left out.
   */
  eventImageUrl?: string;
  /** The recipient's stop token (32 random bytes, base64url): only its hash is stored. */
  stopToken: string;
}): EmailMessage {
  const { to, messageId, organiserId, subject: topic, body, siteUrl } = input;
  // The event title and the organiser's name are organiser-supplied: control, invisible and bidi characters
  // become a space and line breaks go, so neither can hide, reorder or bend what the reader sees.
  const eventTitle = subjectLine(input.eventTitle);
  const organiserName = subjectLine(input.organiserName);
  // The stop link: a page with a button (nothing changes on opening it), and the same endpoint for a mail client's one-click.
  const stopLink = holderMessageStopLink(siteUrl, input.stopToken);
  const stopLabel = `Stop messages from ${organiserName}`;
  const subject = subjectLine(`${eventTitle}: ${topic}`);
  const organiserLink = organiserPageLink(siteUrl, organiserId);
  const reportLink = holderMessageReportLink(messageId, organiserName);
  const label = `A message from ${organiserName}`;
  const reason = `Sheltüh sent this for ${organiserName}, who can’t see your address. You’re getting it because you have tickets for ${eventTitle} on Sheltüh.`;
  const { muted, tint, tintBorder } = MODERN_COLOURS;
  const small = textStyle(13, 24, { colour: muted });
  const link = `color:${muted};text-decoration:underline`;
  const wrap = "overflow-wrap:break-word;word-wrap:break-word;word-break:break-word";

  // The focus of the email: the organiser's own words in a tinted card. The title and body are escaped plain text.
  const card =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tint}" style="background-color:${tint};border:1px solid ${tintBorder};border-radius:16px;border-collapse:separate">` +
    `<tr><td style="padding:32px 24px;${textStyle(16, 26, { extra: wrap })}">` +
    `<p style="margin:0 0 8px 0;${textStyle(13, 20, { weight: 600, colour: muted })}">${escapeHtml(`Message from ${organiserName}`)}</p>` +
    `<h2 style="margin:0 0 16px 0;${textStyle(24, 30, { weight: 600, extra: `letter-spacing:normal;${wrap}` })}">${escapeHtml(topic)}</h2>` +
    `<p style="margin:0;${textStyle(16, 26, { extra: wrap })}">${textBlock(body)}</p>` +
    `</td></tr></table>`;
  const links =
    `<p style="margin:0;${small}">` +
    `<a href="${escapeHtml(organiserLink)}" style="${link}">About ${escapeHtml(organiserName)}</a> &middot; ` +
    `<a href="${escapeHtml(reportLink)}" style="${link}">Report this message</a> &middot; ` +
    `<a href="${escapeHtml(stopLink)}" style="${link}">${escapeHtml(stopLabel)}</a></p>`;

  const html = modernPage({
    title: subject,
    preheader: topic,
    siteUrl,
    body: stack([
      [brandHeader(siteUrl, "Event Update"), 32],
      [coverImage(siteUrl, input.eventImageUrl, `Event image for ${eventTitle}`), 32],
      [
        `<h1 class="h1" style="margin:0;${textStyle(32, 40, { weight: 600, extra: `letter-spacing:normal;${wrap}` })}">${escapeHtml(eventTitle)}</h1>`,
        8,
      ],
      [modernParagraph(`From ${escapeHtml(organiserName)}`, textStyle(16, 24, { colour: muted })), 32],
      [card, 24],
      [links, 32],
      [compactFooter({ reason, siteUrl }), 0],
    ]),
  });

  const text = [
    eventTitle,
    label,
    "",
    topic,
    "",
    body,
    "",
    `About ${organiserName}: ${organiserLink}`,
    `Report this message: ${reportLink}`,
    `${stopLabel}: ${stopLink}`,
    "",
    emailFooterText({ reason, siteUrl }),
  ].join("\n");

  return {
    to,
    subject,
    text,
    html,
    headers: {
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<${holderMessageOneClickUrl(siteUrl, input.stopToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
