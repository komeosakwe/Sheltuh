import { RECENT_EVENT_DAYS } from "@/lib/recent-events";

/**
 * `recent` (the feed's `recent` option): also list events that ended within
 * `recentDays` (default RECENT_EVENT_DAYS), most recently ended first.
 * `include`: after every upcoming event (so a page that reaches past the last
 * upcoming one continues into them). `only`: just those.
 */
export interface UpcomingPageOptions {
  recent?: "include" | "only";
  recentDays?: number;
}

/**
 * The `recent` variants of upcomingPageQuery. The ended branch is a range
 * scan of events_status_ends_idx over `ends_at` in the last N days only (a
 * small, bounded set, never the platform's whole history), and is disjoint
 * from the other two (`ends_at <= now()`). Rows are numbered (`rn`) in the
 * final order (upcoming by start, then ended by end, newest first; ties by
 * id) and the page cut and hydrated in that order.
 */
function recentPageQuery(
  select: string,
  where: string,
  from: string,
  limit: string,
  offset: string,
  mode: "include" | "only",
  days: number,
): string {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("upcomingPageQuery: recentDays must be 1-365.");
  const ended = `select e.id, 1 as grp, e.ends_at as ts
        ${from}
       where ${where} and e.ends_at <= now() and e.ends_at > now() - interval '${days} days'
       order by e.ends_at desc, e.id
       limit (${limit}::bigint + ${offset}::bigint)`;
  const upcoming = `select e.id, 0 as grp, e.starts_at as ts
        ${from}
       where ${where} and e.starts_at > now()
       order by e.starts_at, e.id
       limit (${limit}::bigint + ${offset}::bigint)`;
  const parts =
    mode === "only"
      ? `(${ended})`
      : `(select ip.id, 0 as grp, ip.starts_at as ts from in_progress ip)
      union all
      (${upcoming})
      union all
      (${ended})`;
  // In progress is materialized on its own, as in upcomingPageQuery (same reason).
  const inProgress =
    mode === "only"
      ? ""
      : `in_progress as materialized (
      select e.id, e.starts_at
        ${from}
       where ${where} and e.starts_at <= now() and e.ends_at > now()
    ), `;
  return `with ${inProgress}page as materialized (
    select u.id, row_number() over (
      order by u.grp, case when u.grp = 0 then u.ts end, case when u.grp = 1 then u.ts end desc, u.id
    ) as rn
    from (
      ${parts}
    ) u
    order by rn
    limit ${limit}::bigint offset ${offset}::bigint
  )
  ${select} join page p on p.id = e.id
  order by p.rn`;
}

/**
 * The statement for one page of events that haven't ended yet
 * (`ends_at > now()`, in progress included), soonest first by
 * (starts_at, id): a CTE picks the page's ids, then `select` (a full select
 * over `e`, public.events, ending at its last join: EVENT_SELECT,
 * ADMIN_EVENT_SELECT) hydrates them. The join to the page and the final
 * order are added here, so a caller can't forget either.
 *
 * Why not just `where … and e.ends_at > now() order by e.starts_at, e.id
 * limit … offset …`: ended events are never deleted, so they pile up at the
 * front of events_status_starts_idx, and for that shape the planner walks
 * every one of them (a LIMIT plan assumes matching rows are spread evenly
 * along starts_at). The cost grew with the platform's whole history.
 *
 * Instead the ids come from two branches that each use an index:
 * - in progress (`starts_at <= now() and ends_at > now()`): few rows come
 *   out, but finding them is a range scan of events_status_ends_idx over
 *   `ends_at > now()`, i.e. every event that hasn't ended (future ones
 *   included), with a heap fetch each to test starts_at. So its cost is
 *   O(upcoming events), not O(page): fine at today's scale, and it still
 *   never touches ended history. An index on (status, ends_at) include
 *   (starts_at) would make it index-only if that ever matters.
 * - not started (`starts_at > now()`): a walk of events_status_starts_idx
 *   from now. events' check (ends_at > starts_at) makes `ends_at > now()`
 *   true for all of them, so it isn't repeated (it would cost a heap fetch
 *   per row).
 * The not-started branch keeps only its first `offset + limit` rows in
 * (starts_at, id) order, which is all the page can come from; the union is
 * ordered the same way and the page cut from it. The two branches are
 * disjoint, so nothing is counted twice. now() is the statement's one
 * instant in both.
 *
 * `conditions` are the caller's other conditions (the status first), over
 * `e` and `o` (its organiser, joined as in EVENT_SELECT). Each one is
 * parenthesised here before they're and-ed, so a top-level `or` in one
 * can't escape the status condition or the branch tests and let other
 * events into a feed. `limit` and `offset` must be parameter placeholders (e.g. "$4"),
 * the limit being the rows to fetch (the page size plus one); anything else
 * throws. The CTEs are named `in_progress` and `page`, and the page is
 * joined as `p`.
 */
export function upcomingPageQuery(
  select: string,
  conditions: string[],
  limit: string,
  offset: string,
  options: UpcomingPageOptions = {},
): string {
  if (!/^\$\d+$/.test(limit) || !/^\$\d+$/.test(offset)) {
    throw new Error("upcomingPageQuery: limit and offset must be parameter placeholders ($n).");
  }
  if (conditions.length === 0) throw new Error("upcomingPageQuery: at least one condition (the status) is required.");
  const where = conditions.map((condition) => `(${condition})`).join(" and ");
  const from = `from public.events e
        join public.organisers o on o.id = e.organiser_id`;
  if (options.recent) {
    return recentPageQuery(select, where, from, limit, offset, options.recent, options.recentDays ?? RECENT_EVENT_DAYS);
  }
  // in_progress is materialized on its own so that it's planned without the
  // page's order: asked for (starts_at, id) order, the planner prefers to
  // walk events_status_starts_idx (ended events included) over a sort.
  return `with in_progress as materialized (
      select e.id, e.starts_at
        ${from}
       where ${where} and e.starts_at <= now() and e.ends_at > now()
    ), page as materialized (
    select u.id from (
      select ip.id, ip.starts_at from in_progress ip
      union all
      (select e.id, e.starts_at
        ${from}
       where ${where} and e.starts_at > now()
       order by e.starts_at, e.id
       limit (${limit}::bigint + ${offset}::bigint))
    ) u
    order by u.starts_at, u.id
    limit ${limit}::bigint offset ${offset}::bigint
  )
  ${select} join page p on p.id = e.id
  order by e.starts_at, e.id`;
}
