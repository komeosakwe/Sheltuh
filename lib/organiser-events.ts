import type { EventRecord, EventStatus } from "./api/types";

/**
 * What an organiser sees and can do for one of their events on the dashboard
 * (components/dashboard/OrganiserEventRow.tsx). The rules mirror the routes:
 *
 * - The editor (/dashboard/{id}) saves only a draft or rejected event; a
 *   pending one opens read-only (PATCH /api/events/{id} is a 409), so its
 *   action is "View submission", not Edit. A published one's main action is
 *   its public page instead (the editor would only say it's locked).
 * - Analytics (/dashboard/events/{id}/analytics) works for any status.
 * - Door check-in only for a published event ticketed on Sheltüh (an
 *   external event's check-in is a 409: it has no admissions).
 * - The seat map only for a reserved-seating event (it has a map), which an
 *   external event never has. The page shows any status (locked once approved).
 * - The public page (/events/{slug}) only while published (404 otherwise).
 */

/** The dashboard's status words. `unpublished`: approved once, since taken down (back to draft). */
export type OrganiserEventState = EventStatus | "unpublished";

/** The StatusBadge tone (components/ui/StatusBadge.tsx) for each state; the word always carries the state too. */
export type OrganiserEventTone = "neutral" | "pending" | "approved" | "rejected";

export interface OrganiserEventStatus {
  state: OrganiserEventState;
  label: string;
  tone: OrganiserEventTone;
  /** One line on what the organiser can do next. */
  hint: string;
  /** The hint goes on with "Contact Sheltüh to change it.", the first two words a link to Sheltüh's support email. */
  contactToChange?: boolean;
}

const STATUS: Record<OrganiserEventState, Omit<OrganiserEventStatus, "state">> = {
  draft: { label: "Draft", tone: "neutral", hint: "Finish it, then submit it for review." },
  pending_review: {
    label: "Waiting for review",
    tone: "pending",
    hint: "Sheltüh is reviewing it. You can’t edit it until then.",
  },
  published: { label: "Published", tone: "approved", hint: "Live on Sheltüh.", contactToChange: true },
  rejected: { label: "Rejected", tone: "rejected", hint: "Open Edit to read the reviewer’s note." },
  unpublished: { label: "Unpublished", tone: "neutral", hint: "Taken off Sheltüh. Edit it, then submit it again." },
};

/**
 * The event's state for the organiser. A draft that has been approved before
 * (`ticketingLocked`: an approval is in its log) was unpublished: the only
 * way from published back to draft is a takedown.
 */
export function organiserEventStatus(event: Pick<EventRecord, "status" | "ticketingLocked">): OrganiserEventStatus {
  const state: OrganiserEventState = event.status === "draft" && event.ticketingLocked === true ? "unpublished" : event.status;
  return { state, ...STATUS[state] };
}

/** The organiser can save changes in the editor (PATCH /api/events/{id}): a draft or rejected event only. */
export function canEditEvent(event: Pick<EventRecord, "status">): boolean {
  return event.status === "draft" || event.status === "rejected";
}

export type OrganiserEventActionKind = "edit" | "view" | "analytics" | "check-in" | "seat-map" | "public-page";

export interface OrganiserEventAction {
  kind: OrganiserEventActionKind;
  /** The visible words. */
  label: string;
  /** The accessible name: the words and the event ("Edit Night Market"), so a list of links is unambiguous. */
  name: string;
  href: string;
}

/**
 * The actions that apply to this event, in a fixed order, the main one first:
 * Edit (draft, rejected), View submission (pending), or View public page
 * (published; View, for the read-only editor, only if it has no slug).
 */
export function organiserEventActions(
  event: Pick<EventRecord, "eventId" | "slug" | "title" | "status" | "ticketingMode" | "seating">,
): OrganiserEventAction[] {
  const title = event.title || "Untitled event";
  const id = encodeURIComponent(event.eventId);
  const external = event.ticketingMode === "external";
  const published = event.status === "published";
  const actions: OrganiserEventAction[] = [];

  const publicPage: OrganiserEventAction | null =
    published && event.slug
      ? {
          kind: "public-page",
          label: "View public page",
          name: `View public page for ${title}`,
          href: `/events/${encodeURIComponent(event.slug)}`,
        }
      : null;

  if (canEditEvent(event)) {
    actions.push({ kind: "edit", label: "Edit", name: `Edit ${title}`, href: `/dashboard/${id}` });
  } else if (publicPage) {
    actions.push(publicPage);
  } else if (event.status === "pending_review") {
    actions.push({ kind: "view", label: "View submission", name: `View submission for ${title}`, href: `/dashboard/${id}` });
  } else {
    actions.push({ kind: "view", label: "View", name: `View ${title}`, href: `/dashboard/${id}` });
  }
  actions.push({ kind: "analytics", label: "Analytics", name: `Analytics for ${title}`, href: `/dashboard/events/${id}/analytics` });
  if (published && !external) {
    actions.push({ kind: "check-in", label: "Check-in", name: `Check-in for ${title}`, href: `/dashboard/${id}/check-in` });
  }
  if (event.seating && !external) {
    actions.push({ kind: "seat-map", label: "Seat map", name: `Seat map for ${title}`, href: `/dashboard/${id}/seat-map` });
  }
  return actions;
}
