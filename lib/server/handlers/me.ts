import { requireVerifiedCaller, type VerifiedCaller } from "../auth";
import type { Db } from "../db";
import { okPrivate } from "../http";
import type { Handler } from "../route";
import type { AccountSummary } from "../types";

/**
 * The caller's own account summary, in one statement.
 *
 * `upcomingCount`: published events that haven't started yet for which the
 * caller holds a ticket, by private.member_held_tickets (as Who's Going,
 * private.set_going): guest checkout has no account, so a bought ticket is
 * theirs when a `paid` order's buyer_email equals their verified email
 * ignoring case (no +tag or Gmail-dot folding: the exact address, as a
 * ticket's email went to it) and they haven't sent it to someone who
 * accepted it; a ticket someone sent them is theirs by the account that
 * accepted it, while its order is paid. Free tickets are A$0 paid orders; a
 * partly refunded order stays paid. Pending, failed, refunded and oversold
 * orders don't count. Distinct events, so several tickets for one event
 * count once. Only from the token's email and user id: nothing in the
 * request picks whose tickets are counted. orders_paid_email_event_idx and
 * ticket_transfers_holder_idx find the caller's tickets, then each event by
 * primary key.
 *
 * `username` and `usernameChangeableAt` (docs/architecture.md, "Usernames"):
 * private.member_username_state, by the token's user id. The changeable time
 * is only sent while a change has to wait (also with no username, after a
 * clear).
 */
export async function readAccountSummary(db: Db, caller: VerifiedCaller): Promise<AccountSummary> {
  const [row] = await db.query<{ count: number; username: string | null; changeable_at: Date | string | null }>(
    `select (select count(distinct h.event_id)::int
               from private.member_held_tickets($2, $1) h
               join public.events e on e.id = h.event_id
              where e.status = 'published' and e.starts_at > now()) as count,
            s.username, s.changeable_at
       from private.member_username_state($2) s`,
    [caller.email, caller.userId],
  );
  return {
    ...(row.username ? { username: row.username } : {}),
    ...(row.changeable_at ? { usernameChangeableAt: new Date(row.changeable_at).toISOString() } : {}),
    upcomingCount: row.count,
  };
}

/**
 * GET /api/me — a verified member's own account summary, `private, no-store`
 * (docs/architecture.md, "API"): readAccountSummary. 401 signed out; 403
 * email not verified.
 */
export const getMe: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  return okPrivate(await readAccountSummary(db, caller));
};
