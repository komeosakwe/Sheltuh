/**
 * Reserved seating: the seat map and its availability (docs/architecture.md,
 * "Reserved seating"; supabase/migrations/20261101000000_reserved_seating.sql
 * and 20261101000100_seat_holds.sql). The seated checkout itself is in
 * ./orders.ts and ./free-orders.ts.
 */
import { encodeAvailability } from "@/lib/seating/availability";
import type { SeatMapTemplate } from "@/lib/seating/template";
import { requireAdmin, requireCaller } from "../auth";
import { PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { sendWaitlistEmailsSoon } from "../email-outbox";
import { HttpError, noContentPrivate, okPrivate, PRIVATE_NO_STORE, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { MAX_SEAT_MAP_BODY_BYTES, parseSeatMapTemplate } from "../seat-map-input";
import type { SeatAvailability, SeatMapRecord } from "../types";
import { fail } from "../validation";
import { MAX_TICKETING_REASON_LENGTH } from "./admin";
import { requireEventForAdmin, requireOwnEvent } from "./event-queries";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";

const MAP_NOT_FOUND = "Seat map not found.";
const EVENT_NOT_FOUND = "Event not found.";

/**
 * A published event's map at its current version never changes (a new map is
 * a new version: the URL changes), so it's cached for a year. Anything else
 * (no `v`, or another version) is answered without caching, so a guessed
 * future version can't be cached with the current map in it.
 */
export const SEAT_MAP_CACHE = "public, max-age=31536000, immutable";
/** Availability: shared by every buyer, at most 5 seconds old at the CDN (docs/SEATING_PLAN.md). */
export const SEAT_AVAILABILITY_CACHE = "public, max-age=0, s-maxage=5";

interface MapMeta {
  status: string;
  organiser_id: string;
  version: number | null;
  seat_count: number | null;
}

async function readMapMeta(db: Db, eventId: string): Promise<MapMeta | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db.query<MapMeta>(
    `select e.status::text as status, e.organiser_id, m.version, m.seat_count
       from public.events e left join public.event_seat_maps m on m.event_id = e.id
      where e.id = $1`,
    [eventId],
  );
  return row;
}

/**
 * Before publishing, only the owning organiser or an admin (bearer token)
 * may see an event's map; anyone else, signed out included, gets the same
 * 404 as for an event that doesn't exist.
 */
async function requireOwnerOrAdmin(req: Request, deps: Deps, organiserId: string, notFound: string): Promise<void> {
  let caller;
  try {
    caller = await requireCaller(req, deps.verifyAccessToken);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(404, notFound);
    throw err;
  }
  if (caller.isAdmin) return;
  const organiser = await findOrganiserByOwner(deps.db, caller.userId);
  if (organiser?.organiserId !== organiserId) throw new HttpError(404, notFound);
}

async function readSeatMapRecord(db: Db, eventId: string): Promise<SeatMapRecord | undefined> {
  const [row] = await db.query<{ version: number; seat_count: number; layout: SeatMapTemplate }>(
    `select m.version, m.seat_count, m.layout from public.event_seat_maps m where m.event_id = $1`,
    [eventId],
  );
  return row ? { eventId, version: row.version, seatCount: row.seat_count, template: row.layout } : undefined;
}

/**
 * GET /api/events/[eventId]/seat-map[?v=version] — the map
 * (SeatMapRecord). Public once the event is published: cached for a year when
 * `v` is the current version, not cached otherwise. Before that, the owning
 * organiser or an admin only, never cached. 404 for no map.
 */
export const getSeatMap: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const meta = await readMapMeta(deps.db, eventId);
  if (!meta || meta.version === null) throw new HttpError(404, MAP_NOT_FOUND);
  const published = meta.status === "published";
  if (!published) await requireOwnerOrAdmin(req, deps, meta.organiser_id, MAP_NOT_FOUND);
  const record = await readSeatMapRecord(deps.db, eventId);
  if (!record) throw new HttpError(404, MAP_NOT_FOUND);
  const requested = new URL(req.url).searchParams.get("v");
  const cacheable = published && requested === String(record.version);
  return Response.json(record, {
    headers: cacheable ? { "cache-control": SEAT_MAP_CACHE } : PRIVATE_NO_STORE,
  });
};

