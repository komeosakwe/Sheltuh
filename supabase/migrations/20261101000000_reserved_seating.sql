-- Reserved seating, part 1: seat maps (docs/SEATING_PLAN.md, docs/architecture.md
-- "Reserved seating"). Part 2 (20261101000100_seat_holds.sql) adds holds,
-- sales, and the checkout, fulfilment, refund and check-in changes.
--
--   * public.event_seat_maps: one optional map per event: the layout as the
--     API validated it (lib/seating/template.ts: sections → rows → seats,
--     coordinates, stage, focus point), its seat count, and a version. The
--     version comes from one sequence (private.seat_map_versions), so it is
--     never reused, not even by a map deleted and made again: the public
--     GET …/seat-map?v= is cached for a long time under it.
--   * public.event_seats: the map's seats as rows, derived from the layout in
--     the same statement that stores it (private.write_seat_map), so the two
--     can't disagree: id (the layout's, stable), position (map order: the
--     availability bitmap's bit), section, row and seat labels, ticket type
--     (its price tier: fees, orders, analytics, refunds and the waitlist all
--     keep working on ticket types), kind (standard, wheelchair, companion)
--     and blocked.
--   * ticket_types.seated: the tier has seats on the map. A seated tier's
--     quantity_available is always its number of unblocked seats: the
--     ticket_types_seated_capacity trigger sets it whenever the row is
--     written, whatever the API sends (so an editor's stale quantity can't
--     change it), and private.write_seat_map recomputes every tier after a map
--     change. The existing ticket_types_not_oversold check still applies.
--   * At most 5 ticket types (price tiers) on one map (manager decision,
--     docs/design/seating.md): private.write_seat_map refuses more
--     (check_violation, constraint event_seat_maps_max_tiers).
--   * The map is the organiser's to build while the event is a draft (or
--     rejected) and has never been approved (private.replace_seat_map,
--     private.delete_seat_map: 'frozen' otherwise, like the ticketing freeze).
--     After that only an admin can replace or remove it, only while the event
--     has no orders of any status, and it's logged
--     (private.admin_replace_seat_map: an `edited` entry with
--     changes.seatMap old and new {version, seatCount}).
--   * External ticketing has no map: event_seat_maps_sheltuh_only refuses one,
--     and switching an event to external (private.edit_event_draft, before
--     approval; private.admin_set_event_ticketing, without orders) deletes it
--     with the ticket types. A ticket type that has seats can't be removed
--     (event_seats_ticket_type_fkey, the API's 409), nor can a map with sold
--     seats (part 2's tickets foreign key).
--   * Every map write (insert, update, delete) bumps the event's updated_at
--     (event_seat_maps_touch_event), so an admin's PATCH /admin/events/{id}
--     made from a version loaded before a map change is stale (409), like a
--     photo change. Holds and sales (part 2) never touch the map row.
--   * Lock order (both parts): the event's seat advisory lock
--     (private.lock_event_seats), the order, the event, ticket types in id
--     order, seats in id order. Functions that lock the event row first
--     (edit_event_draft, admin_set_event_ticketing) never take the advisory
--     lock: holding the event row (for no key update) already excludes holds,
--     which share-lock the event row before touching any seat.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated (supabase-stubs.sql mirrors Supabase's default grants, which
-- are revoked below), every new or redefined function pins its search_path
-- and has execute revoked from PUBLIC, anon and authenticated.
--
-- Indexes: event_seat_maps_pkey (event_id) serves every map read and the
-- event's cascade; event_seats_pkey (event_id, id) serves seat lookups by id
-- and the per-event scans (availability, capacity); event_seats_position_key
-- (event_id, position) and event_seats_label_key (labels) are uniqueness
-- rules; event_seats_tier_idx (event_id, ticket_type_id) serves the
-- ticket_types foreign key's checks when a tier is removed, and each tier's
-- capacity count.
--
-- Reversible, not destructive of anything but seat maps: drop the triggers
-- and functions added here, restore private.edit_event_draft and
-- private.admin_set_event_ticketing from 20261022000000_external_ticketing.sql,
-- drop tables public.event_seats and public.event_seat_maps (every seat map
-- is lost: layouts only, no personal data; drop part 2 first), drop column
-- ticket_types.seated (seated tiers keep their last capacity) and the
-- sequence.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create sequence private.seat_map_versions as integer;
revoke all on sequence private.seat_map_versions from public, anon, authenticated;

alter table public.ticket_types add column seated boolean not null default false;

create table public.event_seat_maps (
  event_id uuid primary key references public.events (id) on delete cascade,
  -- From private.seat_map_versions: never reused.
  version integer not null check (version >= 1),
  -- The validated template (lib/seating/template.ts), as stored and served.
  layout jsonb not null constraint event_seat_maps_layout_object check (jsonb_typeof(layout) = 'object'),
  seat_count integer not null check (seat_count between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger event_seat_maps_set_updated_at before update on public.event_seat_maps
  for each row execute function public.set_updated_at();

create table public.event_seats (
  event_id uuid not null references public.event_seat_maps (event_id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- Map order, 0-based: the seat's bit in the availability bitmap.
  position integer not null check (position between 0 and 9999),
  section_label text not null check (char_length(section_label) between 1 and 40),
  -- Empty when the row has no name ("Box A · Seat 3").
  row_label text not null check (char_length(row_label) <= 10),
  seat_label text not null check (char_length(seat_label) between 1 and 10),
  ticket_type_id text not null,
  kind text not null default 'standard' check (kind in ('standard', 'wheelchair', 'companion')),
  -- Never sold (part 2 also refuses a hold or sale of a blocked seat).
  blocked boolean not null default false,
  primary key (event_id, id),
  constraint event_seats_position_key unique (event_id, position),
  constraint event_seats_label_key unique (event_id, section_label, row_label, seat_label),
  -- NO ACTION: removing a ticket type that seats use fails with this name (the API's 409).
  constraint event_seats_ticket_type_fkey foreign key (event_id, ticket_type_id)
    references public.ticket_types (event_id, id)
);

create index event_seats_tier_idx on public.event_seats (event_id, ticket_type_id);

alter table public.event_seat_maps enable row level security;
alter table public.event_seats enable row level security;
revoke all on public.event_seat_maps, public.event_seats from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A seated tier's capacity is its unblocked seats, whatever was written.
create function private.ticket_types_seated_capacity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seated then
    new.quantity_available := (select count(*)::integer from public.event_seats s
                                 where s.event_id = new.event_id and s.ticket_type_id = new.id and not s.blocked);
  end if;
  return new;
end;
$$;

create trigger ticket_types_seated_capacity before insert or update of quantity_available, seated on public.ticket_types
  for each row execute function private.ticket_types_seated_capacity();

-- External ticketing has no seat map.
create function private.event_seat_maps_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.ticketing_mode = 'external') then
    raise exception 'An event with external ticketing has no seat map.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger event_seat_maps_sheltuh_only before insert on public.event_seat_maps
  for each row execute function private.event_seat_maps_sheltuh_only();

-- A map change is a change to the event (its updated_at, the admin editor's version).
create function private.event_seat_maps_touch_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- events_set_updated_at sets the time. When the event itself is being
  -- deleted (the map goes with it), its row is already gone: nothing to do.
  update public.events set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end;
$$;

create trigger event_seat_maps_touch_event after insert or update or delete on public.event_seat_maps
  for each row execute function private.event_seat_maps_touch_event();

-- ---------------------------------------------------------------------------
-- Writing a map (internal: callers hold the locks and check permission)
-- ---------------------------------------------------------------------------

-- The event's seat lock: first in every seat-changing path (see header).
create function private.lock_event_seats(p_event_id uuid) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('event_seats:' || p_event_id::text, 0));
$$;

-- Stores p_layout (already validated by lib/seating/template.ts) as
-- p_event_id's map, replacing any other, and recomputes its ticket types'
-- seated flag and capacity. Returns 'saved', or 'unchanged' when the stored
-- layout is the same (nothing written, the version kept). The caller holds
-- the seat lock and the event row, and has checked that no seat is held or
-- sold (no orders).
create function private.write_seat_map(p_event_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'sections') <> 'array' then
    raise exception 'invalid seat map layout' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout) then
    return 'unchanged';
  end if;

  select count(*)::integer into v_count
    from jsonb_array_elements(p_layout -> 'sections') s (section)
   cross join lateral jsonb_array_elements(s.section -> 'rows') r (rw)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') k (seat);

  -- Ticket types in id order (fulfil_order's order), before any seat.
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;

  delete from public.event_seats s where s.event_id = p_event_id;
  insert into public.event_seat_maps (event_id, version, layout, seat_count)
  values (p_event_id, nextval('private.seat_map_versions')::integer, p_layout, v_count)
  on conflict (event_id) do update
     set version = excluded.version, layout = excluded.layout, seat_count = excluded.seat_count;

  insert into public.event_seats
    (event_id, id, position, section_label, row_label, seat_label, ticket_type_id, kind, blocked)
  select p_event_id,
         k.seat ->> 'id',
         (row_number() over (order by s.si, r.ri, k.ki))::integer - 1,
         s.section ->> 'label',
         r.rw ->> 'label',
         k.seat ->> 'label',
         k.seat ->> 'ticketTypeId',
         coalesce(k.seat ->> 'kind', 'standard'),
         coalesce((k.seat ->> 'blocked')::boolean, false)
    from jsonb_array_elements(p_layout -> 'sections') with ordinality as s (section, si)
   cross join lateral jsonb_array_elements(s.section -> 'rows') with ordinality as r (rw, ri)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') with ordinality as k (seat, ki);

  -- At most 5 price tiers on a map (manager decision, docs/design/seating.md):
  -- buyers tell them apart by pattern, not colour.
  if (select count(distinct s.ticket_type_id) from public.event_seats s where s.event_id = p_event_id) > 5 then
    raise exception 'A seat map can use at most 5 ticket types.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_max_tiers';
  end if;

  -- quantity_available is rewritten to itself so ticket_types_seated_capacity recomputes it.
  update public.ticket_types t
     set seated = exists (select 1 from public.event_seats s where s.event_id = t.event_id and s.ticket_type_id = t.id),
         quantity_available = t.quantity_available
   where t.event_id = p_event_id;
  return 'saved';
end;
$$;

-- Removes p_event_id's map (its seats go with it) and unmarks its seated
-- tiers, which keep their last capacity. Returns 'deleted', or 'unchanged'
-- when there was none. Same preconditions as write_seat_map.
create function private.clear_seat_map(p_event_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id) then
    return 'unchanged';
  end if;
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;
  delete from public.event_seat_maps m where m.event_id = p_event_id;
  update public.ticket_types t set seated = false where t.event_id = p_event_id and t.seated;
  return 'deleted';
end;
$$;

-- {version, seatCount} of p_event_id's map, or null: for log entries.
create function private.seat_map_summary(p_event_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('version', m.version, 'seatCount', m.seat_count)
    from public.event_seat_maps m where m.event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's map
-- ---------------------------------------------------------------------------

-- The organiser's save (PUT /api/events/{id}/seat-map). Returns:
--   'saved' / 'unchanged'  as write_seat_map
--   'not_found'            no such event, or not p_organiser_id's
--   'not_editable'         not draft or rejected
--   'frozen'               approved before: only an admin can change the map now
--   'external'             tickets are sold on another site
-- A seat whose ticket type isn't the event's raises foreign_key_violation
-- (event_seats_ticket_type_fkey; the API checked first, so only a race).
create function private.replace_seat_map(p_event_id uuid, p_organiser_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status, e.ticketing_mode into v_event
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if v_event.ticketing_mode = 'external' then
    return 'external';
  end if;
  return private.write_seat_map(p_event_id, p_layout);
end;
$$;

-- The organiser's removal (DELETE /api/events/{id}/seat-map): the same
-- checks; 'deleted', or 'unchanged' when there's none.
create function private.delete_seat_map(p_event_id uuid, p_organiser_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status into v_status
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  return private.clear_seat_map(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- An admin's map change
-- ---------------------------------------------------------------------------

-- Replaces (p_layout) or removes (p_layout null) p_event_id's map, whatever
-- its status, while it has no orders of any status (a pending order may hold
-- seats). Logged `edited` by p_admin_id with p_reason (required) and
-- changes.seatMap {old, new}: each {version, seatCount} or null. Returns
-- 'saved', 'deleted', 'unchanged' (nothing written or logged), 'not_found',
-- 'external' (saving a map for an external event) or 'has_orders'.
create function private.admin_replace_seat_map(
  p_event_id uuid, p_admin_id uuid, p_layout jsonb, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
  v_old jsonb;
  v_result text;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'a reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  perform private.lock_event_seats(p_event_id);
  select e.ticketing_mode into v_mode from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if p_layout is not null and v_mode = 'external' then
    return 'external';
  end if;
  v_old := private.seat_map_summary(p_event_id);
  if (p_layout is null and v_old is null)
     or (p_layout is not null and exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout)) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;

  if p_layout is null then
    v_result := private.clear_seat_map(p_event_id);
  else
    v_result := private.write_seat_map(p_event_id, p_layout);
  end if;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'edited', p_admin_id, btrim(p_reason),
          jsonb_build_object('seatMap', jsonb_build_object('old', v_old, 'new', private.seat_map_summary(p_event_id))));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Switching to external ticketing removes the map
-- ---------------------------------------------------------------------------

-- As in 20261022000000_external_ticketing.sql, plus: switching to external
-- removes the seat map before the ticket types (its seats reference them).
-- Only a never-approved event's ticketing can change here, so it has no
-- orders and no seat is held or sold. The event row is locked first; no
-- seat advisory lock (see the header).
create or replace function private.edit_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  select e.status, e.ticketing_mode, e.external_ticket_url into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'ticketing_frozen';
  end if;

  if v_mode = 'external' then
    perform private.clear_seat_map(p_event_id);
    perform private.replace_ticket_types(p_event_id, '[]'::jsonb);
  end if;

  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz,
    ticketing_mode = v_mode,
    external_ticket_url = v_url,
    external_free = v_free,
    is_free = case when v_mode = 'external' then v_free else is_free end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- As in 20261022000000_external_ticketing.sql, plus: switching to external
-- (which needs an event without orders) removes the seat map before the
-- ticket types, and the entry's details record it (seatMap {old, new: null}).
create or replace function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_details jsonb := '{}'::jsonb;
  v_map jsonb;
begin
  select e.ticketing_mode, e.external_ticket_url, e.external_free into v_event
    from public.events e where e.id = p_event_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  if v_event.ticketing_mode is distinct from p_mode then
    v_details := v_details || jsonb_build_object('ticketingMode', jsonb_build_object('old', v_event.ticketing_mode, 'new', p_mode));
  end if;
  if v_event.external_ticket_url is distinct from p_url then
    v_details := v_details
      || jsonb_build_object('externalTicketUrl', jsonb_build_object('old', v_event.external_ticket_url, 'new', p_url));
  end if;
  if v_event.external_free is distinct from p_free then
    v_details := v_details || jsonb_build_object('externalFree', jsonb_build_object('old', v_event.external_free, 'new', p_free));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  if p_mode = 'external' and v_event.ticketing_mode <> 'external' then
    if exists (select 1 from public.orders o where o.event_id = p_event_id) then
      return 'has_orders';
    end if;
    v_map := private.seat_map_summary(p_event_id);
    if v_map is not null then
      perform private.clear_seat_map(p_event_id);
      v_details := v_details || jsonb_build_object('seatMap', jsonb_build_object('old', v_map, 'new', null));
    end if;
    delete from public.ticket_types t where t.event_id = p_event_id;
  end if;

  update public.events e set
    ticketing_mode = p_mode,
    external_ticket_url = p_url,
    external_free = p_free,
    is_free = case when p_mode = 'external' then p_free
                   else exists (select 1 from public.ticket_types t where t.event_id = p_event_id)
                        and not exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0)
              end
  where e.id = p_event_id;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'ticketing_changed', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.ticket_types_seated_capacity() from public, anon, authenticated;
revoke all on function private.event_seat_maps_sheltuh_only() from public, anon, authenticated;
revoke all on function private.event_seat_maps_touch_event() from public, anon, authenticated;
revoke all on function private.lock_event_seats(uuid) from public, anon, authenticated;
revoke all on function private.write_seat_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.clear_seat_map(uuid) from public, anon, authenticated;
revoke all on function private.seat_map_summary(uuid) from public, anon, authenticated;
revoke all on function private.replace_seat_map(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.delete_seat_map(uuid, uuid) from public, anon, authenticated;
revoke all on function private.admin_replace_seat_map(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;
