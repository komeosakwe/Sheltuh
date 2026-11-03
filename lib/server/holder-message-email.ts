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
 * links the organiser's page and offers a way to report it. The text is the
 * organiser's, shown as escaped plain text in a labelled block; it has no
 * unsubscribe link (it's about tickets the reader holds) and no marketing, and
 * is sent as an automatic message (`Auto-Submitted`).
 */

/** The report link: a mailto to support naming the message (its id reveals nothing about the reader). */
export function holderMessageReportLink(messageId: string, organiserName: string): string {
  const subject = subjectLine(`Report a message from ${organiserName}`);
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Message reference: ${messageId}\n\nWhat's wrong with it?\n`)}`;
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
}): EmailMessage {
  const { to, messageId, eventTitle, organiserName, organiserId, subject: topic, body, siteUrl } = input;
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
      `<a href="${escapeHtml(reportLink)}" style="color:${MUTED};text-decoration:underline">Report this message</a></p>`,
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
    "",
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
