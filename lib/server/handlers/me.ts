import { requireVerifiedCaller } from "../auth";
import { okPrivate } from "../http";
import type { Handler } from "../route";
import type { AccountSummary } from "../types";

/**
 * GET /api/me — a verified member's own account summary, `private, no-store`
 * (docs/architecture.md, "API"). 401 signed out; 403 email not verified.
 *
 * `upcomingCount`: published events that haven't started yet for which the
 * caller holds a ticket. Guest checkout has no account, so, as for Who's
 * Going (private.set_going), a ticket is theirs when a `paid` order's
 * buyer_email equals their verified email ignoring case (no +tag or Gmail-dot
 * folding: the exact address, as a ticket's email went to it). Free tickets
 * are A$0 paid orders; a partly refunded order stays paid. Pending, failed,
 * refunded and oversold orders don't count. Distinct events, so several
 * orders, or a group order, for one event count once. Only from the token's
 * email: nothing in the request picks whose orders are counted.
 *
 * One query: orders_paid_email_event_idx finds the caller's paid orders,
 * then each event by primary key.
 */
export const getMe: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const [{ count }] = await db.query<{ count: number }>(
    `select count(distinct o.event_id)::int as count
       from public.orders o
       join public.events e on e.id = o.event_id
      where o.status = 'paid' and lower(o.buyer_email) = lower($1)
        and e.status = 'published' and e.starts_at > now()`,
    [caller.email],
  );
  return okPrivate({ upcomingCount: count } satisfies AccountSummary);
};
