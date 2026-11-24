import type { EventStatus, OrganiserEventStage, OrganiserEventSummary } from "./api/types";
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

/**
 * The stages that aren't drawn get the line on what to do next they've always had on the dashboard.
 * Drawn ones (Live, Sold out, Draft, Ended) say nothing more, as drawn: their pill and "Manage →" /
 * "Continue →" say it.
 */
export function stageHint(stage: OrganiserEventStage): string | null {
  switch (stage) {
    case "in_review":
      return "Sheltüh is checking it before it goes live. You can’t edit it until then.";
    case "changes_needed":
      return "Make the changes Sheltüh asked for, then send it for review again.";
    case "unpublished":
      return "Taken off Sheltüh. Edit it, then send it for review.";
    default:
      return null;
  }
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
 * Orders, Analytics, Check-in. The editor ("Manage →" / "Continue →") is the card's own link, so it isn't
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
