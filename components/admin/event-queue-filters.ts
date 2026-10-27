import type { AdminListEventsQuery } from "@/lib/api/admin";
import type { EventStatus } from "@/lib/api/types";

/**
 * The admin event queue's filters, kept in the URL
 * (/admin/events?status=published&view=door&q=neon) so a tab can be linked
 * to, survives a refresh, and the hub and sub-nav can point at it.
 */

/**
 * Which published events: not ended, the ones that went live in the last 14
 * days (newest first, whoever published them: the admin email for an
 * organiser's own publish links here), Sheltüh-run ones (not ended; where
 * admins find the doors they run), or every one (past included).
 */
export type PublishedView = "upcoming" | "recent" | "door" | "all";

export interface EventQueueFilters {
  status: EventStatus;
  /** Only used with `published`. */
  view: PublishedView;
  /** Title or organiser; "" for none. */
  q: string;
}

export const EVENT_QUEUE_PATH = "/admin/events";

/**
 * The published Sheltüh-run view, where admins find the events whose door
 * they run (docs/architecture.md, "Check-in"): the hub's Door check-in card,
 * and the way back from an admin's door check-in.
 */
export const DOOR_EVENTS_HREF = `${EVENT_QUEUE_PATH}?status=published&view=door`;

/**
 * Events that went live in the last 14 days, newest first, with who
 * published them (the organiser, or Sheltüh): the hub's card, and the link in
 * the admins' "published by an organiser" email (lib/server/admin-review-email.ts).
 */
export const RECENTLY_PUBLISHED_HREF = `${EVENT_QUEUE_PATH}?status=published&view=recent`;

/** In the order they're offered, with plain labels (not the API's status names). */
export const EVENT_STATUSES: { value: EventStatus; label: string }[] = [
  { value: "pending_review", label: "Waiting for review" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "rejected", label: "Rejected" },
];

export const PUBLISHED_VIEWS: { value: PublishedView; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "recent", label: "Recently published" },
  { value: "door", label: "Sheltüh-run" },
  { value: "all", label: "All, past included" },
];

/** The API's search limit (lib/api/admin.ts): longer text is cut there anyway. */
export const EVENT_SEARCH_MAX = 100;

function isStatus(value: string | null): value is EventStatus {
  return EVENT_STATUSES.some((s) => s.value === value);
}

function isView(value: string | null): value is PublishedView {
  return PUBLISHED_VIEWS.some((v) => v.value === value);
}

/** The filters in a URL's query; anything missing or unknown falls back to the default (waiting for review). */
export function readEventQueueFilters(params: Pick<URLSearchParams, "get">): EventQueueFilters {
  const status = params.get("status");
  const view = params.get("view");
  return {
    status: isStatus(status) ? status : "pending_review",
    view: isView(view) ? view : "upcoming",
    q: (params.get("q") ?? "").trim().slice(0, EVENT_SEARCH_MAX),
  };
}

/** The queue's URL for these filters; the defaults are left out ("/admin/events" is waiting for review). */
export function eventQueueHref(filters: EventQueueFilters): string {
  const qs = new URLSearchParams();
  if (filters.status !== "pending_review") qs.set("status", filters.status);
  if (filters.status === "published" && filters.view !== "upcoming") qs.set("view", filters.view);
  if (filters.q.trim()) qs.set("q", filters.q.trim());
  const query = qs.toString();
  return query ? `${EVENT_QUEUE_PATH}?${query}` : EVENT_QUEUE_PATH;
}

/**
 * What the API is asked for: ended events too, except in the published
 * Upcoming and Sheltüh-run views. Recently published asks for `recent`
 * (published in the last 14 days, newest first, ended ones included). The Sheltüh-run view asks for every
 * platform-managed organiser's event, externally ticketed ones included
 * (there's no ticketing filter, and filtering pages here would leave gaps);
 * only Sheltüh-ticketed ones offer Door check-in (EventQueueItem, hasAdminDoor).
 */
export function eventQueueQuery(filters: EventQueueFilters, cursor?: string): AdminListEventsQuery {
  if (filters.status === "published" && filters.view === "recent") {
    const recent: AdminListEventsQuery = { status: "published", recent: true };
    if (filters.q) recent.q = filters.q;
    if (cursor) recent.cursor = cursor;
    return recent;
  }
  const query: AdminListEventsQuery = { status: filters.status, upcoming: false };
  if (filters.status === "published" && filters.view !== "all") query.upcoming = true;
  if (filters.status === "published" && filters.view === "door") query.platformManaged = true;
  if (filters.q) query.q = filters.q;
  if (cursor) query.cursor = cursor;
  return query;
}

interface ListWords {
  heading: string;
  /** "3 events waiting for review". */
  one: string;
  many: string;
  /** The empty state, without a search. */
  emptyTitle: string;
  emptyText: string;
}

/** The list's heading, how a loaded list is announced, and its empty state, for each status (and published view). */
export function eventQueueWords(filters: EventQueueFilters): ListWords {
  switch (filters.status) {
    case "pending_review":
      return {
        heading: "Waiting for review",
        one: "event waiting for review",
        many: "events waiting for review",
        emptyTitle: "Nothing to review",
        emptyText: "New submissions appear here, soonest first, as organisers send them.",
      };
    case "draft":
      return {
        heading: "Drafts",
        one: "draft",
        many: "drafts",
        emptyTitle: "No drafts",
        emptyText: "Events organisers have started but not sent for review, and unpublished events, appear here.",
      };
    case "rejected":
      return {
        heading: "Rejected",
        one: "rejected event",
        many: "rejected events",
        emptyTitle: "No rejected events",
        emptyText: "Events you’ve rejected appear here with the reason the organiser was given.",
      };
    case "published":
      if (filters.view === "door") {
        return {
          heading: "Sheltüh-run events",
          one: "upcoming Sheltüh-run event",
          many: "upcoming Sheltüh-run events",
          emptyTitle: "No upcoming Sheltüh-run events",
          emptyText:
            "Events of Sheltüh-run (platform-managed) organisers appear here until they end. Admins run the door for the ones ticketed on Sheltüh; organisers run their own doors.",
        };
      }
      if (filters.view === "recent") {
        return {
          heading: "Recently published",
          one: "event published in the last 14 days",
          many: "events published in the last 14 days",
          emptyTitle: "Nothing published in the last 14 days",
          emptyText:
            "Events appear here, newest first, for 14 days after they go live: the ones organisers published themselves, and the ones you approved.",
        };
      }
      if (filters.view === "all") {
        return {
          heading: "Published, past included",
          one: "published event",
          many: "published events",
          emptyTitle: "No published events",
          emptyText: "Approved events appear here.",
        };
      }
      return {
        heading: "Published, upcoming",
        one: "upcoming published event",
        many: "upcoming published events",
        emptyTitle: "No upcoming published events",
        emptyText: "Events that have ended are under “All, past included”.",
      };
  }
}
