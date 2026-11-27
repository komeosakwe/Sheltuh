import type { OrganiserStatus } from "@/lib/api/types";

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

/** Where an organiser manages one of their events: its editor (read-only once live, with its panels). */
export function manageEventHref(eventId: string): string {
  return `/dashboard/${encodeURIComponent(eventId)}`;
}

/** An event's QR code (docs/architecture.md, "Event QR codes"). */
export function eventQrHref(eventId: string): string {
  return `/dashboard/events/${encodeURIComponent(eventId)}/qr`;
}

/** An event's printable QR sign. */
export function eventQrSignHref(eventId: string): string {
  return `${eventQrHref(eventId)}/sign`;
}

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

/** The For organisers page: what organising on Sheltüh is, and the application. */
export const ORGANISERS_HREF = "/organisers/apply";

/** What's known of the signed-in account's organiser record (useOrganiser's result). */
export interface OrganiserLoad {
  loading: boolean;
  organiser: { status: OrganiserStatus } | null;
  error: string | null;
}

/**
 * Whether the signed-in account is an approved organiser, as far as the page can tell yet: by its
 * organiser record once that has loaded; while it loads, by the hint that this browser last showed
 * them the organiser frame (lib/organiser-frame-hint.ts, `hinted`). The hint only stands in until
 * the record arrives, and a record that failed to load counts as not known. Never for anyone signed
 * out, or in the demo (accounts not configured).
 */
export function isKnownOrganiser({
  signedIn,
  record,
  hinted,
}: {
  /** Accounts are configured here and someone is signed in. */
  signedIn: boolean;
  record: OrganiserLoad;
  hinted: boolean;
}): boolean {
  if (!signedIn) return false;
  if (record.loading) return hinted;
  return record.error === null && record.organiser?.status === "approved";
}

/**
 * Where a "For organisers" link in the site's own navigation goes (the header, the phone drawer,
 * the footer): an approved organiser straight to their dashboard (the owner, 26 Oct 2026: "if
 * someone is already an organiser clicking for organiser should take them to the dashboard"),
 * everyone else to the For organisers page.
 */
export function organisersHref(knownOrganiser: boolean): string {
  return knownOrganiser ? OVERVIEW_HREF : ORGANISERS_HREF;
}
