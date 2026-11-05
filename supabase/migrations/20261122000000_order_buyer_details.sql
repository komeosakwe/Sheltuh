-- Organiser Orders view: the buyer's name on the order (docs/architecture.md,
-- "Organiser orders"). Owner decision (5 Nov 2026): organisers see the name
-- and email of the people who bought tickets to their events, for 12 months
-- after the event ends; the buyer is told at checkout.
--
--   * public.orders.buyer_name: what the buyer typed in the checkout's "Your
--     name" field (1 to 80 characters, trimmed, no control, invisible or
--     line-separator characters: orders_buyer_name_check; the API cleans it
--     further, lib/server/order-input.ts parseBuyerName). Null for every
--     order made before this release and for any made without one (the API
--     takes it as optional for one release). There is no backfill.
--   * public.orders.details_notice_at: when the order was made WITH a name,
--     i.e. when the checkout's notice ("Your name and email are shared with
--     the organiser of this event.") had been shown to the buyer. Set by the
--     database (the orders_details_notice trigger: now() on insert when
--     buyer_name is not null), never by the client, and the organiser's
--     Orders view shows the name and email only for orders that have it
--     (orders_details_notice_pair: both or neither). Withdrawing someone's
--     details is `update public.orders set buyer_name = null,
--     details_notice_at = null where ...` (docs/supabase-setup.md).
--   * The five order-creating functions take a trailing p_buyer_name text
--     default null and store it: private.hold_seats, private.place_free_order,
--     private.place_free_seated_order, private.request_free_order (the
--     13-argument delegating form is unchanged: it reaches the new one and
--     so makes an order without a name) and private.request_free_seated_order.
--     Bodies are otherwise as in their latest definitions (hold_seats:
--     20261110000100_order_support.sql; place_free_order:
--     20261014000100_free_order_protection.sql; place_free_seated_order and
--     request_free_seated_order: 20261101000100_seat_holds.sql;
--     request_free_order: 20261017000000_free_order_caps.sql). The old
--     signatures are dropped; a caller that omits the name still works.
--     private.confirm_free_order is unchanged: a guest's name was stored when
--     the link was requested.
--   * private.order_detail_exports: an audit row for every CSV export of an
--     event's orders (who, which event, how many rows, when). No buyer data.
--     private.order_detail_views: the same for page reads, as one row per
--     account, event and UTC day with the number of rows served. Both feed one
--     shared daily budget of detail rows per account per event
--     (private.take_order_detail_budget; the API passes the limit, 25,000), so
--     reading names and emails page by page can't get round the export's
--     limits. private.record_order_export takes the export's rate limit and
--     the budget and writes the audit row in one step, so an export that is
--     refused leaves no row and an export without a row is never served (the
--     API only sends the file once this has returned 'recorded').
--   * The orders_details_immutable trigger: once an order has a name it can
--     only be cleared (both columns to null: the withdrawal runbook), never
--     changed or set later, so the notice stamp can't be forged by an update.
--
-- Access model as everywhere else: the table has RLS on and no policies, no
-- grants to anon or authenticated; every function pins its search_path and
-- has execute revoked from PUBLIC, anon and authenticated. No new index on
-- orders: the list reads one event's orders through orders_event_idx
-- (event_id), a set bounded by that event's sales.
--
-- Reversible: drop the triggers orders_details_notice and
-- orders_details_immutable and their functions, the two constraints and the
-- two columns of public.orders; drop private.record_order_export,
-- private.take_order_detail_budget, private.order_detail_views and
-- private.order_detail_exports; restore the
-- five functions from the files named above (dropping the new signatures
-- first). Dropping the columns discards the names collected since: not
-- destructive to any data that existed before this file.

