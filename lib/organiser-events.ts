import type { EventRecord, EventStatus } from "./api/types";

/**
 * What an organiser sees and can do for one of their events on the dashboard
 * (components/dashboard/OrganiserEventRow.tsx). The rules mirror the routes:
 *
 * - The editor (/dashboard/{id}) saves only a draft or rejected event; a
 *   pending or published one opens read-only (PATCH /api/events/{id} is a
 *   409), so its action is View, not Edit.
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
}

const STATUS: Record<OrganiserEventState, Omit<OrganiserEventStatus, "state">> = {
  draft: { label: "Draft", tone: "neutral", hint: "Finish it, then submit it for review." },
  pending_review: {
    label: "Waiting for review",
    tone: "pending",
    hint: "Sheltüh is reviewing it. You can’t edit it until then.",
  },
  published: { label: "Published", tone: "approved", hint: "Live on Sheltüh. Contact Sheltüh to change it." },
  rejected: { label: "Rejected", tone: "rejected", hint: "Read the reviewer’s note, edit it, then submit it again." },
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

/** The actions that apply to this event, in a fixed order: the main one (Edit or View) first. */
export function organiserEventActions(
  event: Pick<EventRecord, "eventId" | "slug" | "title" | "status" | "ticketingMode" | "seating">,
): OrganiserEventAction[] {
  const title = event.title || "Untitled event";
  const id = encodeURIComponent(event.eventId);
  const external = event.ticketingMode === "external";
  const published = event.status === "published";
  const actions: OrganiserEventAction[] = [];

  if (canEditEvent(event)) {
    actions.push({ kind: "edit", label: "Edit", name: `Edit ${title}`, href: `/dashboard/${id}` });
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
  if (published && event.slug) {
    actions.push({
      kind: "public-page",
      label: "View public page",
      name: `View public page for ${title}`,
      href: `/events/${encodeURIComponent(event.slug)}`,
    });
  }
  return actions;
}
