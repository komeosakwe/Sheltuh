import { kitTellAFriend } from "./email-kit";

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

/**
 * The HTML block: Latte's 1120 "Going with friends?" box (kitTellAFriend in
 * ./email-kit: a cream box with the links as outlined chips). The ticket email
 * builds its own (with a "Share page" chip); nothing else uses this yet.
 */
export function tellAFriendHtml(links: readonly TellAFriendLink[]): string {
  return kitTellAFriend(links);
}
