/**
 * Account invites and organiser links, as the browser says them
 * (docs/architecture.md, "Account invites" and "Organiser links").
 * Client-safe: nothing here imports lib/server (which reads the organiser
 * link constants from here, so the pages and the API agree).
 */

/** How long an emailed invite link works, from when it was sent (or resent). The API's INVITE_LIMITS.linkDays. */
export const INVITE_LINK_DAYS = 14;

/** How long an organiser link works, from when it was made (the API's ORGANISER_LINK_LIMITS.linkDays is this). */
export const ORGANISER_LINK_DAYS = 7;

/** Where an organiser link lands; its token is in the fragment (`#token=…`). */
export const ORGANISER_JOIN_PATH = "/organisers/join";

/**
 * What a link that can't be used says (unknown, used, expired or cancelled:
 * the API doesn't say which). The API's 404 message too.
 */
export const ORGANISER_LINK_UNAVAILABLE = "This link has expired or was already used — ask Sheltüh for a new one.";