/**
 * GET /api/events/[eventId]/seat-availability — SeatAvailability: one bit
 * per seat (lib/seating/availability.ts), set for sold, held (unexpired) and
 * blocked seats alike. Public for a published event (5 seconds at the CDN);
 * before that, the owner or an admin (for "preview as buyer"), not cached.
 */
export const getSeatAvailability: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const meta = await readMapMeta(deps.db, eventId);
  if (!meta || meta.version === null || meta.seat_count === null) throw new HttpError(404, MAP_NOT_FOUND);
  const published = meta.status === "published";
  if (!published) await requireOwnerOrAdmin(req, deps, meta.organiser_id, MAP_NOT_FOUND);
  // event_seats_pkey (event_id, …): one event's seats.
  const [row] = await deps.db.query<{ version: number; seat_count: number; unavailable: number[] }>(
    `select m.version, m.seat_count,
            coalesce((select array_agg(s.position)
                        from public.event_seats s
                       where s.event_id = m.event_id
                         and (s.blocked or s.sold_order_id is not null
                              or (s.hold_order_id is not null and s.hold_expires_at > now()))), '{}') as unavailable
       from public.event_seat_maps m where m.event_id = $1`,
    [eventId],
  );
  if (!row) throw new HttpError(404, MAP_NOT_FOUND);
  const body: SeatAvailability = {
    eventId,
    version: row.version,
    seatCount: row.seat_count,
    unavailable: encodeAvailability(row.seat_count, row.unavailable),
  };
  return Response.json(body, { headers: published ? { "cache-control": SEAT_AVAILABILITY_CACHE } : PRIVATE_NO_STORE });
};

/** The database refused a map: a ticket type changed under it, or more than 5 tiers. Otherwise rethrown. */
function mapWriteRefused(err: unknown): never {
  if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION && pgConstraint(err) === "event_seats_ticket_type_fkey") {
    throw new HttpError(409, "The event's ticket types changed while you were editing. Reload, then save the seat map again.");
  }
  if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "event_seat_maps_max_tiers") {
    throw new HttpError(400, "A seat map can use up to 5 price tiers.", { template: "A seat map can use up to 5 price tiers." });
  }
  if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "event_seat_maps_sheltuh_only") {
    throw new HttpError(409, EXTERNAL_NO_MAP);
  }
  throw err;
}

const EXTERNAL_NO_MAP = "Tickets for this event are sold on another site, so it can't have a seat map.";
export const SEAT_MAP_FROZEN =
  "This seat map is locked because the event has been approved. To change it, contact Sheltüh.";
const NOT_EDITABLE = "The seat map can't be changed while the event is pending review or published.";

function organiserMapRefusal(result: string): never | void {
  switch (result) {
    case "not_found":
      throw new HttpError(404, EVENT_NOT_FOUND);
    case "not_editable":
      throw new HttpError(409, NOT_EDITABLE);
    case "frozen":
      throw new HttpError(409, SEAT_MAP_FROZEN);
    case "external":
      throw new HttpError(409, EXTERNAL_NO_MAP);
  }
}

/**
 * PUT /api/events/[eventId]/seat-map `{template}` — the organiser's map for
 * their own event, while it's a draft (or rejected) that has never been
 * approved. Up to 1 MB; checked with lib/seating/template.ts against the
 * event's ticket types (400 fieldErrors `template.…`). Each seated tier's
 * capacity becomes its unblocked seats. 200 with the SeatMapRecord (the same
 * version when nothing changed); 404; 409 not editable, approved before
 * (locked) or external.
 */
