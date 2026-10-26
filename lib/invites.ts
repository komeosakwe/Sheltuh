/**
 * Account invites, as the browser says them (docs/architecture.md, "Account
 * invites"). Client-safe: nothing here reaches lib/server.
 */

/** How long an emailed invite link works, from when it was sent (or resent). The API's INVITE_LIMITS.linkDays. */
export const INVITE_LINK_DAYS = 14;
