/**
 * The organiser area's places (Latte's dashboard frames: "Org / Sidebar" and its collapsed rail),
 * in the frames' order, listing only the pages that are built. The frames draw Overview, Events,
 * Orders (labelled "Analytics" on most frames, KEY-SPECS §9.1), Attendees, Payouts and Settings;
 * until Orders & sales, Attendees and Settings are built (organiser-dashboard plan OD-7, OD-9,
 * OD-12) the slots hold what exists today: Overview (/dashboard, the dashboard's home), Events (the
 * events list at /dashboard/events), Analytics in the Orders slot (the frames' own label for it),
 * Payouts, and the public Profile in the Settings slot. Each later page swaps its entry in here.
 */
export type OrganiserNavKey = "overview" | "events" | "analytics" | "payouts" | "profile";

/**
 * The rail's icon for each place (components/dashboard/ui/icons.tsx): Latte's grid, calendar and wallet;
 * a chart for Analytics (Latte's receipt is for Orders, which replaces it) and a shopfront for the
 * public Profile (not the person the header's account menu uses).
 */
export type OrganiserNavIcon = "grid" | "calendar" | "chart" | "wallet" | "store";

export interface OrganiserNavLink {
  key: OrganiserNavKey;
  label: string;
  href: string;
  icon: OrganiserNavIcon;
}

/** The Overview, the dashboard's home. */
export const OVERVIEW_HREF = "/dashboard";
/** The events list (Latte's Events tab). */
export const EVENTS_HREF = "/dashboard/events";
/** A new event (the editor). */
export const NEW_EVENT_HREF = "/dashboard/new";

export const ORGANISER_NAV: OrganiserNavLink[] = [
  { key: "overview", label: "Overview", href: OVERVIEW_HREF, icon: "grid" },
  { key: "events", label: "Events", href: EVENTS_HREF, icon: "calendar" },
  { key: "analytics", label: "Analytics", href: "/dashboard/analytics", icon: "chart" },
  { key: "payouts", label: "Payouts", href: "/dashboard/payouts", icon: "wallet" },
  { key: "profile", label: "Profile", href: "/dashboard/profile", icon: "store" },
];

/** An event's report belongs to Analytics (its back link is "← Analytics"). */
const EVENT_ANALYTICS_PATH = /^\/dashboard\/events\/[^/]+\/analytics\/?$/;

/**
 * Organiser pages that are their own full-screen surface, with their own way back, so no frame
 * or nav: the door scanner (docs/design/check-in.md) and the seat-map editor (a grid the height of
 * the screen, docs/design/seating.md §5.13).
 */
const FULL_SCREEN_PATH = /^\/dashboard\/[^/]+\/(check-in|seat-map)\/?$/;

export function isFullScreenOrganiserPath(pathname: string): boolean {
  return FULL_SCREEN_PATH.test(pathname);
}

/**
 * The place a dashboard page belongs to: the Overview for /dashboard itself; Payouts, Analytics and
 * Profile for their own pages (an event's report is in Analytics); and Events for the list and
 * everything about one event (new, edit, orders). Null outside the dashboard.
 */
export function organiserSectionFor(pathname: string): OrganiserNavKey | null {
  if (pathname !== OVERVIEW_HREF && !pathname.startsWith(`${OVERVIEW_HREF}/`)) return null;
  if (pathname === OVERVIEW_HREF || pathname === `${OVERVIEW_HREF}/`) return "overview";
  if (EVENT_ANALYTICS_PATH.test(pathname)) return "analytics";
  const match = ORGANISER_NAV.find(
    (link) => link.href !== OVERVIEW_HREF && (pathname === link.href || pathname.startsWith(`${link.href}/`)),
  );
  return match?.key ?? "events";
}

/**
 * Whether `link` is where you are: "page" on its own page, "true" on a page inside it (an event's
 * editor is in Events), false otherwise.
 */
export function organiserCurrent(link: OrganiserNavLink, pathname: string): "page" | "true" | false {
  if (organiserSectionFor(pathname) !== link.key) return false;
  const own = pathname === link.href || pathname === `${link.href}/`;
  return own ? "page" : "true";
}
