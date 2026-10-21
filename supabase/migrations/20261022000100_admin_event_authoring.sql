-- Admin event authoring (docs/FEATURE_PLAN.md, B3; docs/architecture.md,
-- "Admin authoring"): admins create platform-managed organisers (no owner
-- account) and create or edit events for any organiser.
--
--   * public.moderation_action gains 'created' (an admin created the event),
--     'edited' (an admin changed it; `details` holds the old and new value of
--     each changed field, like 'ticketing_changed') and 'curated' (reserved
--     for B4's curation; nothing writes it yet).
--   * Platform-managed organisers (owner_user_id null) sell no paid Sheltüh
--     tickets and have no check-in, enforced here whatever the code does:
--       - organisers_platform_no_payouts: no Stripe account or payouts;
--       - ticket_types_platform_free_only: no ticket type with a price;
--       - orders_platform_free_only: no order with a price;
--       - events_platform_free_only / organisers_platform_free_only: an event
--         with a paid ticket type can't move to such an organiser, and an
--         organiser with one can't lose its owner;
--       - ticket_check_ins_owned_organiser_only (trigger
--         ticket_check_ins_guard): no check-in row (scan or undo) for such
--         an organiser's event.
--   * ticket_check_ins_guard also refuses check-in rows for an external
--     event (ticket_check_ins_sheltuh_only), so the API needs no read of the
--     event before each scan (code review of B2).
--     Free Sheltüh tickets and external ticketing stay available to them.
--   * private.admin_create_event: an admin's new event for an approved
--     organiser, logged 'created', and optionally published through
--     private.transition_event ('approved'), in one step.
--   * private.admin_edit_event: an admin's edit of any field of any event,
--     whatever its status, with optimistic concurrency (the caller's
--     expected updated_at, to the millisecond, or 'stale'). Ticketing changes
--     go through private.admin_set_event_ticketing (logged
--     'ticketing_changed', as B2's endpoint); every other change is one
--     'edited' entry. Optionally publishes, as above.
--   * private.admin_put_event_image / admin_delete_event_image: an admin's
--     photo change on any event, logged 'edited' ({"image": {old, new}}).
--
-- Locks: the organiser row first (for share), then the event row, the order
-- event approval and private.suspend_organiser already use, so an edit, an
-- approval and a takedown can't deadlock.
--
-- Access model as everywhere else: no new table; every new function pins its
-- search_path and has execute revoked from PUBLIC, anon and authenticated.
-- No new index: every new query is by primary key, or by the existing
-- ticket_types (event_id, id), orders (event_id) and event_moderation_log
-- (event_id, id) indexes.
--
-- Additive. Reversible before launch: drop the functions
-- private.admin_create_event, private.admin_edit_event,
-- private.admin_put_event_image, private.admin_delete_event_image, the five
-- triggers and their functions, and the organisers_platform_no_payouts
-- constraint. The enum values can't be removed from public.moderation_action
-- without recreating the type (harmless if left). Applying it fails if an
-- organiser without an owner already has a Stripe account (none should).
-- Existing paid ticket types of platform-managed organisers (dev seed data
-- from before this migration) are left alone, but can't be saved again with
-- a price.

alter type public.moderation_action add value if not exists 'created';
alter type public.moderation_action add value if not exists 'edited';
alter type public.moderation_action add value if not exists 'curated';

-- ---------------------------------------------------------------------------
-- Platform-managed organisers: free Sheltüh tickets or external ticketing only
-- ---------------------------------------------------------------------------

-- No owner, so nobody can onboard to Stripe Connect for it: never paid out.
alter table public.organisers
  add constraint organisers_platform_no_payouts
  check (owner_user_id is not null or (stripe_account_id is null and not payouts_enabled));

-- Every ticket type insert comes through private.replace_ticket_types (an
-- upsert: this BEFORE INSERT trigger sees the new price even when the row
-- then updates an existing one).
create function private.ticket_types_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price_cents > 0 and exists (
    select 1 from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = new.event_id and o.owner_user_id is null
  ) then
    raise exception 'A platform-managed organiser''s event can only have free Sheltüh tickets.'
      using errcode = 'check_violation', constraint = 'ticket_types_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger ticket_types_platform_free_only before insert or update of price_cents on public.ticket_types
  for each row execute function private.ticket_types_platform_free_only();

-- Belt and braces behind the ticket types: no order with a price.
create function private.orders_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.subtotal_cents > 0 or new.total_cents > 0) and exists (
    select 1 from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = new.event_id and o.owner_user_id is null
  ) then
    raise exception 'A platform-managed organiser''s event has no paid Sheltüh tickets.'
      using errcode = 'check_violation', constraint = 'orders_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger orders_platform_free_only before insert on public.orders
  for each row execute function private.orders_platform_free_only();

-- No API moves an event to another organiser or removes an organiser's
-- owner; these keep a by-hand change from getting round the rule.
create function private.events_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organiser_id is distinct from old.organiser_id
     and exists (select 1 from public.organisers o where o.id = new.organiser_id and o.owner_user_id is null)
     and exists (select 1 from public.ticket_types t where t.event_id = new.id and t.price_cents > 0) then
    raise exception 'An event with paid tickets can''t move to a platform-managed organiser.'
      using errcode = 'check_violation', constraint = 'events_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger events_platform_free_only before update of organiser_id on public.events
  for each row execute function private.events_platform_free_only();

create function private.organisers_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is null and old.owner_user_id is not null and exists (
    select 1 from public.events e join public.ticket_types t on t.event_id = e.id
     where e.organiser_id = new.id and t.price_cents > 0
  ) then
    raise exception 'An organiser with paid tickets can''t become platform-managed.'
      using errcode = 'check_violation', constraint = 'organisers_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger organisers_platform_free_only before update of owner_user_id on public.organisers
  for each row execute function private.organisers_platform_free_only();

-- Check-in is the owning organiser's (private.check_in_ticket and
-- undo_check_in check ownership through the caller's organiser). A
-- platform-managed organiser has no owner to sign in as; this refuses its
-- events' check-in rows outright, so neither function can ever admit or undo
-- for one, whoever calls it. It also refuses rows for an external event
-- (no Sheltüh tickets): a scan of one rolls back, its rate-limit hit
-- included, and the API answers 409 without reading the event first.
create function private.ticket_check_ins_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  select o.owner_user_id is null as platform_managed, e.ticketing_mode into v_event
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = new.event_id;
  if v_event.platform_managed then
    raise exception 'A platform-managed organiser''s event has no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_owned_organiser_only';
  end if;
  if v_event.ticketing_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site: there''s no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger ticket_check_ins_guard before insert on public.ticket_check_ins
  for each row execute function private.ticket_check_ins_guard();

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_platform_free_only() from public, anon, authenticated;
revoke all on function private.orders_platform_free_only() from public, anon, authenticated;
revoke all on function private.events_platform_free_only() from public, anon, authenticated;
revoke all on function private.organisers_platform_free_only() from public, anon, authenticated;
revoke all on function private.ticket_check_ins_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's new event
-- ---------------------------------------------------------------------------

-- p_fields and p_ticket_types as private.create_event_draft's (already
-- validated by lib/server/event-input.ts). Returns:
--   result 'created'                 a draft, logged 'created' by p_admin_id
--          'published'               the same, then published through
--                                    private.transition_event ('approved')
--          'organiser_not_found'     no such organiser: nothing written
--          'organiser_not_approved'  the organiser isn't approved: nothing written
--          'platform_paid'           a platform-managed organiser and a paid
--                                    Sheltüh ticket type: nothing written
--   new_event_id                     the event's id ('created' / 'published')
-- A slug that's taken raises unique_violation (events_slug_key): the API
-- retries with another, and nothing from the failed attempt is kept.
create function private.admin_create_event(
  p_organiser_id uuid, p_admin_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb, p_publish boolean,
  out result text, out new_event_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
begin
  -- The organiser first (share), as event approval does: a takedown can't
  -- interleave, so a published event's organiser is approved when it commits.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = p_organiser_id for share;
  if not found then
    result := 'organiser_not_found';
    return;
  end if;
  if v_org.status <> 'approved' then
    result := 'organiser_not_approved';
    return;
  end if;
  if v_org.owner_user_id is null
     and coalesce(p_fields ->> 'ticketingMode', 'sheltuh') = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    result := 'platform_paid';
    return;
  end if;

  new_event_id := private.create_event_draft(p_organiser_id, p_slug, p_fields, p_ticket_types);
  insert into public.event_moderation_log (event_id, action, actor_id) values (new_event_id, 'created', p_admin_id);

  if p_publish then
    if not private.transition_event(new_event_id, array['draft']::public.event_status[], 'published', 'approved', p_admin_id) then
      raise exception 'admin_create_event: the new draft could not be published';
    end if;
    result := 'published';
  else
    result := 'created';
  end if;
end;
$$;

revoke all on function private.admin_create_event(uuid, uuid, text, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's edit
-- ---------------------------------------------------------------------------

-- Replaces p_event_id's fields and ticket types (p_fields / p_ticket_types as
-- private.edit_event_draft's) whatever its status, if it's still the version
-- the admin saw (p_expected_updated_at, compared to the millisecond: the API
-- sends updatedAt with millisecond precision). Optionally publishes it.
-- Refusals are all decided before anything is written. Returns:
--   'updated'                 saved: ticketing changes logged
--                             'ticketing_changed' (private.admin_set_event_ticketing,
--                             with p_reason), every other changed field in one
--                             'edited' entry (old and new values in `details`,
--                             with p_reason); then published if asked
--                             ('approved', through private.transition_event)
--   'unchanged'               nothing would change: nothing written
--   'not_found'               no such event
--   'stale'                   changed since p_expected_updated_at: nothing written
--   'has_orders'              switching to external an event with orders
--   'platform_paid'           a platform-managed organiser and a paid
--                             Sheltüh ticket type
--   'reason_required'         the ticketing mode or link of an event that has
--                             been approved before, without p_reason (B2's
--                             endpoint always needs one)
--   'organiser_not_approved'  publishing, but the organiser isn't approved
-- Removing a ticket type that has sold tickets, or cutting its quantity below
-- what's sold, raises (foreign_key_violation / check_violation) from
-- private.replace_ticket_types, and nothing is kept.
create function private.admin_edit_event(
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

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free;
  v_publish := coalesce(p_publish, false) and v_event.status <> 'published';

  -- Every other field, old and new, in the API's names. Ticket types in the
  -- request's shape (an empty description left out), in display order.
  v_old := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'category', v_event.category::text,
    'venueName', v_event.venue_name,
    'venueAddress', v_event.venue_address,
    'suburb', v_event.suburb,
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'ticketTypes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description, 'priceCents', t.price_cents,
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available)) order by t.position)
        from public.ticket_types t where t.event_id = p_event_id), '[]'::jsonb));
  v_new := jsonb_build_object(
    'title', p_fields ->> 'title',
    'description', p_fields ->> 'description',
    'category', p_fields ->> 'category',
    'venueName', p_fields ->> 'venueName',
    'venueAddress', p_fields ->> 'venueAddress',
    'suburb', p_fields ->> 'suburb',
    'startsAt', (p_fields ->> 'startsAt')::timestamptz,
    'endsAt', (p_fields ->> 'endsAt')::timestamptz,
    'ticketTypes', case when v_mode = 'external' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.e ->> 'id', 'name', x.e ->> 'name', 'description', nullif(x.e ->> 'description', ''),
               'priceCents', (x.e ->> 'priceCents')::integer, 'feePolicy', x.e ->> 'feePolicy',
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer)) order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)), '[]'::jsonb) end);
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
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, p_reason);
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
      ends_at = (p_fields ->> 'endsAt')::timestamptz
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

revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's photo change
-- ---------------------------------------------------------------------------

-- Sets p_event_id's photo, whatever its status, and logs it ('edited',
-- {"image": {"old": "set" or null, "new": "set"}}). The event row is
-- key-share locked (as the image's foreign key would), so the event can't be
-- deleted under it. Returns 'updated' or 'not_found'.
create function private.admin_put_event_image(
  p_event_id uuid, p_admin_id uuid, p_content_type text, p_data bytea
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_had boolean;
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;
  select exists (select 1 from public.event_images i where i.event_id = p_event_id) into v_had;

  insert into public.event_images (event_id, content_type, data)
  values (p_event_id, p_content_type, p_data)
  on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();

  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id,
          jsonb_build_object('image', jsonb_build_object('old', case when v_had then 'set' end, 'new', 'set')));
  return 'updated';
end;
$$;

revoke all on function private.admin_put_event_image(uuid, uuid, text, bytea) from public, anon, authenticated;

-- Removes p_event_id's photo, whatever its status, and logs it ('edited',
-- {"image": {"old": "set", "new": null}}). Returns 'deleted', 'unchanged'
-- (no photo: nothing logged) or 'not_found'.
create function private.admin_delete_event_image(p_event_id uuid, p_admin_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;
  delete from public.event_images i where i.event_id = p_event_id;
  if not found then
    return 'unchanged';
  end if;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, jsonb_build_object('image', jsonb_build_object('old', 'set', 'new', null)));
  return 'deleted';
end;
$$;

revoke all on function private.admin_delete_event_image(uuid, uuid) from public, anon, authenticated;
