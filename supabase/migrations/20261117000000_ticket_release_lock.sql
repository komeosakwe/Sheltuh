-- Sequential ticket releases ("Opens when the ticket above sells out"; see
-- docs/architecture.md, "Sequential ticket releases"): a general admission
-- ticket type can wait for the one above it (by position) to sell out. While
-- it waits, no new order can include it.
--
--   * ticket_types.opens_after_previous: the setting, on the dependent tier.
--     Never on the first tier (ticket_types_lock_not_first) and never on a
--     seated one (ticket_types_lock_ga_only: a seated tier is sold by seat).
--   * ticket_types.sold_out_at: sticky. Set by the row-local BEFORE UPDATE
--     trigger ticket_types_sold_out_at the first time quantity_sold reaches
--     quantity_available, and never cleared: a later release of more tickets,
--     or a refund that gives a ticket back, doesn't shut the next tier again.
--     (The trigger sorts after ticket_types_seated_capacity, which can change
--     quantity_available first.) Tiers already sold out are backfilled with
--     now(): the real moment isn't recorded.
--   * private.ticket_type_locks(event): the one definition of "locked", used
--     by the orders trigger below, by the API's event reads
--     (lib/server/records.ts, `opensAfter`), the checkout's early check and
--     private.set_ticket_lock. A tier is locked when opens_after_previous is
--     set, there is a tier above it, and that tier has no sold_out_at and
--     isn't sold out now. Sold out is quantity_sold >= quantity_available,
--     the public `soldOut`. General admission reserves nothing, so a pending
--     or abandoned checkout never opens the next tier; whoever loses the race
--     for the last ticket gets the existing oversold refund.
--   * orders_tiers_open (BEFORE INSERT on orders, after orders_sheltuh_only,
--     which has already share-locked the event): refuses a new order with a
--     locked tier in its line items (check_violation, constraint
--     orders_tiers_open). That covers a paid general admission order, a free
--     one (member or guest) and private.hold_seats. private.fulfil_order is
--     unchanged: an order made before a tier was locked still fulfils.
--   * private.replace_ticket_types and private.admin_edit_event, redefined
--     (copies of 20261022000000_external_ticketing.sql and
--     20261114000000_external_price.sql) to carry the flag. A ticket type
--     whose `opensAfterPrevious` is absent from the request keeps its stored
--     value (a client that predates the flag can't clear it); the first
--     position is always false. A change to the flag alone is an edit of the
--     ticket types (logged `edited`, not `unchanged`).
--   * private.set_ticket_lock: an organiser's toggle on their own published,
--     not-yet-ended, Sheltüh-ticketed event, as private.release_tickets
--     (20261113000000_release_tickets.sql): organiser share lock, event for no
--     key update, ticket type for update, everything rechecked under them. It
--     is allowed on a tier that already has sales: it only affects new
--     orders. A change bumps the event's updated_at (an admin's edit made
--     from an older version is stale) and logs an `edited` entry with
--     `ticketTypes {old, new}` (the changed tier only). Under a per-account
--     hourly cap (take_rate_limit 'ticket_locks') and a per-event daily cap
--     (take_event_rate_limit 'ticket_locks'), taken last, so a refusal and a
--     no-change cost nothing.
--
-- Results of set_ticket_lock: 'set' (done), 'unchanged' (already as asked;
-- nothing written, no allowance used), 'not_found' (no such event for this
-- organiser, the organiser isn't the actor, or no such ticket type; a null
-- actor too), 'not_approved', 'not_published', 'ended', 'external', 'seated'
-- (turning it on for a seated tier), 'first_tier' (turning it on for the tier
-- with none above), 'rate_limited'. A null limit raises. `locked`, `blocker_id`
-- and `blocker_name` are the tier's state after the call: whether it is
-- waiting now, and for which tier.
--
-- Access model as everywhere else: not SECURITY DEFINER (the API connects as
-- the owner), search_path pinned, execute revoked from PUBLIC, anon and
-- authenticated.
--
-- Additive; reversible, not destructive, while no tier has the flag: drop the
-- triggers, the functions and the columns, and restore the two redefined
-- functions from their earlier migrations. Dropping the columns discards the
-- setting (and the sold_out_at history) for good.

alter table public.ticket_types
  add column opens_after_previous boolean not null default false,
  add column sold_out_at timestamptz,
  add constraint ticket_types_lock_not_first check (not opens_after_previous or position > 0),
  add constraint ticket_types_lock_ga_only check (not (opens_after_previous and seated));

-- Existing sold-out tiers: sold out before the setting existed. Only this
-- column is set, so no other trigger on the table fires.
update public.ticket_types set sold_out_at = now() where quantity_sold >= quantity_available;

