/**
 * One page of events that haven't ended yet (`ends_at > now()`, in progress
 * included), soonest first by (starts_at, id), as a CTE of ids for a full
 * select to hydrate.
 *
 * Why not just `where … and e.ends_at > now() order by e.starts_at, e.id
 * limit … offset …`: ended events are never deleted, so they pile up at the
 * front of events_status_starts_idx, and for that shape the planner walks
 * every one of them (a LIMIT plan assumes matching rows are spread evenly
 * along starts_at). The cost grew with the platform's whole history.
 *
 * Instead the ids come from two branches that each use an index well:
 * - in progress (`starts_at <= now() and ends_at > now()`): few rows, found
 *   through events_status_ends_idx;
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
 * `where` is the caller's other conditions, over `e` (public.events) and `o`
 * (its organiser, joined as in EVENT_SELECT); `limit` and `offset` are
 * parameter placeholders (e.g. "$4"), the limit being the rows to fetch
 * (the page size plus one). The CTEs are `in_progress` and `page`; the
 * hydrating select joins `page p on p.id = e.id` and orders by e.starts_at,
 * e.id again (a join keeps no order).
 */
export function upcomingPageCte(where: string, limit: string, offset: string): string {
  const from = `from public.events e
        join public.organisers o on o.id = e.organiser_id`;
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
  )`;
}
