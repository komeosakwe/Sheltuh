import {
  MAX_UNDO_REASON_LENGTH,
  MIN_UNDO_REASON_LENGTH,
  type CheckInLogEntry,
  type CheckInOutcome,
  type CheckInResult,
  type CheckInSummary,
  type EventAttendance,
  type SeatKind,
  type UndoCheckInOutcome,
  type UndoCheckInResult,
} from "@/lib/api/types";
import { parseTicketCode } from "@/lib/ticket-code";
import { requireCaller, type Caller } from "../auth";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { fail } from "../validation";
import { requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";

/**
 * Ticket check-in at the door (docs/architecture.md, "Check-in";
 * supabase/migrations/20261021000000_ticket_check_in.sql,
 * 20261021130000_check_in_followups.sql and 20261023000100_review_hardening.sql).
 *
 * The approved organiser who owns the event, and admins for platform-managed
 * organisers' events (no owner account; owner decision, docs/FEATURE_PLAN.md),
 * only: another organiser's event is a 404 (for an admin too), a non-admin
 * without an approved organiser a 403, signed out a 401. An admin is the
 * acting account: the log records them, and the rate limit is theirs.
 *
 * Every ticket outcome is a 200 with a CheckInResult. An HTTP error only ever
 * means "couldn't verify": nothing was marked, and the door should treat it as
 * such (400 malformed request, 404, 409 a request id reused for another code,
 * 413, 429 over the allowance). Every
 * response is `private, no-store`, and none carries a buyer's name or email,
 * an order id, or (in the log) more than a code's last four characters.
 * Check-in ids are the log's random public ids, never its sequential key.
 */

/** Per acting account, shared by check-ins and undos (take_rate_limit bucket 'check_in'). */
export const CHECK_IN_LIMIT = { limit: 600, window: "5 minutes" } as const;

/** A scan request is a code and a uuid: far below this. */
export const MAX_CHECK_IN_BODY_BYTES = 1024;
const MAX_UNDO_BODY_BYTES = 4096;

/** Newest log entries in the summary. */
export const RECENT_CHECK_INS = 20;

const EVENT_NOT_FOUND = "Event not found.";
const RATE_LIMITED = "Too many check-ins in a few minutes. Wait a moment, then try again.";
const REQUEST_CONFLICT = "This request id was already used for a different code. Scan again.";

const iso = (v: string | Date) => new Date(v).toISOString();

/** External ticketing: Sheltüh issues no tickets for the event, so there's nothing to check in. */
export const EXTERNAL_CHECK_IN_REFUSED =
  "Tickets for this event are sold on another site, so there's no Sheltüh check-in for it.";

/**
 * 409 for the organiser's own external event. Anything else (not theirs, no
 * such event) is left to the caller's own 404. Only read once an undo has
 * found nothing (an external event has no admissions), so it costs nothing
 * on the normal path; a scan of an external event is refused by the
 * ticket_check_ins_guard trigger instead.
 */
async function refuseExternalEvent(db: Db, organiserId: string, eventId: string): Promise<void> {
  const [row] = await db.query<{ ticketing_mode: string }>(
    `select e.ticketing_mode from public.events e where e.id = $1 and e.organiser_id = $2`,
    [eventId, organiserId],
  );
  if (row?.ticketing_mode === "external") throw new HttpError(409, EXTERNAL_CHECK_IN_REFUSED);
}

/**
 * Who's at the door, and the organiser whose event it must be (passed to
 * private.check_in_ticket / undo_check_in, which check it again, and
 * ticket_check_ins_guard, which refuses an admin on an organiser's event and
 * anyone else on a platform-managed one).
 *
 * Not an admin: their own approved organiser (403 otherwise); whether the
 * event is theirs is left to the caller (404). An admin: the event is read
 * first; a platform-managed organiser's event is checked in as that
 * organiser, an event of their own organiser (an admin who's also an
 * organiser) as usual, and anything else is a 404.
 */
async function doorCaller(req: Request, deps: Deps, eventId: string): Promise<{ caller: Caller; organiserId: string }> {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  if (!caller.isAdmin) {
    const organiser = await requireApprovedOrganiser(deps.db, caller);
    return { caller, organiserId: organiser.organiserId };
  }
  const [event] = isUuid(eventId)
    ? await deps.db.query<{ organiser_id: string; owner_user_id: string | null }>(
        `select e.organiser_id, o.owner_user_id
           from public.events e join public.organisers o on o.id = e.organiser_id
          where e.id = $1`,
        [eventId],
      )
    : [];
  if (event?.owner_user_id === null) return { caller, organiserId: event.organiser_id };
  if (event && event.owner_user_id === caller.userId) {
    const organiser = await requireApprovedOrganiser(deps.db, caller);
    return { caller, organiserId: organiser.organiserId };
  }
  throw new HttpError(404, EVENT_NOT_FOUND);
}

/**
 * ticket_check_ins_guard refused the actor (an admin on an organiser's event,
 * or anyone else on a platform-managed one): the API checked first, so this
 * only answers a race or a bug, as the 404 the API would have given.
 * Nothing was logged or counted (the whole call rolled back).
 */
function isActorRefused(err: unknown): boolean {
  return pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "ticket_check_ins_actor_allowed";
}

interface CheckInRow {
  result: CheckInOutcome | "not_found" | "rate_limited" | "conflict";
  admission_id: string | null;
  ticket_type_name: string | null;
  ticket_number: number | null;
  ticket_count: number | null;
  code_last4: string | null;
  first_checked_in_at: string | Date | null;
  other_event_title: string | null;
  seat_section: string | null;
  seat_row: string | null;
  seat_label: string | null;
  seat_kind: string | null;
}

function toCheckInResult(row: CheckInRow): CheckInResult {
  const outcome = row.result as CheckInOutcome;
  // Unknown codes and other organisers' tickets must be indistinguishable: nothing but the outcome.
  if (outcome === "invalid") return { outcome };
  const result: CheckInResult = {
    outcome,
    ticket: {
      ticketTypeName: row.ticket_type_name as string,
      ticketNumber: row.ticket_number as number,
      ticketCount: row.ticket_count as number,
      codeLast4: row.code_last4 as string,
      // Reserved seating: where to send them (absent for general admission).
      ...(row.seat_section !== null && row.seat_section !== undefined
        ? {
            seat: {
              section: row.seat_section,
              row: row.seat_row ?? "",
              seat: row.seat_label as string,
              kind: (row.seat_kind ?? "standard") as SeatKind,
            },
          }
        : {}),
    },
  };
  // The admission an undo reverses: this one, or the ticket's current one when it's already in.
  if ((outcome === "admitted" || outcome === "already_checked_in") && row.admission_id) {
    result.checkInId = row.admission_id;
  }
  if ((outcome === "admitted" || outcome === "already_checked_in") && row.first_checked_in_at) {
    result.checkedInAt = iso(row.first_checked_in_at);
  }
  if (outcome === "other_event" && row.other_event_title) result.otherEventTitle = row.other_event_title;
  return result;
}

/**
 * POST /api/organisers/me/events/[eventId]/check-ins `{code, requestId}`.
 * `code` must be a string (what was scanned or typed; anything that isn't a
 * ticket code is the `invalid` outcome, not an error) and `requestId` a uuid,
 * else 400. Ownership is checked inside private.check_in_ticket, in the same
 * transaction. A request id already logged for this event with a different
 * code is a 409 (a retry always resends its own code).
 */
export const checkInTicket: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { caller, organiserId } = await doorCaller(req, deps, eventId);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const body = await readJson(req, MAX_CHECK_IN_BODY_BYTES);

  const errors: Record<string, string> = {};
  if (typeof body.code !== "string") errors.code = "Scan or enter a ticket code.";
  if (typeof body.requestId !== "string" || !isUuid(body.requestId)) errors.requestId = "Invalid request id.";
  if (Object.keys(errors).length > 0) fail(errors);

  let row: CheckInRow;
  try {
    [row] = await deps.db.query<CheckInRow>(
      `select result, admission_id::text as admission_id, ticket_type_name, ticket_number, ticket_count, code_last4,
              first_checked_in_at, other_event_title, seat_section, seat_row, seat_label, seat_kind
         from private.check_in_ticket($1, $2, $3, $4, $5::uuid, $6, $7::interval)`,
      [
        eventId,
        organiserId,
        caller.userId,
        parseTicketCode(body.code),
        body.requestId,
        CHECK_IN_LIMIT.limit,
        CHECK_IN_LIMIT.window,
      ],
    );
  } catch (err) {
    // The ticket_check_ins_guard trigger: the organiser's event is external.
    // Nothing was logged or counted (the whole call rolled back).
    if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "ticket_check_ins_sheltuh_only") {
      throw new HttpError(409, EXTERNAL_CHECK_IN_REFUSED);
    }
    if (isActorRefused(err)) throw new HttpError(404, EVENT_NOT_FOUND);
    throw err;
  }
  if (row.result === "not_found") throw new HttpError(404, EVENT_NOT_FOUND);
  if (row.result === "rate_limited") throw new HttpError(429, RATE_LIMITED);
  if (row.result === "conflict") throw new HttpError(409, REQUEST_CONFLICT);
  return okPrivate(toCheckInResult(row));
};

