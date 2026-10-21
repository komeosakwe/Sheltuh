-- Listing fixes (docs/FEATURE_PLAN.md, B1).
--
-- 1. events.is_free means "has ticket types, and every one is free". It was
--    `not exists (a paid ticket type)`, which is also true for an event with
--    no ticket types at all, so such an event showed up under the public
--    feed's pricing=free filter. The API doesn't accept an event without a
--    ticket type today, but external ticketing (B2) will, so the rule is
--    fixed in the one function that maintains the column. pricing=paid now
--    checks for a paid ticket type (lib/server/handlers/public-events.ts), so
--    an event with no ticket types is neither free nor paid.
--
-- 2. GET /api/events?upcoming=1 (used by the home page and /events) filters
--    on ends_at > now(). The only events index orders by starts_at, so that
--    scan would step over every past published event before reaching the
--    upcoming ones, a cost that grows with history. (status, ends_at) lets
--    the planner range-scan just the events that haven't ended and sort that
--    small set instead.
--
-- Reversible: re-create replace_ticket_types from 20260925000000_init.sql
-- and drop events_status_ends_idx. The is_free backfill below only touches
-- events with no ticket types, which the API can't create, so it's expected
-- to change no rows; reverting it isn't meaningful (the old value was wrong).
-- Nothing is dropped or deleted.

create or replace function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.ticket_types t
  where t.event_id = p_event_id
    and not exists (select 1 from jsonb_array_elements(p_ticket_types) e where e ->> 'id' = t.id);

  insert into public.ticket_types
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available;

  -- Free only with at least one ticket type and none of them paid.
  update public.events
  set is_free = exists (select 1 from public.ticket_types where event_id = p_event_id)
            and not exists (select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0)
  where id = p_event_id;
end;
$$;

revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;

update public.events e
   set is_free = false
 where e.is_free
   and not exists (select 1 from public.ticket_types t where t.event_id = e.id);

create index events_status_ends_idx on public.events (status, ends_at);
