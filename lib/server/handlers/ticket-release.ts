/**
 * Releasing more tickets (docs/architecture.md, "Releasing more tickets";
 * supabase/migrations/20261112000000_release_tickets.sql): an organiser
 * raises one general admission ticket type's quantity on their own published
 * event. Everything is rechecked, under locks, in private.release_tickets.
 */
import type { ReleaseTicketsResult } from "@/lib/api/types";
import { requireCaller } from "../auth";
import { sendWaitlistEmailsSoon } from "../email-outbox";
import { HttpError, okPrivate, readJson } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { fail } from "../validation";
import { requireApprovedOrganiser } from "./organiser-guard";

/** Creating a ticket type has no upper bound beyond a whole number of 1 or more; a release has this one. */
export const MAX_TICKETS_PER_TYPE = 100_000;
/** Per organiser account (take_rate_limit bucket 'ticket_releases'). */
export const RELEASE_LIMIT = { limit: 30, window: "1 hour" } as const;

const NOT_FOUND = "Ticket type not found.";
const RATE_LIMITED = "Too many releases this hour. Try again later.";

export const releaseTickets: Handler<{ eventId: string; ticketTypeId: string }> = async (
  req,
  { eventId, ticketTypeId },
  deps,
) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const body = await readJson(req);
  const quantity = body.quantityAvailable;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    fail({ quantityAvailable: "Enter a whole number of tickets." });
  }
  if (quantity > MAX_TICKETS_PER_TYPE) {
    fail({ quantityAvailable: `Can't be more than ${MAX_TICKETS_PER_TYPE.toLocaleString("en-AU")}.` });
  }
  if (!isUuid(eventId) || ticketTypeId.length < 1 || ticketTypeId.length > 100) throw new HttpError(404, NOT_FOUND);

  const [row] = await deps.db.query<{ result: string; total: number | null; sold: number | null }>(
    `select result, total, sold from private.release_tickets($1, $2, $3, $4, $5, $6, $7, $8::interval)`,
    [
      eventId,
      organiser.organiserId,
      caller.userId,
      ticketTypeId,
      quantity,
      MAX_TICKETS_PER_TYPE,
      RELEASE_LIMIT.limit,
      RELEASE_LIMIT.window,
    ],
  );

  switch (row.result) {
    case "released":
      // The waitlist's emails were queued at commit (private.notify_waitlist); send them now.
      sendWaitlistEmailsSoon(deps);
      return okPrivate({
        eventId,
        ticketTypeId,
        quantityAvailable: row.total as number,
        quantitySold: row.sold as number,
      } satisfies ReleaseTicketsResult);
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "not_approved":
      throw new HttpError(403, "Your organiser application must be approved before you can release tickets.");
    case "not_published":
      throw new HttpError(409, "Tickets can only be released on a published event.");
    case "ended":
      throw new HttpError(409, "This event has ended.");
    case "external":
      throw new HttpError(409, "Tickets for this event are sold on another site.");
    case "seated":
      throw new HttpError(409, "Seated tickets follow the seat map. Change the seat map instead.");
    case "not_increase":
      fail({ quantityAvailable: `Enter more than the current ${row.total}.` });
    case "too_many":
      fail({ quantityAvailable: `Can't be more than ${MAX_TICKETS_PER_TYPE.toLocaleString("en-AU")}.` });
    case "rate_limited":
      throw new HttpError(429, RATE_LIMITED);
  }
  throw new Error("release_tickets returned an unknown result.");
};
