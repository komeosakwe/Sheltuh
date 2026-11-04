import { requireAdmin, requireCaller } from "../auth";
import type { Deps } from "../deps";
import { requireCronSecret } from "../cron-auth";
import { HttpError, okPrivate, readJson } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { sendOpsAlertsSoon } from "../email-outbox";
import { lookupOrderTransfer, runOrderTransfers, TRANSFER_DELAY, TRANSFER_DELAY_HOURS } from "../order-transfers";
import { orderReference } from "../order-reference";
import { stripeErrorLabel } from "../checkout-attempts";
import { ADMIN_TRANSFER_SELECT, toAdminTransfer } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";
import { findOrganiserByOwner } from "./organiser-guard";
import {
  TRANSFER_ACTIONS,
  TRANSFER_STATUSES,
  type AdminTransfersPage,
  type OrganiserPayouts,
  type TransferAction,
  type TransferStatus,
} from "@/lib/api/types";

/**
 * Delayed payouts' routes (docs/architecture.md, "Delayed payouts"): the cron
 * that sends the organisers' shares, the organiser's own payouts report, and
 * the admins' transfer queue. The transfers themselves are made by
 * lib/server/order-transfers.ts; every state change is a private.* function.
 */

const TRANSFER_NOT_FOUND = "Transfer not found.";
const TRANSFER_ID = /^[1-9][0-9]{0,17}$/;

/**
 * GET /api/cron/payouts — Vercel Cron, daily (vercel.json). Sends every
 * organiser share that is due (runOrderTransfers) and records the run for
 * GET /api/admin/transfers. Returns counts only. Safe to call more often and
 * from two schedulers at once: rows are leased with `skip locked`, and an
 * order has one transfer row, ever.
 */
export const runPayoutsCron: Handler = async (req, _params, deps) => {
  requireCronSecret(req, deps.cronSecret());
  const summary = await runOrderTransfers(deps);
  await deps.db.query(
    `insert into private.cron_runs (name, finished_at, claimed, sent, retrying, failed)
     values ('payouts', now(), $1, $2, $3, $4)
     on conflict (name) do update set finished_at = excluded.finished_at, claimed = excluded.claimed,
       sent = excluded.sent, retrying = excluded.retrying, failed = excluded.failed`,
    [summary.claimed, summary.sent, summary.retrying, summary.failed],
  );
  return okPrivate(summary);
};

/** The organiser's share of an order: what a destination charge would have paid them (total less support and the booking fee). */
const SHARE = "(o.total_cents - o.support_cents - o.application_fee_cents)";
/** A transfer order whose share the organiser hasn't been sent: no row yet, or one not sent or cancelled. */
const PENDING = "o.payout_method = 'transfer' and (t.id is null or t.status not in ('sent', 'cancelled'))";

/**
 * GET /api/organisers/me/payouts?limit&cursor — the caller's own money, per
 * event with paid orders, newest end first, and totals over all of them.
 * `paidOutCents`: orders paid out with their payment (destination charges);
 * `pendingCents`: orders waiting for their transfer (due 48 hours after the
 * event ends); `sentCents`: transferred (a transfer that reached Stripe after an admin cancelled the row counts: the organiser has it). 404 without an organiser
 * application (a pending or rejected one has no orders: empty). Amounts are
 * the organiser's share only. `private, no-store`.
 */
