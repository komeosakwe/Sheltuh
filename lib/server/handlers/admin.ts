import { requireAdmin, type Caller } from "../auth";
import type { Deps } from "../deps";
import { HttpError, ok, readJson } from "../http";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, ORGANISER_SELECT, toEvent, toOrganiser } from "../records";
import type { Handler } from "../route";
import type { EventStatus, OrganiserStatus } from "../types";
import { fail, requireString } from "../validation";
import { requireEvent } from "./event-queries";
import { findOrganiserById } from "./organiser-guard";

const ORGANISER_STATUSES: OrganiserStatus[] = ["pending", "approved", "rejected"];
const EVENT_STATUSES: EventStatus[] = ["draft", "pending_review", "published", "rejected"];

async function requireReason(req: Request): Promise<string> {
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const reason = requireString(body.reason, "reason", errors, 1000);
  if (Object.keys(errors).length > 0) fail(errors);
  return reason;
}

// ---------------------------------------------------------------------------
// Organiser applications
// ---------------------------------------------------------------------------

/** GET /api/admin/organisers?status=pending — most recently updated first. */
export const adminListOrganisers: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "pending") as OrganiserStatus;
  if (!ORGANISER_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${ORGANISER_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const rows = await db.query(
    `${ORGANISER_SELECT} where o.status = $1::public.organiser_status
     order by o.updated_at desc, o.id limit $2 offset $3`,
    [status, limit + 1, offset],
  );
  return ok(toPage(rows.map(toOrganiser), offset, limit));
};

/**
 * Conditional on the application still being pending, so two admins
 * reviewing at once can't both decide — the second gets a 409.
 */
async function reviewOrganiser(
  admin: Caller,
  organiserId: string,
  deps: Deps,
  decision: { status: "approved" } | { status: "rejected"; reason: string },
) {
  const reason = decision.status === "rejected" ? decision.reason : null;
  const rows = isUuid(organiserId)
    ? await deps.db.query(
        `update public.organisers
         set status = $2::public.organiser_status, rejection_reason = $3, reviewed_by = $4, reviewed_at = now()
         where id = $1 and status = 'pending'
         returning id`,
        [organiserId, decision.status, reason, admin.userId],
      )
    : [];
  if (rows.length === 0) {
    throw new HttpError(409, "This application is no longer pending — it may already have been reviewed.");
  }
  return ok(await findOrganiserById(deps.db, organiserId));
}

/** POST /api/admin/organisers/[organiserId]/approve */
export const adminApproveOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return reviewOrganiser(admin, organiserId, deps, { status: "approved" });
};

/** POST /api/admin/organisers/[organiserId]/reject — body { reason } */
export const adminRejectOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const reason = await requireReason(req);
  return reviewOrganiser(admin, organiserId, deps, { status: "rejected", reason });
};

// ---------------------------------------------------------------------------
// Event submissions
// ---------------------------------------------------------------------------

/** GET /api/admin/events?status=pending_review — soonest first. */
export const adminListEvents: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "pending_review") as EventStatus;
  if (!EVENT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${EVENT_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const rows = await db.query(
    `${EVENT_SELECT} where e.status = $1::public.event_status
     order by e.starts_at, e.id limit $2 offset $3`,
    [status, limit + 1, offset],
  );
  return ok(toPage(rows.map(toEvent), offset, limit));
};

interface Moderation {
  from: EventStatus;
  to: EventStatus;
  action: "approved" | "rejected" | "unpublished";
}

async function moderateEvent(
  admin: Caller,
  eventId: string,
  deps: Deps,
  { from, to, action }: Moderation,
  reason: string | null = null,
) {
  await requireEvent(deps.db, eventId);
  const [row] = await deps.db.query<{ moved: boolean }>(
    `select private.transition_event($1, array[$2::public.event_status], $3::public.event_status,
       $4::public.moderation_action, $5, $6) as moved`,
    [eventId, from, to, action, admin.userId, reason],
  );
  if (!row.moved) {
    throw new HttpError(409, `This event is no longer ${from.replace("_", " ")} — it may already have been reviewed.`);
  }
  return ok(await requireEvent(deps.db, eventId));
}

/** POST /api/admin/events/[eventId]/approve — publishes it. */
export const adminApproveEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return moderateEvent(admin, eventId, deps, { from: "pending_review", to: "published", action: "approved" });
};

/** POST /api/admin/events/[eventId]/reject — body { reason } */
export const adminRejectEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const reason = await requireReason(req);
  return moderateEvent(admin, eventId, deps, { from: "pending_review", to: "rejected", action: "rejected" }, reason);
};

/** POST /api/admin/events/[eventId]/unpublish — back to draft, not deleted, so the organiser can resubmit. */
export const adminUnpublishEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return moderateEvent(admin, eventId, deps, { from: "published", to: "draft", action: "unpublished" });
};