/**
 * POST /api/organisers/me/events/[eventId]/check-ins/[checkInId]/undo
 * `{reason}`: reverses an admission (`checkInId`: its public id, a uuid).
 * 200 with the outcome (`undone`, `not_checked_in`, `superseded`); 400
 * reason missing, under 3 or over 200 characters, or with control/invisible
 * characters; 404 not the caller's event, or no such admission in it
 * (including anything that isn't a uuid, such as an old numeric id); 429
 * over the allowance.
 */
export const undoCheckIn: Handler<{ eventId: string; checkInId: string }> = async (
  req,
  { eventId, checkInId },
  deps,
) => {
  const { caller, organiserId } = await doorCaller(req, deps, eventId);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const body = await readJson(req, MAX_UNDO_BODY_BYTES);

  const errors: Record<string, string> = {};
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_UNDO_REASON_LENGTH,
  });
  if (!errors.reason && Array.from(reason).length < MIN_UNDO_REASON_LENGTH) {
    errors.reason = `Write at least ${MIN_UNDO_REASON_LENGTH} characters.`;
  }
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(checkInId)) throw new HttpError(404, "Check-in not found.");

  type UndoRow = {
    result: UndoCheckInOutcome | "not_found" | "rate_limited";
    check_in_id: string | null;
    ticket_type_name: string | null;
    code_last4: string | null;
  };
  let row: UndoRow;
  try {
    [row] = await deps.db.query<UndoRow>(
      `select result, check_in_id::text as check_in_id, ticket_type_name, code_last4
         from private.undo_check_in($1, $2, $3, $4::uuid, $5, $6, $7::interval)`,
      [eventId, organiserId, caller.userId, checkInId, reason, CHECK_IN_LIMIT.limit, CHECK_IN_LIMIT.window],
    );
  } catch (err) {
    if (isActorRefused(err)) throw new HttpError(404, "Check-in not found.");
    throw err;
  }
  if (row.result === "not_found") {
    // An external event has no admissions: say why, rather than "not found".
    await refuseExternalEvent(deps.db, organiserId, eventId);
    throw new HttpError(404, "Check-in not found.");
  }
  if (row.result === "rate_limited") throw new HttpError(429, RATE_LIMITED);
  const result: UndoCheckInResult = {
    outcome: row.result,
    ...(row.result === "undone" ? { checkInId: row.check_in_id as string } : {}),
    ticket: { ticketTypeName: row.ticket_type_name as string, codeLast4: row.code_last4 as string },
  };
  return okPrivate(result);
};