export const putSeatMap: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  if (event.ticketingMode === "external") throw new HttpError(409, EXTERNAL_NO_MAP);
  if (event.ticketingLocked) throw new HttpError(409, SEAT_MAP_FROZEN);
  const body = await readJson(req, MAX_SEAT_MAP_BODY_BYTES);
  const { template } = parseSeatMapTemplate(body.template, event.ticketTypes);

  let result: string;
  try {
    const [row] = await db.query<{ result: string }>(
      `select private.replace_seat_map($1, $2, $3::text::jsonb) as result`,
      [eventId, organiser.organiserId, JSON.stringify(template)],
    );
    result = row.result;
  } catch (err) {
    mapWriteRefused(err);
  }
  organiserMapRefusal(result);
  const record = await readSeatMapRecord(db, eventId);
  if (!record) throw new Error("The saved seat map could not be read back.");
  return okPrivate(record);
};

/** DELETE /api/events/[eventId]/seat-map — same rules as PUT; 204, also when there's no map. */
export const deleteSeatMap: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  await requireOwnEvent(db, organiser.organiserId, eventId);
  const [row] = await db.query<{ result: string }>(`select private.delete_seat_map($1, $2) as result`, [
    eventId,
    organiser.organiserId,
  ]);
  organiserMapRefusal(row.result);
  return noContentPrivate();
};

const HAS_ORDERS = "This event has orders, so its seat map can't be replaced.";

function parseAdminReason(value: unknown): string {
  const errors: Record<string, string> = {};
  const reason = parseMessageText(value, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_TICKETING_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);
  return reason;
}

async function adminSeatMapChange(deps: Deps, eventId: string, adminId: string, template: SeatMapTemplate | null, reason: string) {
  let result: string;
  try {
    const [row] = await deps.db.query<{ result: string }>(
      `select private.admin_replace_seat_map($1, $2, $3::text::jsonb, $4) as result`,
      [eventId, adminId, template === null ? null : JSON.stringify(template), reason],
    );
    result = row.result;
  } catch (err) {
    mapWriteRefused(err);
  }
  if (result === "not_found") throw new HttpError(404, EVENT_NOT_FOUND);
  if (result === "external") throw new HttpError(409, EXTERNAL_NO_MAP);
  if (result === "has_orders") throw new HttpError(409, HAS_ORDERS, { template: HAS_ORDERS });
  // A published event's capacity may have grown: its waitlist may have been told (private.notify_waitlist).
  if (result === "saved" || result === "deleted") sendWaitlistEmailsSoon(deps);
}

/**
 * PUT /api/admin/events/[eventId]/seat-map `{template, reason}` — an admin's
 * replacement, any status, only while the event has no orders (409
 * otherwise, fieldErrors.template). Logged `edited` with the reason and
 * `changes.seatMap` (old and new version and seat count). 200 with the
 * SeatMapRecord; 400; 404.
 */
export const adminPutSeatMap: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const event = await requireEventForAdmin(deps.db, eventId);
  const body = await readJson(req, MAX_SEAT_MAP_BODY_BYTES);
  const errors: Record<string, string> = {};
  let template: SeatMapTemplate | undefined;
  try {
    template = parseSeatMapTemplate(body.template, event.ticketTypes).template;
  } catch (err) {
    if (!(err instanceof HttpError) || !err.fieldErrors) throw err;
    Object.assign(errors, err.fieldErrors);
  }
  try {
    parseAdminReason(body.reason);
  } catch (err) {
    if (!(err instanceof HttpError) || !err.fieldErrors) throw err;
    Object.assign(errors, err.fieldErrors);
  }
  if (Object.keys(errors).length > 0 || !template) fail(errors);
  await adminSeatMapChange(deps, eventId, admin.userId, template, parseAdminReason(body.reason));
  const record = await readSeatMapRecord(deps.db, eventId);
  if (!record) throw new Error("The saved seat map could not be read back.");
  return okPrivate(record);
};

/**
 * DELETE /api/admin/events/[eventId]/seat-map `{reason}` — removes the map
 * (the event becomes general admission; seated tiers keep their capacity),
 * only while the event has no orders. Logged like PUT. 204 (also with no
 * map: nothing logged); 400 reason; 404; 409 orders.
 */
export const adminDeleteSeatMap: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  await requireEventForAdmin(deps.db, eventId);
  const body = await readJson(req);
  const reason = parseAdminReason(body.reason);
  await adminSeatMapChange(deps, eventId, admin.userId, null, reason);
  return noContentPrivate();
};
