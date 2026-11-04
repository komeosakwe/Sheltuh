import { escapeHtml, INK, MUTED, SANS } from "./email-layout";

/**
 * "Tell a friend" in the emails a ticket holder gets (the ticket email and the
 * day-before reminder): three plain links that open a ready-written invite in
 * WhatsApp, the phone's messages app or the mail app. Nothing is sent by
 * Sheltüh and nobody's address is involved: the reader picks who to send it
 * to in their own app. The invite names only the event and links to its
 * public page.
 */

/** The event's public page. */
export function eventPublicLink(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/events/${encodeURIComponent(slug)}`;
}

/** The invite: "I've got tickets to {title} ({date}). Come with me? {link}". */
export function inviteText(title: string, date: string, link: string): string {
  const when = date ? ` (${date})` : "";
  return `I've got tickets to ${title}${when}. Come with me? ${link}`;
}

export interface TellAFriendLink {
  label: string;
  href: string;
}

/** WhatsApp, Messages (the `sms:` form iOS and Android both read) and email, each with the invite filled in. */
export function tellAFriendLinks(title: string, date: string, link: string): TellAFriendLink[] {
  const message = inviteText(title, date, link);
  const body = encodeURIComponent(message);
  return [
    { label: "WhatsApp", href: `https://wa.me/?text=${body}` },
    { label: "Messages", href: `sms:?&body=${body}` },
    { label: "Email", href: `mailto:?subject=${encodeURIComponent(`Come to ${title}?`)}&body=${body}` },
  ];
}

/** The HTML block: a small heading and the three links on one line. */
export function tellAFriendHtml(links: readonly TellAFriendLink[], marginTopPx = 24): string {
  const anchors = links
    .map(
      (l) =>
        `<a href="${escapeHtml(l.href)}" style="color:${INK};text-decoration:underline;font-weight:bold">${escapeHtml(l.label)}</a>`,
    )
    .join(`<span style="color:${MUTED}"> &middot; </span>`);
  return `<p style="margin:${marginTopPx}px 0 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:${INK}"><span style="font-weight:bold">Tell a friend:</span> ${anchors}</p>`;
}

/** The plain-text lines. */
export function tellAFriendText(title: string, date: string, link: string): string[] {
  return ["TELL A FRIEND", inviteText(title, date, link)];
}
