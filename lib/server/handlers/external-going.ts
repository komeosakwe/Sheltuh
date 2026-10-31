import { requireCaller, requireVerifiedCaller } from "../auth";
import type { Db } from "../db";
import { HttpError, okPrivate, okPublic } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import type { ExternalGoingSummary, MyExternalGoing } from "../types";
import { GOING_COUNT_THRESHOLD } from "./going";
import { PUBLIC_EVENT_CACHE_CONTROL } from "./public-events";

/**
 * A count-only "going" for external-ticket events (docs/architecture.md,
 * "External ticketing"): signed-in members with a verified email tap "I'm
 * going", and the public sees how many, from GOING_COUNT_THRESHOLD. No names,
 * no profiles, no ticket check. Sheltüh-ticketed events keep the real Who's
 * Going (handlers/going.ts) and are `closed` here.
 */

const NOT_FOUND = "Event not found.";

/** Taps and undos allowed per member per window. A person taps a handful of events; this stops a script. */
export const EXTERNAL_GOING_RATE_LIMIT = { hits: 30, window: "1 hour" } as const;

interface StateRow {
  open: boolean;
  going_count: number;
  is_going: boolean;
}

/** The event's state for `userId` (null: the public), or undefined when the event isn't published. */
async function readState(db: Db, eventId: string, userId: string | null): Promise<StateRow | undefined> {
  const [row] = await db.query<StateRow>(`select open, going_count, is_going from private.external_going_state($1, $2)`, [
    eventId,
    userId,
  ]);
  return row;
}

async function takeRateLimit(db: Db, userId: string) {
  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'external_going', $2, $3::interval) as allowed`,
    [userId, EXTERNAL_GOING_RATE_LIMIT.hits, EXTERNAL_GOING_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");
}

const toMine = (row: StateRow): MyExternalGoing => ({ going: row.open && row.is_going, open: row.open });

/**
 * GET /api/events/[eventId]/external-going — public, cached like the event
 * page's data; only a count, and not even that below the threshold (`count`
 * 0, `countHidden` true). `closed` for an event that isn't external or has
 * ended. 404 unless the event is published.
 */
export const getExternalGoingSummary: Handler<{ eventId: string }> = async (_req, { eventId }, { db }) => {
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  const row = await readState(db, eventId, null);
  if (!row) throw new HttpError(404, NOT_FOUND);
  const countHidden = row.open && row.going_count < GOING_COUNT_THRESHOLD;
  const summary: ExternalGoingSummary = {
    count: row.open && !countHidden ? row.going_count : 0,
    closed: !row.open,
    countHidden,
  };
  return okPublic(summary, PUBLIC_EVENT_CACHE_CONTROL);
};

/** GET /api/events/[eventId]/external-going/me — whether the caller has tapped "I'm going". */
export const getMyExternalGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  const row = await readState(db, eventId, caller.userId);
  if (!row) throw new HttpError(404, NOT_FOUND);
  return okPrivate(toMine(row));
};

/**
 * PUT /api/events/[eventId]/external-going/me — "I'm going". Verified email
 * (403), rate-limited (429); the event must be published (404), external and
 * not ended (409), all re-checked under a lock by private.set_external_going.
 * Idempotent.
 */
export const putMyExternalGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  await takeRateLimit(db, caller.userId);

  const [{ result }] = await db.query<{ result: string }>(`select private.set_external_going($1, $2) as result`, [
    eventId,
    caller.userId,
  ]);
  switch (result) {
    case "going":
      break;
    case "event_unavailable":
      throw new HttpError(404, NOT_FOUND);
    case "not_external":
      throw new HttpError(409, "This event sells tickets on Sheltüh, so use Who's Going.");
    case "ended":
      throw new HttpError(409, "This event has ended.");
    case "user_unavailable":
      throw new HttpError(401, "Sign in again.");
    default:
      throw new Error(`Unexpected set_external_going result: ${result}`);
  }

  const row = await readState(db, eventId, caller.userId);
  if (!row) throw new HttpError(404, NOT_FOUND);
  return okPrivate(toMine(row));
};

/**
 * DELETE /api/events/[eventId]/external-going/me — undo. Idempotent, works in
 * any event state, needs no verified email (withdrawing is never blocked),
 * but shares the rate limit.
 */
export const deleteMyExternalGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  await takeRateLimit(db, caller.userId);
  await db.query(`select private.unset_external_going($1, $2)`, [eventId, caller.userId]);
  return okPrivate({ going: false, open: (await readState(db, eventId, caller.userId))?.open ?? false } satisfies MyExternalGoing);
};