alter table public.orders
  add column buyer_name text,
  add column details_notice_at timestamptz,
  add constraint orders_buyer_name_check
    check (
      char_length(buyer_name) between 1 and 80
      and buyer_name = btrim(buyer_name)
      -- Escapes only (\uXXXX and \UXXXXXXXX are fixed-width, unlike \x), so no invisible character is ever typed
      -- into this file: control and C1 characters, every Unicode format character
      -- (Cf), the line and paragraph separators and the combining grapheme joiner.
      -- U+200C and U+200D (joiners that real Persian and Indic names need) are left
      -- out here; the API allows them only between two letters.
      and buyer_name !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B\u200E-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]'
    ),
  add constraint orders_details_notice_pair
    check ((buyer_name is null) = (details_notice_at is null));

-- The notice is proved by the database, not claimed by a client: an order
-- made with a name is stamped with now().
create function private.orders_details_notice() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.details_notice_at := case when new.buyer_name is not null then now() end;
  return new;
end;
$$;

revoke all on function private.orders_details_notice() from public, anon, authenticated;

create trigger orders_details_notice before insert on public.orders
  for each row execute function private.orders_details_notice();

-- Once set, the name and its notice stamp can only be cleared together (the
-- withdrawal runbook, docs/supabase-setup.md): no change, and no name added to
-- an order that was made without one. Fires only for updates that list one of
-- the two columns, so the many other updates of orders are untouched.
create function private.orders_details_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.buyer_name is not distinct from old.buyer_name
     and new.details_notice_at is not distinct from old.details_notice_at then
    return new;
  end if;
  if new.buyer_name is null and new.details_notice_at is null then
    return new;
  end if;
  raise exception 'buyer details can only be cleared' using errcode = '23514';
end;
$$;

revoke all on function private.orders_details_immutable() from public, anon, authenticated;

create trigger orders_details_immutable before update of buyer_name, details_notice_at on public.orders
  for each row execute function private.orders_details_immutable();

-- ---------------------------------------------------------------------------
-- Seated holds
-- ---------------------------------------------------------------------------

drop function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric, integer);