create function private.ticket_types_sold_out_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sold_out_at is null and new.quantity_sold >= new.quantity_available then
    new.sold_out_at := now();
  end if;
  return new;
end;
$$;

-- Sorts after ticket_types_seated_capacity (a seated tier's capacity is set there).
create trigger ticket_types_sold_out_at before insert or update of quantity_sold, quantity_available, seated
  on public.ticket_types
  for each row execute function private.ticket_types_sold_out_at();

-- ---------------------------------------------------------------------------
-- Which tiers are waiting, and for whom
-- ---------------------------------------------------------------------------

create function private.ticket_type_locks(p_event_id uuid)
returns table (ticket_type_id text, blocker_id text, blocker_name text)
language sql
stable
set search_path = ''
as $$
  select o.id, o.prev_id, o.prev_name
    from (
      select t.id, t.opens_after_previous,
             lag(t.id) over w as prev_id,
             lag(t.name) over w as prev_name,
             lag(t.sold_out_at) over w as prev_sold_out_at,
             lag(t.quantity_sold >= t.quantity_available) over w as prev_sold_out_now
        from public.ticket_types t
       where t.event_id = p_event_id
      window w as (order by t.position, t.id)
    ) o
   where o.opens_after_previous
     and o.prev_id is not null
     and o.prev_sold_out_at is null
     and not o.prev_sold_out_now
$$;

create function private.orders_tiers_open() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The event's share lock is orders_sheltuh_only's (it fires first); an
  -- order for an event with no sequential release does one cheap read.
  if exists (
    select 1
      from private.ticket_type_locks(new.event_id) l
     where exists (select 1 from jsonb_array_elements(new.line_items) li where li ->> 'ticketTypeId' = l.ticket_type_id)
  ) then
    raise exception 'A ticket in this order isn''t on sale yet.'
      using errcode = 'check_violation', constraint = 'orders_tiers_open';
  end if;
  return new;
end;
$$;

-- Sorts after orders_not_ended, orders_platform_free_only and orders_sheltuh_only.
create trigger orders_tiers_open before insert on public.orders
  for each row execute function private.orders_tiers_open();

-- ---------------------------------------------------------------------------
-- replace_ticket_types: as 20261022000000_external_ticketing.sql, plus the flag
-- ---------------------------------------------------------------------------

create or replace function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.ticket_types t
  where t.event_id = p_event_id
    and not exists (select 1 from jsonb_array_elements(p_ticket_types) e where e ->> 'id' = t.id);

  insert into public.ticket_types
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available, opens_after_previous)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer,
         -- Absent: the stored value. Never the first position.
         x.ord > 1 and coalesce((x.e ->> 'opensAfterPrevious')::boolean, s.opens_after_previous, false)
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  left join public.ticket_types s on s.event_id = p_event_id and s.id = x.e ->> 'id'
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available,
    opens_after_previous = excluded.opens_after_previous;

  -- External: the organiser's free flag. Otherwise free only with at least
  -- one ticket type and none of them paid.
  update public.events e
  set is_free = case when e.ticketing_mode = 'external' then e.external_free
                     else exists (select 1 from public.ticket_types where event_id = p_event_id)
                          and not exists (select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0)
                end
  where e.id = p_event_id;
end;
$$;

revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_edit_event: as 20261114000000_external_price.sql, plus the flag in the
-- ticket types it compares and logs (absent from the request: the stored one)
-- ---------------------------------------------------------------------------

