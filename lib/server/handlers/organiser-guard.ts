import { requireCaller, type Caller } from "../auth";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { HttpError } from "../http";
import { isUuid } from "../pagination";
import { ORGANISER_SELECT, toOrganiser } from "../records";
import type { OrganiserRecord } from "../types";

export async function findOrganiserByOwner(db: Db, userId: string): Promise<OrganiserRecord | undefined> {
  const [row] = await db.query(`${ORGANISER_SELECT} where o.owner_user_id = $1`, [userId]);
  return row ? toOrganiser(row) : undefined;
}

export async function findOrganiserById(db: Db, organiserId: string): Promise<OrganiserRecord | undefined> {
  const [row] = await db.query(`${ORGANISER_SELECT} where o.id = $1`, [organiserId]);
  return row ? toOrganiser(row) : undefined;
}

/** The caller's own organiser record, which must be approved. */
export async function requireApprovedOrganiser(db: Db, caller: Caller): Promise<OrganiserRecord> {
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record || record.status !== "approved") {
    throw new HttpError(403, "Your organiser application must be approved before you can submit events.");
  }
  return record;
}

/**
 * Who is acting on an event (check-in at the door, the Orders view), and the organiser whose event it must be (passed to
 * private.check_in_ticket / undo_check_in, which check it again, and
 * ticket_check_ins_guard, which refuses an admin on an organiser's event and
 * anyone else on a platform-managed one).
 *
 * Not an admin: their own approved organiser (403 otherwise); whether the
 * event is theirs is left to the caller (404). An admin: the event is read
 * first; a platform-managed organiser's event is acted on as that
 * organiser, an event of their own organiser (an admin who's also an
 * organiser) as usual, and anything else is a 404.
 */
export async function requireEventOperator(req: Request, deps: Deps, eventId: string): Promise<{ caller: Caller; organiserId: string }> {
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
  throw new HttpError(404, "Event not found.");
}
