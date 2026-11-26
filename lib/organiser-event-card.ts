import { ORGANISER_EVENT_FILTERS, type EventStatus, type OrganiserEventFilter, type OrganiserEventStage, type OrganiserEventSummary } from "./api/types";
import { organiserEventActions, type OrganiserEventAction } from "./organiser-events";

/**
 * What the Events tab's card says and offers beyond Latte's drawn parts (organiser-dashboard plan
 * §2.3: "keep the next-step line and rejection reason on the card so nothing is lost"), from the
 * events summary (lib/api/organiser-summary.ts).
 */

/** The event's status as the rest of the dashboard knows it (lib/organiser-events.ts), from its stage. */
export function stageStatus(stage: OrganiserEventStage): EventStatus {
  switch (stage) {
    case "live":
    case "sold_out":
    case "ended":
      return "published";
    case "in_review":
      return "pending_review";
    case "changes_needed":
      return "rejected";
    case "draft":
    case "unpublished":
      return "draft";
  }
}

/** A card's next-step line, as the dashboard has always said it (lib/organiser-events.ts). */
export interface StageHint {
  text: string;
  /** The line goes on with "Contact Sheltüh to change it.", the first two words a link to Sheltüh's support email. */
  contactToChange?: boolean;
}

/**
 * The line on what happens next, as the events list always said it: a published event (Live, Sold
 * out, Ended) is "Live on Sheltüh." with how to change it (Contact Sheltüh); the undrawn stages say
 * what to do. A draft says nothing more: its pill and "Continue →" say it.
 */
export function stageHint(stage: OrganiserEventStage): StageHint | null {
  switch (stage) {
    case "live":
    case "sold_out":
    case "ended":
      return { text: "Live on Sheltüh.", contactToChange: true };
    case "in_review":
      return { text: "Sheltüh is checking it before it goes live. You can’t edit it until then." };
    case "changes_needed":
      return { text: "Make the changes Sheltüh asked for, then send it for review again." };
    case "unpublished":
      return { text: "Taken off Sheltüh. Edit it, then send it for review." };
    case "draft":
      return null;
  }
}

/**
 * The Events tab's filter from the address (`?filter=`): `live`, `drafts` or `past`; anything else,
 * none, or more than one (the first counts) is All.
 */
export function eventsFilterFrom(value: string | readonly string[] | null | undefined): OrganiserEventFilter {
  const first = typeof value === "string" ? value : value?.[0];
  return (ORGANISER_EVENT_FILTERS as readonly string[]).includes(first ?? "") ? (first as OrganiserEventFilter) : "all";
}

/**
 * A draft (or an event sent back) with paid tickets sold on Sheltüh, while payouts aren't set up: it
 * can't be published until they are. Paid: it has tickets on sale and they aren't all free.
 */
export function needsPayouts(
  event: Pick<OrganiserEventSummary, "stage" | "ticketingMode" | "free" | "capacity">,
  payoutsEnabled: boolean,
): boolean {
  const unpublished = event.stage === "draft" || event.stage === "unpublished" || event.stage === "changes_needed";
  return !payoutsEnabled && unpublished && event.ticketingMode !== "external" && !event.free && event.capacity > 0;
}

/**
 * The card's other actions, in the dashboard's fixed order (lib/organiser-events.ts): View public page,
 * QR code, Orders, Analytics, Check-in. The editor ("Manage →" / "Continue →") is the card's own link, so it isn't
 * repeated. The seat map isn't here (the summary doesn't say which events have one): it's on the event's
 * own page, through Manage.
 */
export function cardMenuActions(event: Pick<OrganiserEventSummary, "eventId" | "slug" | "title" | "stage" | "ticketingMode">): OrganiserEventAction[] {
  return organiserEventActions({
    eventId: event.eventId,
    slug: event.slug,
    title: event.title,
    status: stageStatus(event.stage),
    ticketingMode: event.ticketingMode,
  }).filter((action) => action.kind !== "edit" && action.kind !== "view");
}
