/**
 * My tickets' path (app/(account)/tickets/page.tsx). Its own module so the header's account nav
 * (components/nav/useNavAccount.ts, in every page's layout) doesn't load the list's helpers to link to it.
 */
export const MY_TICKETS_HREF = "/tickets";
