import type { EventRecord, EventStatus } from "./api/types";
import { ticketProviderName } from "./ticketing";

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
  draft: { label: "Draft", tone: "neutral", hint: "Finish it, then publish it." },
  pending_review: {
    label: "Waiting for review",
    tone: "pending",
    hint: "Sheltüh is checking it before it goes live. You can’t edit it until then.",
  },
  published: { label: "Published", tone: "approved", hint: "Live on Sheltüh.", contactToChange: true },
  rejected: {
    label: "Rejected",
    tone: "rejected",
    hint: "Open Edit to read Sheltüh’s note, then send it for review again.",
  },
  unpublished: {
    label: "Unpublished",
    tone: "neutral",
    hint: "Taken off Sheltüh. Edit it, then send it for review.",
  },
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

/**
 * Why publishing an event (POST /api/events/{id}/publish) sends it to the
 * review queue instead of putting it live, as far as the organiser's screen
 * can tell (private.publish_event decides; the API doesn't say why):
 *
 * - `rejected_before` / `unpublished_before`: Sheltüh rejected it, or took
 *   it down, last (the newest of its approved/rejected/unpublished log
 *   entries).
 * - `review_required`: an admin has turned on review of this organiser's
 *   events (OrganiserRecord.eventReviewRequired).
 * - `seated`: it has a seat map.
 * - `ticket_site`: its tickets are sold on a site that isn't a known
 *   ticketing site (as lib/server/handlers/event-publish.ts judges it).
 *
 * Only the API can tell (its publish response's `reviewReason`, apiReviewReason):
 *
 * - `daily_limit`: too many events were published in a day.
 * - `first_paid_event`: the organiser's first paid event sold on Sheltüh.
 *
 * Sent for review with none of these known, it's the general reason
 * (PUBLISH_REVIEW_GENERAL).
 */
export type PublishReviewReason =
  | "rejected_before"
  | "unpublished_before"
  | "review_required"
  | "seated"
  | "ticket_site"
  | "daily_limit"
  | "first_paid_event";

/** Sheltüh rejected or unpublished this event last (so publishing it again goes to review), or null. */
export function removedBefore(
  event: Pick<EventRecord, "status" | "moderationLog">,
): "rejected_before" | "unpublished_before" | null {
  if (event.status === "rejected") return "rejected_before";
  // Oldest first (the API's order): the newest decision wins.
  for (let i = event.moderationLog.length - 1; i >= 0; i--) {
    const action = event.moderationLog[i].action;
    if (action === "approved") return null;
    if (action === "rejected") return "rejected_before";
    if (action === "unpublished") return "unpublished_before";
  }
  return null;
}

/**
 * The reason the API gave for sending a publish to review (the publish
 * response's `reviewReason`), as the organiser's; null when it gave none, or
 * one this page doesn't know. `removed_before` is told apart by the event's
 * log (rejected, or taken down, last).
 */
export function apiReviewReason(
  reason: string | undefined,
  event: Pick<EventRecord, "status" | "moderationLog">,
): PublishReviewReason | null {
  switch (reason) {
    case "review_required":
    case "seated":
    case "daily_limit":
    case "first_paid_event":
      return reason;
    case "removed_before":
      return removedBefore(event) ?? "unpublished_before";
    case "unknown_ticket_site":
      return "ticket_site";
    default:
      return null;
  }
}

/** The first reason (in PublishReviewReason's order) this event goes to review when published, or null. */
export function publishReviewReason(
  event: Pick<EventRecord, "status" | "moderationLog" | "seating" | "ticketingMode" | "externalTicketUrl">,
  eventReviewRequired: boolean | undefined,
): PublishReviewReason | null {
  const removed = removedBefore(event);
  if (removed) return removed;
  if (eventReviewRequired === true) return "review_required";
  if (event.seating) return "seated";
  if (event.ticketingMode === "external" && event.externalTicketUrl && ticketProviderName(event.externalTicketUrl) === null) {
    return "ticket_site";
  }
  return null;
}

/** Why it's being checked first, in the organiser's words. */
export const PUBLISH_REVIEW_REASON_TEXT: Record<PublishReviewReason, string> = {
  rejected_before: "It wasn’t approved last time, so a person at Sheltüh checks it again before it goes live.",
  unpublished_before: "Sheltüh took it off the site before, so a person checks it before it goes back up.",
  review_required: "For now, a person at Sheltüh checks your events before they go live.",
  seated: "Events with a seat map are checked by a person before they go live.",
  ticket_site: "Its tickets are sold on a site we don’t know yet, so a person checks the link first.",
  daily_limit: "A lot of events were published in the last day, so a person checks this one before it goes live.",
  first_paid_event:
    "Your first paid event is checked by Sheltüh before it goes live. After that, your paid events publish straight away.",
};

/** When none of the reasons above is known (for example, a lot of events were published in one day). */
export const PUBLISH_REVIEW_GENERAL =
  "Some events are checked by a person before they go live, for example when a lot are published in one day.";