-- As in 20261110000100_order_support.sql, plus p_buyer_name (the order's
-- buyer_name; null for none).
create function private.hold_seats(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_subtotal_cents integer, p_buyer_fee_cents integer, p_total_cents integer, p_application_fee_cents integer,
  p_buyer_email text, p_tracking_code text, p_map_version integer, p_seat_ids text[], p_hold interval,
  p_attempt_limit integer, p_attempt_window interval, p_cap_min integer, p_cap_share numeric,
  p_support_cents integer default 0, p_buyer_name text default null,
  out result text, out hold_expires_at timestamptz, out unavailable_seat_ids text[]
)
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_version integer;
  v_unavailable text[];
  v_held integer;
  v_sellable integer;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 10
     or cardinality(p_seat_ids) <> (select count(distinct x) from unnest(p_seat_ids) x) then
    raise exception 'between 1 and 10 distinct seats' using errcode = '22023';
  end if;

  perform private.lock_event_seats(p_event_id);
  -- A used-up window: refused with a plain read, before any work. Exact, since
  -- the counter is only ever written under the seat lock held here.
  if exists (select 1 from private.event_rate_limits r
              where r.event_id = p_event_id and r.bucket = 'seat_holds'
                and r.window_started_at > now() - p_attempt_window and r.hits >= p_attempt_limit) then
    result := 'rate_limited';
    return;
  end if;

  begin
    -- The order (orders_sheltuh_only share-locks the event row).
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, seat_ids, support_cents,
       buyer_name)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, p_subtotal_cents,
       p_buyer_fee_cents, p_total_cents, p_application_fee_cents, p_buyer_email,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids, coalesce(p_support_cents, 0), p_buyer_name);

    select e.status, e.ticketing_mode into v_event from public.events e where e.id = p_event_id for share;
    if v_event.status is distinct from 'published' or v_event.ticketing_mode is distinct from 'sheltuh' then
      raise exception 'not on sale' using errcode = 'SH404';
    end if;
    select m.version into v_version from public.event_seat_maps m where m.event_id = p_event_id;
    if v_version is distinct from p_map_version then
      raise exception 'map version' using errcode = 'SH412';
    end if;

    -- Seats in id order.
    perform 1 from public.event_seats s
     where s.event_id = p_event_id and s.id = any(p_seat_ids)
     order by s.id
       for update;
    v_unavailable := private.unavailable_seats(p_event_id, p_seat_ids, p_order_id);
    if cardinality(v_unavailable) > 0 then
      unavailable_seat_ids := v_unavailable;
      raise exception 'seats unavailable' using errcode = 'SH409';
    end if;
    if not private.order_seats_match(p_event_id, p_line_items, p_seat_ids) then
      raise exception 'lines and seats differ' using errcode = 'SH422';
    end if;

    -- Anti-hoarding: seats held right now (unexpired), against the larger of
    -- p_cap_min and p_cap_share of the unblocked seats (the seated tiers'
    -- capacity).
    select count(*)::integer into v_held from public.event_seats s
     where s.event_id = p_event_id and s.hold_order_id is not null and s.hold_expires_at > now();
    select coalesce(sum(t.quantity_available), 0)::integer into v_sellable
      from public.ticket_types t where t.event_id = p_event_id and t.seated;
    if v_held + cardinality(p_seat_ids) > greatest(p_cap_min, floor(v_sellable * p_cap_share)::integer) then
      raise exception 'hold cap' using errcode = 'SH429';
    end if;

    -- Every refusal is behind us: this is a real hold, and only it counts.
    if not private.take_event_rate_limit(p_event_id, 'seat_holds', p_attempt_limit, p_attempt_window) then
      raise exception 'hold attempts' using errcode = 'SH430';
    end if;

    update public.event_seats s
       set hold_order_id = p_order_id, hold_expires_at = now() + p_hold
     where s.event_id = p_event_id and s.id = any(p_seat_ids);
    hold_expires_at := now() + p_hold;
    result := 'held';
  exception
    -- Each undoes the order and anything locked or written in this block.
    when sqlstate 'SH404' then result := 'not_on_sale';
    when sqlstate 'SH412' then result := 'version';
    when sqlstate 'SH409' then result := 'seats_unavailable';
    when sqlstate 'SH422' then result := 'tier_mismatch';
    when sqlstate 'SH429' then result := 'hold_cap';
    when sqlstate 'SH430' then result := 'rate_limited';
  end;
end;
$$;

revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Free orders
-- ---------------------------------------------------------------------------

drop function private.place_free_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer, integer, interval);

-- As in 20261014000100_free_order_protection.sql, plus p_buyer_name.
create function private.place_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_user_id uuid, p_tickets jsonb,
  p_person_limit integer, p_daily_limit integer, p_daily_window interval,
  p_buyer_name text default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
  v_quantity integer := jsonb_array_length(p_tickets);
begin
  if private.lock_free_allowance(p_event_id, v_key) + v_quantity > p_person_limit then
    perform private.record_free_order_refusal('person_event_limit');
    return 'person_event_limit';
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'free_claims', p_daily_limit, p_daily_window) then
      raise exception 'daily free claims' using errcode = 'SH429';
    end if;
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code, buyer_name)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
       p_buyer_email, v_key,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_buyer_name);
    if private.fulfil_order(p_order_id, null, null, p_tickets) is distinct from 'paid' then
      raise exception 'sold out' using errcode = 'SH409';
    end if;
  exception
    -- Undoes the allowance hit, the order and any reservation.
    when sqlstate 'SH429' then
      perform private.record_free_order_refusal('member_daily_limit');
      return 'member_daily_limit';
    when sqlstate 'SH409' then
      return 'sold_out';
  end;
  return 'paid';
end;
$$;

revoke all on function private.place_free_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer, integer,
  interval, text) from public, anon, authenticated;

