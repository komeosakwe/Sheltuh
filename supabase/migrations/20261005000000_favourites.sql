-- Favourites: a signed-in member's private list of events.
--
--   * Only a published event can be favourited. Unpublishing keeps the row,
--     but the API hides it until the event is published again.
--   * At most p_limit (500, lib/api/types.ts MAX_FAVOURITES) per account,
--     enforced atomically by private.add_favourite.
--   * Nobody but the member sees their favourites; no count is exposed.
--   * Deleting the account or the event deletes its favourites (cascade).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, and the new function's execute revoked from PUBLIC. Only the
-- API (lib/server/handlers/favourites.ts) reads or writes it.
--
-- Reversible: drop function private.add_favourite and drop table
-- public.event_favourites. Dropping the table deletes every member's
-- favourites, so reversing it after launch is destructive.

create table public.event_favourites (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One row per (member, event): favouriting twice is a no-op.
  primary key (user_id, event_id)
);

-- "My favourites, newest first" (the list and the ids endpoint), keyset-ready
-- on (created_at, event_id). The primary key already serves "is it a
-- favourite", the per-account count and the auth.users FK cascade. No index
-- on event_id alone: events are never deleted by the app (only by hand), and
-- no feature counts favourites per event.
create index event_favourites_user_created_idx on public.event_favourites (user_id, created_at desc, event_id desc);

alter table public.event_favourites enable row level security;
revoke all on public.event_favourites from anon, authenticated;

-- Favourites p_event_id for p_user_id. Returns:
--   'added'     newly favourited
--   'exists'    already a favourite (idempotent: also when at the limit)
--   'not_found' no such event, or it isn't published, or the account was
--               deleted mid-call
--   'limit'     the account already has p_limit favourites
-- A transaction-scoped advisory lock on the account serialises one member's
-- adds, so two concurrent requests can't both take the last slot. (A hash
-- collision with another account only makes the two wait for each other.)
-- The event isn't locked: if it's unpublished a moment later, the row is
-- kept and hidden, exactly as for an older favourite.
create function private.add_favourite(p_user_id uuid, p_event_id uuid, p_limit integer) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_favourites:' || p_user_id::text, 0));

  if exists (select 1 from public.event_favourites f where f.user_id = p_user_id and f.event_id = p_event_id) then
    return 'exists';
  end if;

  if (select count(*) from public.event_favourites f where f.user_id = p_user_id) >= p_limit then
    return 'limit';
  end if;

  insert into public.event_favourites (user_id, event_id) values (p_user_id, p_event_id);
  return 'added';
exception
  when foreign_key_violation then
    -- The account (or the event) was deleted mid-call.
    return 'not_found';
end;
$$;

revoke all on function private.add_favourite(uuid, uuid, integer) from public, anon, authenticated;
