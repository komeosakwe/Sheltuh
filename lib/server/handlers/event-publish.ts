import type { PublishEventConflictCode, PublishEventResponse, PublishEventReviewReason } from "@/lib/api/types";
import { ticketProviderName } from "@/lib/ticketing";
import { requireCaller } from "../auth";
import { sendReviewEmailsSoon, sendSelfPublishEmailsSoon } from "../email-outbox";
import { HttpError, okPrivate } from "../http";
import { locationRequired } from "../location-refusal";
import { PAYOUTS_REQUIRED_TO_PUBLISH, payoutsRefused, payoutsRequired } from "../payouts-refusal";
import type { Handler } from "../route";
import type { EventRecord } from "../types";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";

/**
 * The organiser's publish (supabase/migrations/20261111000000_event_publish_now.sql).
 *
 * Keep this module light: it must not import ./events or ../event-input,
 * which load the suburb table (lib/location.ts), so this route's bundle stays
 * small (tests/server/event-publish.test.ts checks the import graph).
 */

/** private.publish_event's results ('submitted:<reason>' is read by parseSubmitted). */
type PublishResult =
  | "published"
  | "submitted"
  | "already_published"
  | "in_review"
  | "not_found"
  | "ended"
  | "payouts_required"
  | "location_required"
  | "stale";

/** The 409s' `code`s (lib/api/types.ts PublishEventConflictCode). */
export const PUBLISH_CONFLICT = {
  ended: "event_ended",
  inReview: "in_review",
  changed: "event_changed",
} as const satisfies Record<string, PublishEventConflictCode>;

export const EVENT_ENDED_CANT_PUBLISH = "This event has already ended, so it can't be published.";
export const EVENT_IN_REVIEW = "This event is already waiting for review. We'll publish it once it's been checked.";
export const EVENT_CHANGED_WHILE_PUBLISHING =
  "This event's ticket link changed while it was being published. Reload the page and try again.";

/** Why private.publish_event sent it to review ('submitted:<reason>'), in the order it checks them. */
export const PUBLISH_REVIEW_REASONS = [
  "review_required",
  "removed_before",
  "seated",
  "unknown_ticket_site",
  "first_paid_event",
  "daily_limit",
] as const satisfies readonly PublishEventReviewReason[];

/**
 * private.publish_event's result with a 'submitted:<reason>' read as
 * "submitted" and its reason (undefined for a reason this release doesn't
 * know, so a newer database never breaks the route).
 */
export function parsePublishResult(raw: string): { result: PublishResult; reviewReason?: PublishEventReviewReason } {
  if (!raw.startsWith("submitted:")) return { result: raw as PublishResult };
  const reason = raw.slice("submitted:".length);
  return { result: "submitted", reviewReason: PUBLISH_REVIEW_REASONS.find((r) => r === reason) };
}

/**
 * Whether the event's ticketing alone sends it to review: a ticket link on a
 * site that isn't a known ticketing site (ticketProviderName is null:
 * anything not in KNOWN_TICKETING_HOSTS, and every international name).
 */
export function needsTicketLinkReview(event: Pick<EventRecord, "ticketingMode" | "externalTicketUrl">): boolean {
  return event.ticketingMode === "external" && !!event.externalTicketUrl && ticketProviderName(event.externalTicketUrl) === null;
}

/**
 * POST /api/events/[eventId]/publish — an approved organiser's draft or
 * rejected event goes live now (private.publish_event: logged `approved` by
 * the organiser's own account; their followers are emailed, and the admins
 * get a "published by an organiser" email), or, when it needs a person, to
 * the review queue (status `pending_review`; the admins' review email): the
 * organiser's events are reviewed (an admin's switch), an admin rejected or
 * unpublished it last, it has a seat map, its ticket link is on a site that
 * isn't a known ticketing site, it's the organiser's first event with paid
 * Sheltüh tickets (no paid Sheltüh event of theirs approved by an admin
 * and not taken down since), or the account (10) or the platform (100) has
 * used up its publishes for 24 hours.
 *
 * 200 PublishEventResponse (`private, no-store`): the EventRecord,
 * `published` or `pending_review`, and when this call sent it to review,
 * `reviewReason` (PublishEventReviewReason: the first rule that applied);
 * an event already published is a 200 too (a repeat changes nothing). 401;
 * 403 not an approved organiser; 404 not theirs. 409 with `code`: `payouts_required`
 * (a paid Sheltüh ticket type, payouts not set up), `event_ended`,
 * `in_review` (already waiting), `event_changed` (its ticket link changed
 * after it was read here: try again), `location_required` (no confirmed venue
 * location: the organiser's pin; fieldErrors.location). The emails are sent after the
 * response (Deps.defer).
 */
export const publishEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const event = await requireOwnEvent(deps.db, organiser.organiserId, eventId);

  // The link judged here is passed on; private.publish_event refuses ('stale') if the stored one differs.
  const externalUrl = event.ticketingMode === "external" ? (event.externalTicketUrl ?? null) : null;
  let result: PublishResult;
  let reviewReason: PublishEventReviewReason | undefined;
  try {
    const [row] = await deps.db.query<{ result: string }>(
      `select private.publish_event($1, $2, $3, $4, $5) as result`,
      [eventId, organiser.organiserId, caller.userId, externalUrl, needsTicketLinkReview(event)],
    );
    ({ result, reviewReason } = parsePublishResult(row.result));
  } catch (err) {
    // Belt and braces: the events trigger (events_paid_tickets_need_payouts) behind private.publish_event's own check.
    payoutsRefused(err, PAYOUTS_REQUIRED_TO_PUBLISH);
  }

  switch (result) {
    case "not_found":
      throw new HttpError(404, "Event not found.");
    case "ended":
      throw new HttpError(409, EVENT_ENDED_CANT_PUBLISH, undefined, { code: PUBLISH_CONFLICT.ended });
    case "in_review":
      throw new HttpError(409, EVENT_IN_REVIEW, undefined, { code: PUBLISH_CONFLICT.inReview });
    case "stale":
      throw new HttpError(409, EVENT_CHANGED_WHILE_PUBLISHING, undefined, { code: PUBLISH_CONFLICT.changed });
    case "payouts_required":
      throw payoutsRequired(PAYOUTS_REQUIRED_TO_PUBLISH);
    case "location_required":
      throw locationRequired();
    case "published":
      sendSelfPublishEmailsSoon(deps);
      break;
    case "submitted":
      sendReviewEmailsSoon(deps, "event_review");
      break;
    case "already_published":
      break;
  }
  const response: PublishEventResponse = {
    ...(await requireEvent(deps.db, eventId)),
    ...(result === "submitted" && reviewReason ? { reviewReason } : {}),
  };
  return okPrivate(response);
};