async function ticketTypeCounts(db: Db, eventId: string) {
  return db.query<{ id: string; name: string; capacity: number; sold: number; checked_in: number }>(
    `select tt.id, tt.name, tt.quantity_available as capacity,
            count(o.id)::int as sold,
            count(o.id) filter (where t.checked_in_at is not null)::int as checked_in
       from public.ticket_types tt
       left join public.tickets t on t.event_id = tt.event_id and t.ticket_type_id = tt.id
       left join public.orders o on o.id = t.order_id and o.status = 'paid'
      where tt.event_id = $1
      group by tt.id, tt.name, tt.quantity_available, tt.position
      order by tt.position, tt.id`,
    [eventId],
  );
}

/**
 * GET /api/organisers/me/events/[eventId]/check-ins: counts (tickets of paid
 * orders, checked in and sold, per ticket type, with capacity) and the
 * newest 20 log entries, showing only the last four characters of codes.
 */
export const getCheckInSummary: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { organiserId } = await doorCaller(req, deps, eventId);
  const event = await requireOwnEvent(deps.db, organiserId, eventId);
  if (event.ticketingMode === "external") throw new HttpError(409, EXTERNAL_CHECK_IN_REFUSED);

  const [types, recent] = await Promise.all([
    ticketTypeCounts(deps.db, event.eventId),
    deps.db.query<{
      id: string;
      result: CheckInLogEntry["result"];
      created_at: string | Date;
      code_last4: string | null;
      ticket_type_name: string | null;
      other_event_title: string | null;
      reason: string | null;
      undoable: boolean;
    }>(
      `select c.public_id::text as id, c.result, c.created_at, right(c.ticket_code, 4) as code_last4, c.reason,
              t.ticket_type_name,
              case when c.result = 'other_event' then e.title end as other_event_title,
              (c.result = 'admitted' and t.checked_in_at is not null
                 and not exists (select 1 from public.ticket_check_ins l
                                  where l.ticket_code = c.ticket_code and l.result = 'admitted' and l.id > c.id)) as undoable
         from public.ticket_check_ins c
         left join public.tickets t on t.code = c.ticket_code
         left join public.events e on e.id = t.event_id
        where c.event_id = $1
        order by c.id desc
        limit $2`,
      [event.eventId, RECENT_CHECK_INS],
    ),
  ]);

  const byTicketType = types.map((t) => ({
    ticketTypeId: t.id,
    name: t.name,
    checkedIn: t.checked_in,
    ticketsSold: t.sold,
    capacity: t.capacity,
  }));
  const sum = (key: "checkedIn" | "ticketsSold" | "capacity") => byTicketType.reduce((n, t) => n + t[key], 0);
  const summary: CheckInSummary = {
    event: { eventId: event.eventId, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt },
    checkedIn: sum("checkedIn"),
    ticketsSold: sum("ticketsSold"),
    capacity: sum("capacity"),
    byTicketType,
    recent: recent.map((r) => ({
      checkInId: r.id,
      result: r.result,
      at: iso(r.created_at),
      codeLast4: r.code_last4,
      ticketTypeName: r.ticket_type_name,
      ...(r.other_event_title ? { otherEventTitle: r.other_event_title } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      undoable: r.undoable === true,
    })),
  };
  return okPrivate(summary);
};

/** EventAnalytics.attendance (all-time, paid orders): null when no tickets have been sold. */
export async function eventAttendance(db: Db, eventId: string): Promise<EventAttendance | null> {
  const types = await ticketTypeCounts(db, eventId);
  const ticketsSold = types.reduce((n, t) => n + t.sold, 0);
  if (ticketsSold === 0) return null;
  return {
    checkedIn: types.reduce((n, t) => n + t.checked_in, 0),
    ticketsSold,
    byTicketType: types.map((t) => ({ ticketTypeId: t.id, name: t.name, checkedIn: t.checked_in, ticketsSold: t.sold })),
  };
}
