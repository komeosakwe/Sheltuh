/**
 * Sequential ticket releases (docs/architecture.md, "Sequential ticket
 * releases"; supabase/migrations/20261117000000_ticket_release_lock.sql): an
 * organiser makes one general admission ticket type of their own published
 * event wait for the one above it to sell out, or stops it waiting. Allowed
 * when the tier already has sales (it only affects new orders). Everything is
 * rechecked, under locks, in private.set_ticket_lock.
 */
import type { TicketLockResult } from "@/lib/api/types";
import { requireCaller } from "../auth";
import { HttpError, okPrivate, readJson } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { fail } from "../validation";
import { requireApprovedOrganiser } from "./organiser-guard";

/** Per organiser account (take_rate_limit bucket 'ticket_locks'). */
export const LOCK_LIMIT = { limit: 30, window: "1 hour" } as const;
/** Per event (take_event_rate_limit bucket 'ticket_locks'): each change adds an entry to the event's log. */
export const EVENT_LOCK_LIMIT = { limit: 10, window: "24 hours" } as const;
/** Control characters (NUL included) can't be in a ticket type id we'd have stored. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const NOT_FOUND = "Ticket type not found.";
const RATE_LIMITED = "Too many changes. Try again later.";

export const setTicketLock: Handler<{ eventId: string; ticketTypeId: string }> = async (
  req,
  { eventId, ticketTypeId },
  deps,
) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const body = await readJson(req);
  const locked = body.opensAfterPrevious;
  if (typeof locked !== "boolean") fail({ opensAfterPrevious: "Must be true or false." });
  if (!isUuid(eventId) || ticketTypeId.length < 1 || ticketTypeId.length > 100 || CONTROL_CHARS.test(ticketTypeId)) {
    throw new HttpError(404, NOT_FOUND);
  }

  const [row] = await deps.db.query<{
    result: string;
    locked: boolean | null;
    blocker_id: string | null;
    blocker_name: string | null;
  }>(
    `select result, locked, blocker_id, blocker_name
       from private.set_ticket_lock($1, $2, $3, $4, $5, $6, $7::interval, $8, $9::interval)`,
    [
      eventId,
      organiser.organiserId,
      caller.userId,
      ticketTypeId,
      locked,
      LOCK_LIMIT.limit,
      LOCK_LIMIT.window,
      EVENT_LOCK_LIMIT.limit,
      EVENT_LOCK_LIMIT.window,
    ],
  );

  switch (row.result) {
    case "set":
    case "unchanged":
      return okPrivate({
        eventId,
        ticketTypeId,
        opensAfterPrevious: locked,
        ...(row.locked && row.blocker_id !== null && row.blocker_name !== null
          ? { opensAfter: { ticketTypeId: row.blocker_id, name: row.blocker_name } }
          : {}),
      } satisfies TicketLockResult);
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "not_approved":
      throw new HttpError(403, "Your organiser application must be approved before you can change this.");
    case "not_published":
      throw new HttpError(409, "This can only be changed on a published event.");
    case "ended":
      throw new HttpError(409, "This event has ended.");
    case "external":
      throw new HttpError(409, "Tickets for this event are sold on another site.");
    case "seated":
      throw new HttpError(409, "Seated tickets are sold by seat, so they can't wait for another ticket to sell out.");
    case "first_tier":
      fail({ opensAfterPrevious: "The first ticket has nothing above it to wait for." });
    case "rate_limited":
      throw new HttpError(429, RATE_LIMITED);
  }
  throw new Error("set_ticket_lock returned an unknown result.");
};