drop function private.place_free_seated_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer, integer,
  interval, text[]);

-- As in 20261101000100_seat_holds.sql, plus p_buyer_name.
create function private.place_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_user_id uuid, p_tickets jsonb,
  p_person_limit integer, p_daily_limit integer, p_daily_window interval, p_seat_ids text[],
  p_buyer_name text default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
  v_quantity integer := jsonb_array_length(p_tickets);
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  perform private.lock_event_seats(p_event_id);
  if private.lock_free_allowance(p_event_id, v_key) + v_quantity > p_person_limit then
    perform private.record_free_order_refusal('person_event_limit');
    return 'person_event_limit';
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'free_claims', p_daily_limit, p_daily_window) then
      raise exception 'daily free claims' using errcode = 'SH429';
    end if;
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code, seat_ids,
       buyer_name)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
       p_buyer_email, v_key,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids, p_buyer_name);
    if private.fulfil_order(p_order_id, null, null, p_tickets) is distinct from 'paid' then
      raise exception 'sold out' using errcode = 'SH409';
    end if;
  exception
    when sqlstate 'SH429' then
      perform private.record_free_order_refusal('member_daily_limit');
      return 'member_daily_limit';
    when sqlstate 'SH409' then
      if cardinality(private.unavailable_seats(p_event_id, p_seat_ids, p_order_id)) > 0 then
        return 'seats_unavailable';
      end if;
      return 'sold_out';
  end;
  return 'paid';
end;
$$;

revoke all on function private.place_free_seated_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer,
  integer, interval, text[], text) from public, anon, authenticated;

-- Guests: request_free_seated_order calls request_free_order, so it goes first.
drop function private.request_free_seated_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval, text[]);
drop function private.request_free_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval);

-- As in 20261017000000_free_order_caps.sql, plus p_buyer_name.
create function private.request_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval,
  p_buyer_name text default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
begin
  if private.platform_rate_limit_used_up('free_order_confirmations', p_platform_limit, p_platform_window) then
    perform private.record_free_order_refusal('platform_hourly_limit');
    return 'platform_limited';
  end if;
  if private.platform_rate_limit_used_up('free_order_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    perform private.record_free_order_refusal('platform_daily_limit');
    return 'platform_daily_limited';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('free_links:' || v_key, 0));
  if (select count(*) from public.orders o
       where o.confirmation_token_hash is not null and o.status = 'pending'
         and o.created_at > now() - p_address_window and o.buyer_email_key = v_key) >= p_address_limit then
    perform private.record_free_order_refusal('address_hourly_limit');
    return 'address_limited';
  end if;

  if not private.take_platform_rate_limit('free_order_confirmations', p_platform_limit, p_platform_window) then
    perform private.record_free_order_refusal('platform_hourly_limit');
    return 'platform_limited';
  end if;
  if not private.take_platform_rate_limit('free_order_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    perform private.record_free_order_refusal('platform_daily_limit');
    return 'platform_daily_limited';
  end if;

  insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
     buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code,
     confirmation_token_hash, confirmation_expires_at, buyer_name)
  values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
     p_buyer_email, v_key,
     (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
     p_token_hash, now() + p_ttl, p_buyer_name);
  return 'requested';
end;
$$;

revoke all on function private.request_free_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval, text) from public, anon, authenticated;

-- As in 20261101000100_seat_holds.sql, plus p_buyer_name (passed through).
create function private.request_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval, p_seat_ids text[],
  p_buyer_name text default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  v_result := private.request_free_order(
    p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items,
    p_buyer_email, p_tracking_code, p_token_hash, p_ttl,
    p_address_limit, p_address_window, p_platform_limit, p_platform_window,
    p_platform_daily_limit, p_platform_daily_window, p_buyer_name);
  if v_result = 'requested' then
    update public.orders set seat_ids = p_seat_ids where id = p_order_id;
  end if;
  return v_result;
end;
$$;