create or replace function private.admin_edit_event(
  p_event_id uuid, p_admin_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_ticket_types jsonb, p_publish boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_organiser_id uuid;
  v_org record;
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_refund_policy text;
  v_refund_days integer;
  v_state text;
  v_time_zone text;
  v_location_source text;
  v_place_id text;
  v_pin_lat double precision;
  v_pin_lng double precision;
  v_price integer;
  v_ticketing_changed boolean;
  v_publish boolean;
  v_old jsonb;
  v_new jsonb;
  v_details jsonb;
  v_ticketing_result text;
begin
  select e.organiser_id into v_organiser_id from public.events e where e.id = p_event_id;
  if not found then
    return 'not_found';
  end if;
  -- Organiser (share), then event, as event approval and suspend_organiser.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = v_organiser_id for share;
  select e.* into v_event from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if date_trunc('milliseconds', v_event.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at)
     or v_event.organiser_id <> v_organiser_id then
    return 'stale';
  end if;

  if p_fields ? 'refundPolicy' then
    v_refund_policy := p_fields ->> 'refundPolicy';
    v_refund_days := (p_fields ->> 'refundDays')::integer;
  else
    v_refund_policy := v_event.refund_policy;
    v_refund_days := v_event.refund_days;
  end if;
  v_state := coalesce(p_fields ->> 'state', v_event.state);
  v_time_zone := coalesce(p_fields ->> 'timeZone', v_event.time_zone);
  if p_fields ? 'locationSource' then
    v_location_source := p_fields ->> 'locationSource';
    v_place_id := p_fields ->> 'placeId';
    v_pin_lat := (p_fields ->> 'pinLat')::double precision;
    v_pin_lng := (p_fields ->> 'pinLng')::double precision;
  else
    v_location_source := v_event.location_source;
    v_place_id := v_event.venue_place_id;
    v_pin_lat := v_event.venue_lat;
    v_pin_lng := v_event.venue_lng;
  end if;

  -- As edit_event_draft reads it: only for a paid external event; kept when not sent.
  v_price := case when v_mode <> 'external' or v_free then null
                  when p_fields ? 'externalPriceFromCents' then (p_fields ->> 'externalPriceFromCents')::integer
                  else v_event.external_price_from_cents end;

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free
    or v_event.external_price_from_cents is distinct from v_price;
  v_publish := coalesce(p_publish, false) and v_event.status <> 'published';

  -- Every other field, old and new, in the API's names. Ticket types in the
  -- request's shape (an empty description left out; opensAfterPrevious only
  -- when set), in display order.
  v_old := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'category', v_event.category::text,
    'venueName', v_event.venue_name,
    'venueAddress', v_event.venue_address,
    'suburb', v_event.suburb,
    'state', v_event.state,
    'timeZone', v_event.time_zone,
    'location', private.event_location_json(v_event.location_source, v_event.venue_place_id,
                                            v_event.venue_lat, v_event.venue_lng),
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'refundPolicy', v_event.refund_policy,
    'refundDays', v_event.refund_days,
    'ticketTypes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description, 'priceCents', t.price_cents,
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available,
               'opensAfterPrevious', case when t.opens_after_previous then true end)) order by t.position)
        from public.ticket_types t where t.event_id = p_event_id), '[]'::jsonb));
  v_new := jsonb_build_object(
    'title', p_fields ->> 'title',
    'description', p_fields ->> 'description',
    'category', p_fields ->> 'category',
    'venueName', p_fields ->> 'venueName',
    'venueAddress', p_fields ->> 'venueAddress',
    'suburb', p_fields ->> 'suburb',
    'state', v_state,
    'timeZone', v_time_zone,
    'location', private.event_location_json(v_location_source, v_place_id, v_pin_lat, v_pin_lng),
    'startsAt', (p_fields ->> 'startsAt')::timestamptz,
    'endsAt', (p_fields ->> 'endsAt')::timestamptz,
    'refundPolicy', v_refund_policy,
    'refundDays', v_refund_days,
    'ticketTypes', case when v_mode = 'external' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.e ->> 'id', 'name', x.e ->> 'name', 'description', nullif(x.e ->> 'description', ''),
               'priceCents', (x.e ->> 'priceCents')::integer, 'feePolicy', x.e ->> 'feePolicy',
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer,
               -- As replace_ticket_types stores it: absent keeps the stored value; never the first position.
               'opensAfterPrevious', case when x.ord > 1
                 and coalesce((x.e ->> 'opensAfterPrevious')::boolean, s.opens_after_previous, false) then true end))
               order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
        left join public.ticket_types s on s.event_id = p_event_id and s.id = x.e ->> 'id'), '[]'::jsonb) end);
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_details
    from jsonb_object_keys(v_new) k
   where (v_old -> k) is distinct from (v_new -> k);

  if v_details = '{}'::jsonb and not v_ticketing_changed and not v_publish then
    return 'unchanged';
  end if;

  -- Refusals, before anything is written.
  if v_org.owner_user_id is null and v_mode = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    return 'platform_paid';
  end if;
  if v_mode = 'external' and v_event.ticketing_mode <> 'external'
     and exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  if private.refund_policy_tightens(v_event.refund_policy, v_event.refund_days, v_refund_policy, v_refund_days)
     and private.event_has_payable_orders(p_event_id) then
    return 'refund_policy_tightened';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and p_reason is null
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'reason_required';
  end if;
  if v_publish and v_org.status <> 'approved' then
    return 'organiser_not_approved';
  end if;

  -- Ticketing first: switching to external deletes the ticket types, and
  -- switching back leaves none for replace_ticket_types to add below.
  if v_ticketing_changed then
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, v_price, p_reason);
    if v_ticketing_result <> 'updated' then
      raise exception 'admin_edit_event: unexpected ticketing result %', v_ticketing_result;
    end if;
  end if;

  if v_details - 'ticketTypes' <> '{}'::jsonb then
    update public.events set
      title = p_fields ->> 'title',
      description = p_fields ->> 'description',
      category = (p_fields ->> 'category')::public.event_category,
      venue_name = p_fields ->> 'venueName',
      venue_address = p_fields ->> 'venueAddress',
      suburb = p_fields ->> 'suburb',
      starts_at = (p_fields ->> 'startsAt')::timestamptz,
      ends_at = (p_fields ->> 'endsAt')::timestamptz,
      refund_policy = v_refund_policy,
      refund_days = v_refund_days,
      state = v_state,
      time_zone = v_time_zone,
      location_source = v_location_source,
      venue_place_id = v_place_id,
      venue_lat = v_pin_lat,
      venue_lng = v_pin_lng
    where id = p_event_id;
  end if;
  if v_mode = 'sheltuh' and v_details ? 'ticketTypes' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;

  if v_details <> '{}'::jsonb then
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_admin_id, p_reason, v_details);
  end if;

  if v_publish then
    if not private.transition_event(p_event_id, array['draft', 'pending_review', 'rejected']::public.event_status[],
                                    'published', 'approved', p_admin_id) then
      raise exception 'admin_edit_event: the event could not be published';
    end if;
  end if;
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's toggle
-- ---------------------------------------------------------------------------

