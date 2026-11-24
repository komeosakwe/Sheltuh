/**
 * The organiser area's places (Latte's dashboard frames: "Org / Sidebar" and its collapsed rail),
 * in the frames' order, listing only the pages that are built. The frames draw Overview, Events,
 * Orders (labelled "Analytics" on most frames, KEY-SPECS §9.1), Attendees, Payouts and Settings;
 * until Overview, Orders & sales, Attendees and Settings are built (organiser-dashboard plan
 * OD-4, OD-7, OD-9, OD-12) the slots hold what exists today: Events (the events list at
 * /dashboard), Analytics in the Orders slot (the frames' own label for it), Payouts, and the
 * public Profile in the Settings slot. Each later page swaps its entry in here.
 */
export type OrganiserNavKey = "events" | "analytics" | "payouts" | "profile";

/**
 * The rail's icon for each place (components/dashboard/ui/icons.tsx): Latte's calendar and wallet;
 * a chart for Analytics (Latte's receipt is for Orders, which replaces it) and a shopfront for the
 * public Profile (not the person the header's account menu uses).
 */
export type OrganiserNavIcon = "calendar" | "chart" | "wallet" | "store";

export interface OrganiserNavLink {
  key: OrganiserNavKey;
  label: string;
  href: string;
  icon: OrganiserNavIcon;
}

export const ORGANISER_NAV: OrganiserNavLink[] = [
  { key: "events", label: "Events", href: "/dashboard", icon: "calendar" },
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
 * The place a dashboard page belongs to: Payouts, Analytics and Profile for their own pages (an
 * event's report is in Analytics), and Events for the list and everything about one event (new,
 * edit, orders). Null outside the dashboard.
 */
export function organiserSectionFor(pathname: string): OrganiserNavKey | null {
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  if (EVENT_ANALYTICS_PATH.test(pathname)) return "analytics";
  const match = ORGANISER_NAV.find(
    (link) => link.href !== "/dashboard" && (pathname === link.href || pathname.startsWith(`${link.href}/`)),
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