revoke all on function private.request_free_seated_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval, text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Export audit
-- ---------------------------------------------------------------------------

-- One row per CSV export of an event's orders. event_id and organiser_id are
-- plain ids (no foreign keys: the record outlives a deleted event); actor_id
-- is the account that exported (an organiser's owner, or an admin) and is
-- nulled if the account is deleted. Holds no buyer data. Read by hand
-- (docs/supabase-setup.md); the index serves "who exported this event, and
-- when".
create table private.order_detail_exports (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  organiser_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  row_count integer not null check (row_count >= 0),
  created_at timestamptz not null default now()
);

create index order_detail_exports_event_idx on private.order_detail_exports (event_id, created_at desc);

alter table private.order_detail_exports enable row level security;
revoke all on private.order_detail_exports from public, anon, authenticated;

-- One row per account, event and UTC day: how many rows of buyer details the
-- account has been served for the event (page reads and exports together) and
-- in how many requests. The shared daily budget reads and writes it. actor_id
-- is a plain uuid (it is part of the key, so no foreign key and no null); it
-- and the other ids are no buyer data. Read by hand (docs/supabase-setup.md).
create table private.order_detail_views (
  actor_id uuid not null,
  event_id uuid not null,
  organiser_id uuid not null,
  day date not null,
  rows_served integer not null check (rows_served >= 0),
  requests integer not null check (requests >= 0),
  primary key (actor_id, event_id, day)
);

alter table private.order_detail_views enable row level security;
revoke all on private.order_detail_views from public, anon, authenticated;

-- Adds p_rows to the account's served rows for this event today, unless that
-- would pass p_daily_limit: then nothing is written and it returns false (the
-- caller serves nothing). One atomic upsert, so concurrent requests can't
-- overshoot. Nothing is written for 0 rows.
create function private.take_order_detail_budget(
  p_actor uuid, p_event_id uuid, p_organiser_id uuid, p_rows integer, p_daily_limit integer
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_rows is null or p_rows < 0 then
    raise exception 'rows must be 0 or more' using errcode = '22023';
  end if;
  if p_rows = 0 then
    return true;
  end if;
  if p_rows > p_daily_limit then
    return false;
  end if;
  insert into private.order_detail_views as v (actor_id, event_id, organiser_id, day, rows_served, requests)
  values (p_actor, p_event_id, p_organiser_id, (now() at time zone 'UTC')::date, p_rows, 1)
  on conflict (actor_id, event_id, day) do update
     set rows_served = v.rows_served + excluded.rows_served, requests = v.requests + 1
   where v.rows_served + excluded.rows_served <= p_daily_limit;
  return found;
end;
$$;

revoke all on function private.take_order_detail_budget(uuid, uuid, uuid, integer, integer)
  from public, anon, authenticated;

-- Takes one hit of the account's 'order_exports' limit (p_limit per p_window),
-- then p_rows of the event's daily budget (p_daily_rows), and, within both,
-- writes the audit row, in one step. Returns 'recorded', 'rate_limited' or
-- 'budget_exceeded' (nothing written beyond the rate-limit hit, which stays
-- counted).
create function private.record_order_export(
  p_actor uuid, p_event_id uuid, p_organiser_id uuid, p_rows integer, p_limit integer, p_window interval,
  p_daily_rows integer
) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not private.take_rate_limit(p_actor, 'order_exports', p_limit, p_window) then
    return 'rate_limited';
  end if;
  if not private.take_order_detail_budget(p_actor, p_event_id, p_organiser_id, p_rows, p_daily_rows) then
    return 'budget_exceeded';
  end if;
  insert into private.order_detail_exports (event_id, organiser_id, actor_id, row_count)
  values (p_event_id, p_organiser_id, p_actor, p_rows);
  return 'recorded';
end;
$$;

revoke all on function private.record_order_export(uuid, uuid, uuid, integer, integer, interval, integer)
  from public, anon, authenticated;
