-- My tickets (docs/architecture.md, "API", `GET /me/tickets`): a member's
-- refunded and oversold orders, listed under Past beside their paid ones.
-- Guest checkout has no account, so an order is a member's by its
-- buyer_email equal to their verified email, ignoring case: the same match
-- as private.member_held_tickets and GET /me.
--
--   * orders_refunded_email_idx (lower(buyer_email)) where status in
--     ('refunded', 'oversold_refund_required'). GET /me/tickets looks a
--     member's orders up by email across every event: the paid ones by
--     orders_paid_email_event_idx (20261201000000_member_upcoming_index.sql,
--     partial on 'paid'), these by this one. Without it the refunded and
--     oversold branch reads every order. It leads with the lower()
--     expression the query compares (so the planner can use it) and is
--     partial on the query's own predicate, so pending, failed and paid
--     orders stay out of it; refunds are rare, so it stays small.
--
-- Plain `create index` (not concurrently: a migration runs in one
-- transaction): it holds a SHARE lock on public.orders while it builds, so
-- order writes wait for it. Pre-launch the table is small and the build is
-- immediate; past launch, run it outside peak sales.
--
-- Additive: no table, column, function or grant changes; the previous app
-- never relies on it. Apply it before the app: the new app answers without
-- it, but then the refunded and oversold branch reads every order on each
-- call.
-- Reversible, not destructive: drop index public.orders_refunded_email_idx.

create index orders_refunded_email_idx on public.orders (lower(buyer_email))
  where status in ('refunded', 'oversold_refund_required');
