import { SUPPORT_EMAIL } from "@/lib/contact";
import { organiserPageLink } from "@/lib/event-url";
import { subjectLine, type EmailMessage } from "./email";
import { escapeHtml } from "./email-layout";
import { KIT, kitFooter, kitFooterText, kitHeader, kitHelp, kitHelpText, kitIntro, kitLink, kitNotice, kitP, kitPage, kitStack, kitType } from "./email-kit";
import { ticketWordmarkImage } from "./email-ticket-layout";

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
 * Its look is the shared layout (lib/server/email-kit.ts; Latte drew no frame
 * for it): who it is from and the event name, then the message as the focus
 * in the layout's outlined message box (no artwork: the 1120 message boxes
 * carry none).
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
  const reason = `Sheltüh sent this for ${organiserName}. You’re getting it because you have tickets for ${eventTitle} on Sheltüh.`;
  const footer = { siteUrl, tone: "customer" as const, reason };

  // The focus of the email: the organiser's own words in the layout's message box (Latte's "A message from …"),
  // the topic as its title. The topic and body are escaped plain text.
  const message = kitNotice(topic, [textBlock(body)]);
  const links = kitP(
    `${kitLink(organiserLink, `About ${escapeHtml(organiserName)}`, KIT.muted)} &middot; ` +
      `${kitLink(reportLink, "Report this message", KIT.muted)} &middot; ` +
      kitLink(stopLink, escapeHtml(stopLabel), KIT.muted),
    kitType("sans", 14, 20, 400, KIT.muted, "overflow-wrap:break-word;word-wrap:break-word"),
  );

  const html = kitPage({
    title: subject,
    preheader: topic,
    siteUrl,
    tone: "customer",
    body: kitStack([kitHeader(), kitIntro(label, eventTitle), message, links, kitHelp("customer"), kitFooter(footer)]),
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
    headers: {
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<${holderMessageOneClickUrl(siteUrl, input.stopToken)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
