-- Sheltüh initial schema: organisers, events + ticket types, moderation log,
-- orders + issued tickets.
--
-- Access model: the browser never talks to these tables directly. Every read
-- and write goes through the Next.js API (app/api/**), which connects as the
-- database owner over DATABASE_URL and enforces authorisation itself (see
-- lib/server/). RLS is enabled with no policies on every table so the
-- Supabase Data API (anon/authenticated keys) can see nothing. Add explicit
-- policies later if a feature (e.g. realtime "Who's Going") needs direct
-- client access.


create type public.event_category as enum ('live-music', 'art', 'workshop', 'pop-up', 'theatre');
create type public.fee_policy as enum ('buyer-pays', 'organiser-absorbs');
create type public.organiser_status as enum ('pending', 'approved', 'rejected');
create type public.event_status as enum ('draft', 'pending_review', 'published', 'rejected');
create type public.order_status as enum ('pending', 'paid', 'failed', 'oversold_refund_required');
create type public.moderation_action as enum ('submitted', 'approved', 'rejected', 'unpublished');

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisers
-- ---------------------------------------------------------------------------

create table public.organisers (
  id uuid primary key default gen_random_uuid(),
  -- One application per account. Null = a platform-managed organiser (events
  -- curated by Sheltüh on an organiser's behalf, and dev seed data).
  owner_user_id uuid unique references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120),
  contact_email text not null check (char_length(contact_email) <= 320),
  description text not null check (char_length(description) <= 2000),
  categories public.event_category[] not null check (cardinality(categories) > 0),
  website_url text,
  status public.organiser_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  stripe_account_id text unique,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organisers_status_updated_idx on public.organisers (status, updated_at desc);

create trigger organisers_set_updated_at before update on public.organisers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Events and ticket types
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references public.organisers (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 150),
  description text not null check (char_length(description) <= 4000),
  category public.event_category not null,
  venue_name text not null,
  venue_address text not null,
  suburb text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.event_status not null default 'draft',
  rejection_reason text,
  -- Maintained by private.replace_ticket_types so the public feed's
  -- free/paid filter is a plain column predicate.
  is_free boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index events_status_starts_idx on public.events (status, starts_at, id);
create index events_organiser_created_idx on public.events (organiser_id, created_at desc);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create table public.ticket_types (
  event_id uuid not null references public.events (id) on delete cascade,
  -- Client-stable id (kept across draft edits). Only unique within an event.
  id text not null check (char_length(id) between 1 and 100),
  position integer not null,
  name text not null check (char_length(name) between 1 and 150),
  description text,
  price_cents integer not null check (price_cents >= 0),
  fee_policy public.fee_policy not null,
  quantity_available integer not null check (quantity_available >= 1),
  -- Incremented only by private.fulfil_order. The check below is what makes
  -- overselling impossible, however many checkouts race.
  quantity_sold integer not null default 0 check (quantity_sold >= 0),
  primary key (event_id, id),
  constraint ticket_types_not_oversold check (quantity_sold <= quantity_available)
);

create table public.event_moderation_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  action public.moderation_action not null,
  actor_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index event_moderation_log_event_idx on public.event_moderation_log (event_id, id);

-- ---------------------------------------------------------------------------
-- Orders and tickets
-- ---------------------------------------------------------------------------

create table public.orders (
  -- Random `ord_…` id, minted before any Stripe call so a payment can never
  -- land without an order to attach it to. Unguessable, so it doubles as the
  -- confirmation page's bearer credential (guest checkout has no account).
  id text primary key,
  event_id uuid not null references public.events (id) on delete restrict,
  organiser_id uuid not null references public.organisers (id) on delete restrict,
  event_title text not null,
  buyer_email text,
  -- Priced snapshot of what was bought: [{ticketTypeId, ticketTypeName,
  -- unitPriceCents, feePolicy, quantity}], never client-supplied prices.
  line_items jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  buyer_fee_cents integer not null check (buyer_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  application_fee_cents integer not null check (application_fee_cents >= 0),
  status public.order_status not null default 'pending',
  -- Null for free orders, which never touch Stripe.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_event_idx on public.orders (event_id);

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.tickets (
  code text primary key,
  order_id text not null references public.orders (id) on delete cascade,
  event_id uuid not null,
  ticket_type_id text not null,
  ticket_type_name text not null,
  created_at timestamptz not null default now(),
  -- NO ACTION (not RESTRICT) so removing a sold ticket type fails with the
  -- standard foreign_key_violation the API turns into a friendly 409.
  foreign key (event_id, ticket_type_id) references public.ticket_types (event_id, id)
);

create index tickets_order_idx on public.tickets (order_id);

-- ---------------------------------------------------------------------------
-- Lock the Data API out (see header comment)
-- ---------------------------------------------------------------------------

alter table public.organisers enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.event_moderation_log enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;

revoke all on public.organisers, public.events, public.ticket_types, public.event_moderation_log,
  public.orders, public.tickets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Multi-statement operations, each atomic. Kept in a schema the Data API
-- doesn't expose, and not executable by anon/authenticated.
-- ---------------------------------------------------------------------------

create schema private;
revoke all on schema private from public, anon, authenticated;

-- Replaces an event's ticket types with p_ticket_types
-- ([{id, name, description?, priceCents, feePolicy, quantityAvailable}]),
-- preserving quantity_sold for ids that survive. Removing a ticket type that
-- has sales fails (tickets FK), as does lowering a cap below what's sold
-- (ticket_types_not_oversold).
create function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql as $$
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

  update public.events
  set is_free = not exists (
    select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0
  )
  where id = p_event_id;
end;
$$;

-- p_fields: {title, description, category, venueName, venueAddress, suburb,
-- startsAt, endsAt} — already validated by lib/server/event-input.ts.
create function private.create_event_draft(
  p_organiser_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.events
    (organiser_id, slug, title, description, category, venue_name, venue_address, suburb, starts_at, ends_at)
  values (
    p_organiser_id,
    p_slug,
    p_fields ->> 'title',
    p_fields ->> 'description',
    (p_fields ->> 'category')::public.event_category,
    p_fields ->> 'venueName',
    p_fields ->> 'venueAddress',
    p_fields ->> 'suburb',
    (p_fields ->> 'startsAt')::timestamptz,
    (p_fields ->> 'endsAt')::timestamptz
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- Returns false (and changes nothing) unless the event belongs to
-- p_organiser_id and is still editable (draft or rejected).
create function private.update_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns boolean
language plpgsql as $$
begin
  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz
  where id = p_event_id
    and organiser_id = p_organiser_id
    and status in ('draft', 'rejected');

  if not found then
    return false;
  end if;

  perform private.replace_ticket_types(p_event_id, p_ticket_types);
  return true;
end;
$$;

-- Moves an event between statuses and appends to its moderation log in one
-- step. Returns false if the event isn't currently in one of p_from (e.g.
-- two admins clicked approve at once — exactly one wins). p_reason is stored
-- as the event's rejection_reason, so every non-reject transition clears it.
-- p_organiser_id, when given, also requires ownership.
create function private.transition_event(
  p_event_id uuid,
  p_from public.event_status[],
  p_to public.event_status,
  p_action public.moderation_action,
  p_actor_id uuid,
  p_reason text default null,
  p_organiser_id uuid default null
) returns boolean
language plpgsql as $$
begin
  update public.events
  set status = p_to, rejection_reason = p_reason
  where id = p_event_id
    and status = any (p_from)
    and (p_organiser_id is null or organiser_id = p_organiser_id);

  if not found then
    return false;
  end if;

  insert into public.event_moderation_log (event_id, action, actor_id, reason)
  values (p_event_id, p_action, p_actor_id, p_reason);
  return true;
end;
$$;

-- The only place an order becomes paid. Atomically reserves inventory for
-- every line item and issues p_tickets ([{ticketCode, ticketTypeId,
-- ticketTypeName}]), or — if any ticket type has sold out since checkout —
-- reserves nothing and marks the order oversold_refund_required. Idempotent:
-- an order that's no longer pending is returned untouched (Stripe redelivers
-- webhooks). Returns the order's resulting status, or null if unknown.
create function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language plpgsql as $$
declare
  v_order public.orders;
  v_line jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return null;
  end if;
  if v_order.status <> 'pending' then
    return v_order.status;
  end if;

  begin
    -- Fixed lock order across concurrent orders avoids deadlocks.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
      set quantity_sold = quantity_sold + (v_line ->> 'quantity')::integer
      where event_id = v_order.event_id
        and id = v_line ->> 'ticketTypeId'
        and quantity_sold + (v_line ->> 'quantity')::integer <= quantity_available;

      if not found then
        raise exception 'sold out: %', v_line ->> 'ticketTypeId' using errcode = 'SH409';
      end if;
    end loop;

    insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
    select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName'
    from jsonb_array_elements(p_tickets) t;

    update public.orders
    set status = 'paid',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    return 'paid';
  exception when sqlstate 'SH409' then
    -- Everything in this block (partial reservations included) is rolled back.
    update public.orders
    set status = 'oversold_refund_required',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    return 'oversold_refund_required';
  end;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