create function private.set_ticket_lock(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_ticket_type_id text, p_locked boolean,
  p_limit integer, p_window interval, p_event_limit integer, p_event_window interval,
  out result text, out locked boolean, out blocker_id text, out blocker_name text
)
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_ticket record;
  v_old jsonb;
  v_new jsonb;
begin
  if p_actor_id is null then
    result := 'not_found';
    return;
  end if;
  if p_locked is null or p_limit is null or p_window is null
     or p_event_limit is null or p_event_window is null then
    raise exception 'set_ticket_lock: a setting or limit is missing';
  end if;

  select o.status::text as status, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  if not found or v_org.owner_user_id is distinct from p_actor_id then
    result := 'not_found';
    return;
  end if;
  if v_org.status <> 'approved' then
    result := 'not_approved';
    return;
  end if;

  select e.status::text as status, e.ends_at, e.ticketing_mode
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_event.status <> 'published' then
    result := 'not_published';
    return;
  end if;
  if v_event.ends_at <= now() then
    result := 'ended';
    return;
  end if;
  if v_event.ticketing_mode <> 'sheltuh' then
    result := 'external';
    return;
  end if;

  select t.name, t.position, t.seated, t.opens_after_previous,
         t.quantity_available, t.quantity_sold, t.sold_out_at
    into v_ticket
    from public.ticket_types t
   where t.event_id = p_event_id and t.id = p_ticket_type_id
     for update;
  if not found then
    result := 'not_found';
    return;
  end if;

  if v_ticket.opens_after_previous = p_locked then
    result := 'unchanged';
  else
    if p_locked then
      if v_ticket.seated then
        result := 'seated';
        return;
      end if;
      if not exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.position < v_ticket.position) then
        result := 'first_tier';
        return;
      end if;
    end if;
    -- Last, so only a change that would happen uses a slot: the event's
    -- first (a plain read once it's over the limit), then the organiser's.
    if not private.take_event_rate_limit(p_event_id, 'ticket_locks', p_event_limit, p_event_window) then
      result := 'rate_limited';
      return;
    end if;
    if not private.take_rate_limit(p_actor_id, 'ticket_locks', p_limit, p_window) then
      result := 'rate_limited';
      return;
    end if;

    v_old := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'id', p_ticket_type_id, 'name', v_ticket.name, 'quantityAvailable', v_ticket.quantity_available,
               'opensAfterPrevious', case when v_ticket.opens_after_previous then true end)));
    update public.ticket_types t
       set opens_after_previous = p_locked
     where t.event_id = p_event_id and t.id = p_ticket_type_id;
    v_new := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'id', p_ticket_type_id, 'name', v_ticket.name, 'quantityAvailable', v_ticket.quantity_available,
               'opensAfterPrevious', case when p_locked then true end)));

    -- events_set_updated_at sets the time.
    update public.events set updated_at = now() where id = p_event_id;
    insert into public.event_moderation_log (event_id, action, actor_id, details)
    values (p_event_id, 'edited', p_actor_id,
            jsonb_build_object('ticketTypes', jsonb_build_object('old', v_old, 'new', v_new)));
    result := 'set';
  end if;

  select l.blocker_id, l.blocker_name into blocker_id, blocker_name
    from private.ticket_type_locks(p_event_id) l where l.ticket_type_id = p_ticket_type_id;
  locked := found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_sold_out_at() from public, anon, authenticated;
revoke all on function private.orders_tiers_open() from public, anon, authenticated;
revoke all on function private.ticket_type_locks(uuid) from public, anon, authenticated;
revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
revoke all on function private.set_ticket_lock(uuid, uuid, uuid, text, boolean, integer, interval, integer, interval)
  from public, anon, authenticated;
