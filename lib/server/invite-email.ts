import { SUPPORT_EMAIL } from "@/lib/contact";
import { subjectLine, type EmailMessage } from "./email";
import { button, escapeHtml, eventBlock, heading, MUTED, page } from "./email-layout";

/**
 * The account invite email (docs/architecture.md, "Account invites"): an
 * admin set up an invite for someone who asked to join Sheltüh, as an
 * organiser or a member. Transactional, sent once per admin action (no
 * automatic reminders): why they're getting it, the one link, how long it
 * works, that ignoring it sets nothing up, the support address and the
 * Privacy Policy. Everything essential is real text. The brand look is
 * lib/server/email-layout.ts, shared with every email.
 */

/**
 * The invite page. The token is in the fragment (never sent to a server, so
 * it's not in logs or Referers), and the page changes nothing until a
 * button is pressed, so a mail scanner opening the link does nothing.
 */
export function inviteLink(siteUrl: string, token: string): string {
  return `${siteUrl}/invite#token=${token}`;
}

export function privacyLink(siteUrl: string): string {
  return `${siteUrl}/privacy`;
}

export interface InviteEmailInput {
  to: string;
  kind: "organiser" | "member";
  /** An organiser invite's organiser (as the admin entered it). */
  organiserName?: string;
  link: string;
  daysValid: number;
  siteUrl: string;
}

const P = "margin:0 0 12px 0;font-size:15px;line-height:22px";

export function buildInviteEmail(input: InviteEmailInput): EmailMessage {
  const { to, kind, link, daysValid, siteUrl } = input;
  // Admin-entered: kept to one line.
  const organiserName = kind === "organiser" && input.organiserName ? subjectLine(input.organiserName) : undefined;
  const privacy = privacyLink(siteUrl);

  const headline = organiserName ? "You're invited to Sheltüh as an organiser" : "You're invited to join Sheltüh";
  const what = organiserName
    ? `The Sheltüh team has set up ${organiserName} as an organiser, ready for you. Create your account (or sign in) with this email address to take it over and start listing events.`
    : "The Sheltüh team has set up an invite for you. Create your account (or sign in) with this email address to join.";
  const why = "You're getting this because you asked us to set this up for you.";
  const expiry = `The link works for ${daysValid} days.`;
  const ignore = "Didn't ask for this? Ignore this email: nothing is set up unless you open the link and accept.";

  const text = [
    headline,
    "",
    ...(organiserName ? [organiserName, ""] : []),
    what,
    "",
    `Accept the invite: ${link}`,
    "",
    expiry,
    why,
    ignore,
    "",
    `How we handle your details: ${privacy}`,
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = page({
    title: headline,
    preheader: organiserName ? `${organiserName} is ready for you on Sheltüh.` : "Your invite to Sheltüh.",
    body:
      heading(escapeHtml(headline)) +
      (organiserName ? eventBlock(organiserName, [], 16) : "") +
      `<p style="${P}">${escapeHtml(what)}</p>` +
      button("Accept the invite", link) +
      `<p style="${P}">${escapeHtml(expiry)} ${escapeHtml(why)}</p>` +
      `<p style="${P};color:${MUTED}">${escapeHtml(ignore)}</p>` +
      `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED}">How we handle your details: <a href="${escapeHtml(privacy)}" style="color:${MUTED};text-decoration:underline">Privacy Policy</a></p>`,
  });

  const subject = organiserName ? `You're invited to Sheltüh: ${organiserName}` : "You're invited to Sheltüh";
  return { to, subject: subjectLine(subject), text, html };
}