export const getMyPayouts: Handler = async (req, _params, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await findOrganiserByOwner(deps.db, caller.userId);
  if (!organiser) throw new HttpError(404, "No organiser application found.");
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const sums = `coalesce(sum(${SHARE}) filter (where o.payout_method = 'destination'), 0)::text as paid_out,
                coalesce(sum(${SHARE}) filter (where ${PENDING}), 0)::text as pending,
                coalesce(sum(${SHARE}) filter (where o.payout_method = 'transfer' and t.stripe_transfer_id is not null), 0)::text as sent`;
  const [totals] = await deps.db.query<{ paid_out: string; pending: string; sent: string }>(
    `select ${sums}
       from public.events e
       join public.orders o on o.event_id = e.id and o.status = 'paid' and o.total_cents > 0
       left join private.order_transfers t on t.order_id = o.id
      where e.organiser_id = $1`,
    [organiser.organiserId],
  );
  const rows = await deps.db.query<{
    id: string;
    title: string;
    ends_at: string | Date;
    paid_out: string;
    pending: string;
    sent: string;
    due_at: string | Date;
  }>(
    `select e.id, e.title, e.ends_at, ${sums}, e.ends_at + $4::interval as due_at
       from public.events e
       join public.orders o on o.event_id = e.id and o.status = 'paid' and o.total_cents > 0
       left join private.order_transfers t on t.order_id = o.id
      where e.organiser_id = $1
      group by e.id
      order by e.ends_at desc, e.id
      limit $2 offset $3`,
    [organiser.organiserId, limit + 1, offset, TRANSFER_DELAY],
  );
  const page = toPage(rows, offset, limit);
  const body: OrganiserPayouts = {
    delayedPayouts: deps.delayedPayouts(),
    payoutDelayHours: TRANSFER_DELAY_HOURS,
    totals: { paidOutCents: Number(totals.paid_out), pendingCents: Number(totals.pending), sentCents: Number(totals.sent) },
    items: page.items.map((row) => ({
      eventId: row.id,
      title: row.title,
      endsAt: new Date(row.ends_at).toISOString(),
      paidOutCents: Number(row.paid_out),
      pendingCents: Number(row.pending),
      sentCents: Number(row.sent),
      ...(Number(row.pending) > 0 ? { dueAt: new Date(row.due_at).toISOString() } : {}),
    })),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
  return okPrivate(body);
};

/** The default view of the admin list: what still needs sending or deciding. */
const OPEN_STATUSES: readonly TransferStatus[] = ["failed", "held", "retry", "sending"];

/**
 * GET /api/admin/transfers?status&limit&cursor — admin. Counts per status,
 * what the platform holds for organisers (`owedToOrganisersCents`), the last
 * run of the payouts cron, and a page of transfers: `status` is one of
 * TRANSFER_STATUSES or `open` (the default: failed, held, retry and sending,
 * oldest first); a single status lists newest first. 400 for another status.
 * `private, no-store`.
 */
export const adminListTransfers: Handler = async (req, _params, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const requested = qs.get("status") ?? "open";
  if (requested !== "open" && !TRANSFER_STATUSES.includes(requested as TransferStatus)) {
    throw new HttpError(400, `status must be one of: open, ${TRANSFER_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const statuses = requested === "open" ? OPEN_STATUSES : [requested as TransferStatus];
  const rows = await deps.db.query(
    `${ADMIN_TRANSFER_SELECT}
      where t.status = any($1::text[])
      order by ${requested === "open" ? "t.created_at, t.id" : "t.created_at desc, t.id desc"}
      limit $2 offset $3`,
    [statuses, limit + 1, offset],
  );
  const countRows = await deps.db.query<{ status: TransferStatus; n: number }>(
    `select status, count(*)::int as n from private.order_transfers group by status`,
  );
  const [owed] = await deps.db.query<{ owed: string }>(
    `select coalesce(sum(${SHARE}), 0)::text as owed
       from public.orders o
       left join private.order_transfers t on t.order_id = o.id
      where o.payout_method = 'transfer' and o.status = 'paid' and (t.id is null or t.status not in ('sent', 'cancelled'))`,
  );
  const [run] = await deps.db.query<{ finished_at: string | Date; claimed: number; sent: number; retrying: number; failed: number }>(
    `select finished_at, claimed, sent, retrying, failed from private.cron_runs where name = 'payouts'`,
  );
  const page = toPage(rows.map(toAdminTransfer), offset, limit);
  const counts = Object.fromEntries(TRANSFER_STATUSES.map((s) => [s, countRows.find((r) => r.status === s)?.n ?? 0])) as Record<
    TransferStatus,
    number
  >;
  const body: AdminTransfersPage = {
    counts,
    owedToOrganisersCents: Number(owed.owed),
    ...(run
      ? { lastRun: { finishedAt: new Date(run.finished_at).toISOString(), claimed: run.claimed, sent: run.sent, retrying: run.retrying, failed: run.failed } }
      : {}),
    ...page,
  };
  return okPrivate(body);
};

/**
 * Before an admin cancels a transfer (so as to pay the organiser by hand), asks Stripe whether one already
 * exists for the order: a request that timed out, or a worker that died, may have been accepted by Stripe, and
 * cancelling then paying by hand would pay twice. A whole transfer for the organiser's share is recorded as sent
 * ("adopted": the same as the job does for an unknown outcome) and the cancel doesn't happen; the caller returns
 * it. Another transfer Stripe has for the order (another amount, reversed in part) is a 409 for a person to look
 * at; Stripe unreachable is a 503 and nothing is cancelled. Always asked, whatever the row's status or last
 * error: any row a worker has claimed may have reached Stripe. Returns true when the transfer was adopted.
 */
async function adoptTransferBeforeCancel(deps: Deps, transferId: string): Promise<boolean> {
  const [row] = await deps.db.query<{ order_id: string; destination_account_id: string; amount_cents: number; status: TransferStatus }>(
    `select order_id, destination_account_id, amount_cents, status from private.order_transfers where id = $1::bigint`,
    [transferId],
  );
  // Unknown, sent or cancelled: the database answers 404 or 409 below, with nothing to look up.
  if (!row || row.status === "sent" || row.status === "cancelled") return false;
  const reference = orderReference(row.order_id);
  let found;
  try {
    found = await lookupOrderTransfer(deps, {
      orderId: row.order_id,
      destination: row.destination_account_id,
      amountCents: row.amount_cents,
    });
  } catch (err) {
    console.error(`Cancelling the transfer for order ${reference}: Stripe couldn't be asked for an existing transfer (${stripeErrorLabel(err)}); nothing was cancelled.`);
    throw new HttpError(503, "Couldn't check Stripe for an existing transfer, so nothing was cancelled. Try again in a minute.", undefined, {
      code: "transfer_stripe_unavailable",
    });
  }
  if (found.kind === "none") return false;
  if (found.kind === "unclear") {
    throw new HttpError(
      409,
      "Stripe has a transfer for this order that doesn't match its share. Check it in Stripe before cancelling.",
      undefined,
      { code: "transfer_exists_in_stripe" },
    );
  }
  const [finished] = await deps.db.query<{ result: string; alert_queued: boolean }>(
    `select result, alert_queued from private.finish_order_transfer($1::bigint, null, 'sent', null, null, $2, false, false)`,
    [transferId, found.transferId],
  );
  if (finished?.alert_queued) sendOpsAlertsSoon(deps);
  if (finished?.result !== "sent") {
    // Another action got there first (a cancel by someone else, or a different transfer on record): nothing more is done here.
    throw new HttpError(409, "That action doesn't apply to the transfer's status.", undefined, { code: "transfer_state_conflict" });
  }
  console.warn(`Cancelling the transfer for order ${reference}: Stripe already has the transfer, so it was recorded as sent instead.`);
  return true;
}

/**
 * POST /api/admin/transfers/[transferId]/action {action} — admin: `retry` a
 * failed or waiting transfer, `release` a held one (both: due now, with a
 * fresh set of attempts, sent by the next run of GET /api/cron/payouts), or
 * `cancel` a held, waiting or failed one (never sent: pay the organiser by
 * hand, once Stripe has been asked and has no transfer for the order: if it has
 * one, that transfer is recorded as sent and returned instead of cancelling).
 * Returns the transfer. 400 `fieldErrors.action`; 404 unknown; 409
 * with a `code`: `transfer_in_progress` (a worker has it right now),
 * `transfer_state_conflict` (not in a status this action applies to, e.g.
 * already sent or cancelled), `transfer_not_payable` (the order was refunded
 * since: retry and release are refused; cancel it), `transfer_exists_in_stripe`
 * (cancel: Stripe has a transfer for the order that isn't its share). 503
 * `transfer_stripe_unavailable`: cancel couldn't ask Stripe, so nothing changed.
 */
export const adminTransferAction: Handler<{ transferId: string }> = async (req, { transferId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!TRANSFER_ID.test(transferId)) throw new HttpError(404, TRANSFER_NOT_FOUND);
  const body = await readJson(req);
  if (typeof body.action !== "string" || !TRANSFER_ACTIONS.includes(body.action as TransferAction)) {
    fail({ action: `Action must be one of: ${TRANSFER_ACTIONS.join(", ")}.` });
  }
  if (body.action === "cancel" && (await adoptTransferBeforeCancel(deps, transferId))) {
    const [adopted] = await deps.db.query(`${ADMIN_TRANSFER_SELECT} where t.id = $1::bigint`, [transferId]);
    return okPrivate(toAdminTransfer(adopted));
  }
  const [row] = await deps.db.query<{ result: string }>(
    `select result from private.admin_transfer_action($1::bigint, $2, $3::uuid)`,
    [transferId, body.action, admin.userId],
  );
  switch (row.result) {
    case "ok":
      break;
    case "not_found":
      throw new HttpError(404, TRANSFER_NOT_FOUND);
    case "in_progress":
      throw new HttpError(409, "That transfer is being sent right now. Try again in a minute.", undefined, {
        code: "transfer_in_progress",
      });
    case "conflict":
      throw new HttpError(409, "That action doesn't apply to the transfer's status.", undefined, {
        code: "transfer_state_conflict",
      });
    case "not_payable":
      throw new HttpError(409, "The order was refunded, so its transfer can't be sent. Cancel it instead.", undefined, {
        code: "transfer_not_payable",
      });
    default:
      throw new Error(`Unexpected admin_transfer_action result: ${row.result}`);
  }
  const [updated] = await deps.db.query(`${ADMIN_TRANSFER_SELECT} where t.id = $1::bigint`, [transferId]);
  return okPrivate(toAdminTransfer(updated));
};
