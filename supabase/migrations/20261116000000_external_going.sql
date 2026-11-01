-- ---------------------------------------------------------------------------
-- "Going" for external-ticket events (owner decision, Nov 2026;
-- docs/architecture.md, "External ticketing" and "Who's Going")
-- ---------------------------------------------------------------------------
-- An event whose tickets are sold on the organiser's own site has no Who's
-- Going (Sheltüh can't verify a ticket). It gets a COUNT-ONLY signal instead:
-- a signed-in member with a verified email taps "I'm going" (and taps again
-- to undo); the page shows "N going" from three. No names, faces, messages,
-- profiles or ticket check, and nothing for Sheltüh-ticketed events.
--
--   * private.external_event_going (event_id, user_id): one row per tap, primary
--     key (event_id, user_id). Deleted with the event or the member's account
--     (on delete cascade). RLS on, no policies, no grants to anon,
--     authenticated or PUBLIC: the API reaches it only through the functions
--     below.
--   * private.set_external_going(event, user): share-locks the event row, then
--     re-checks the event is published, external and not ended in the same
--     step as the insert, so an unpublish or a switch of ticketing can't
--     interleave. Idempotent. Returns 'going', 'event_unavailable' (not
--     published, or not there), 'not_external', 'ended' or 'user_unavailable'
--     (the account was deleted mid-call).
--   * private.unset_external_going(event, user): deletes the row; works whatever
--     state the event is in (withdrawing is never blocked). Idempotent.
--   * private.external_going_state(event, user): none for an event that isn't
--     published; otherwise `open` (external and not ended), the count (0 when
--     not open) and whether `user` is going (user may be null). The threshold
--     below which the API withholds the count is in lib/server/handlers/going.ts.
--   * private.purge_social_data: redefined from
--     20261102000100_social_hardening.sql, same signature, plus one delete:
--     taps are removed 30 days after the event ended, like Who's Going opt-ins.
--
-- Index: the primary key serves the count and the events cascade; the
-- (user_id) index serves the auth.users cascade and "my taps".
--
-- Additive; the previous app keeps working against it (it never calls these
-- functions). create or replace keeps purge_social_data's signature, so
-- Supabase Cron's call is unchanged.
-- Reversible: restore purge_social_data from 20261102000100_social_hardening.sql,
-- drop the three functions and then the table (which loses every tap).
-- ---------------------------------------------------------------------------

create table private.external_event_going (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index external_event_going_user_idx on private.external_event_going (user_id);

alter table private.external_event_going enable row level security;
revoke all on table private.external_event_going from public, anon, authenticated;

create function private.set_external_going(p_event_id uuid, p_user_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
  v_ends timestamptz;
begin
  select ticketing_mode, ends_at into v_mode, v_ends
    from public.events
   where id = p_event_id and status = 'published'
     for share;
  if not found then
    return 'event_unavailable';
  end if;
  if v_mode <> 'external' then
    return 'not_external';
  end if;
  if v_ends <= now() then
    return 'ended';
  end if;

  insert into private.external_event_going (event_id, user_id) values (p_event_id, p_user_id)
  on conflict (event_id, user_id) do nothing;
  return 'going';
exception
  -- The event row is share-locked, so only the account can have gone.
  when foreign_key_violation then
    return 'user_unavailable';
end;
$$;

create function private.unset_external_going(p_event_id uuid, p_user_id uuid) returns void
language sql
set search_path = ''
as $$
  delete from private.external_event_going where event_id = p_event_id and user_id = p_user_id;
$$;

create function private.external_going_state(p_event_id uuid, p_user_id uuid)
returns table (open boolean, going_count integer, is_going boolean)
language sql
stable
set search_path = ''
as $$
  select o.open,
         case when o.open then (select count(*)::int from private.external_event_going g where g.event_id = e.id) else 0 end,
         p_user_id is not null and exists (
           select 1 from private.external_event_going g where g.event_id = e.id and g.user_id = p_user_id)
    from public.events e
   cross join lateral (select e.ticketing_mode = 'external' and e.ends_at > now() as open) o
   where e.id = p_event_id and e.status = 'published';
$$;

revoke all on function private.set_external_going(uuid, uuid) from public, anon, authenticated;
revoke all on function private.unset_external_going(uuid, uuid) from public, anon, authenticated;
revoke all on function private.external_going_state(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention: as in 20261102000100_social_hardening.sql, plus the taps of
-- events that ended over 30 days ago (their count isn't shown once an event
-- ends). Same signature, hence create or replace.
-- ---------------------------------------------------------------------------

create or replace function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer, out waitlist_entries_deleted integer,
  out waitlist_tokens_deleted integer, out profile_moderation_deleted integer,
  out follow_tokens_deleted integer, out report_photos_deleted integer)
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.event_attendees a
   using public.events e
   where e.id = a.event_id and e.ends_at < now() - interval '30 days';
  get diagnostics event_attendees_deleted = row_count;

  delete from private.external_event_going g
   using public.events e
   where e.id = g.event_id and e.ends_at < now() - interval '30 days';

  delete from private.rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics rate_limits_deleted = row_count;

  -- Messages go with their conversation (cascade); reports keep their copies.
  delete from public.conversations where last_message_at < now() - interval '12 months';
  get diagnostics conversations_deleted = row_count;

  delete from private.user_reports where status <> 'open' and resolved_at < now() - interval '2 years';
  get diagnostics user_reports_deleted = row_count;

  delete from private.conversation_pairs cp
   where cp.created_at < now() - interval '12 months'
     and not exists (select 1 from public.conversations c where c.user_low = cp.user_low and c.user_high = cp.user_high);
  get diagnostics conversation_pairs_deleted = row_count;

  delete from private.event_waitlist w
   using public.events e
   where e.id = w.event_id and e.ends_at < now() - interval '30 days';
  get diagnostics waitlist_entries_deleted = row_count;
  delete from private.event_waitlist w
   where (w.confirmed_at is null and w.created_at < now() - interval '8 days'
          and not exists (select 1 from private.event_waitlist_tokens t
                           where t.entry_id = w.id and t.purpose = 'confirm'
                             and t.created_at > now() - interval '8 days'))
      or w.unsubscribed_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  waitlist_entries_deleted := waitlist_entries_deleted + v_count;

  delete from private.event_waitlist_tokens t where t.expires_at < now() - interval '7 days';
  get diagnostics waitlist_tokens_deleted = row_count;

  delete from private.profile_moderation_log l where l.created_at < now() - interval '2 years';
  get diagnostics profile_moderation_deleted = row_count;

  delete from private.organiser_follow_tokens t where t.created_at < now() - interval '90 days';
  get diagnostics follow_tokens_deleted = row_count;

  -- After the reports above, so a photo whose last report just went goes too.
  delete from private.report_photos ph
   where ph.last_used_at < now() - interval '1 day'
     and not exists (select 1 from private.user_reports r where r.reported_avatar_sha256 = ph.sha256);
  get diagnostics report_photos_deleted = row_count;
end;
$$;

revoke all on function private.purge_social_data() from public, anon, authenticated;
