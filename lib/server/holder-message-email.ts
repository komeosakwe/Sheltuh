import { SUPPORT_EMAIL } from "@/lib/contact";
import { subjectLine, type EmailMessage } from "./email";
import {
  displayHeading,
  emailFooter,
  emailFooterText,
  escapeHtml,
  INK,
  LINE,
  MUTED,
  page,
  SANS,
  WHITE,
  wordmarkHtml,
  wordmarkImage,
} from "./email-layout";
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
  const small = `font-family:${SANS};font-size:13px;line-height:20px;font-weight:400;color:${MUTED}`;

  const html = page({
    title: subject,
    preheader: topic,
    header: wordmarkHtml,
    siteUrl,
    body:
      displayHeading(eventTitle, 8) +
      `<p style="margin:0 0 16px 0;${small}">${escapeHtml(label)}</p>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="background-color:${WHITE};border:1px solid ${LINE};border-radius:8px">` +
      `<tr><td style="padding:16px 20px;font-family:${SANS};color:${INK}">` +
      `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:bold;color:${INK}">${escapeHtml(topic)}</p>` +
      `<p style="margin:0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:400;color:${INK}">${textBlock(body)}</p>` +
      `</td></tr></table>` +
      `<p style="margin:16px 0 0 0;${small}">` +
      `<a href="${escapeHtml(organiserLink)}" style="color:${MUTED};text-decoration:underline">About ${escapeHtml(organiserName)}</a> &middot; ` +
      `<a href="${escapeHtml(reportLink)}" style="color:${MUTED};text-decoration:underline">Report this message</a> &middot; ` +
      `<a href="${escapeHtml(stopLink)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(stopLabel)}</a></p>`,
    footer: emailFooter({ reason, siteUrl }),
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
    inlineImages: [wordmarkImage()],
    headers: {
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<${holderMessageOneClickUrl(siteUrl, input.stopToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
