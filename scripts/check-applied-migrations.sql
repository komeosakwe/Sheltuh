-- Which of supabase/migrations/ a database has, judged by an object each
-- file creates (or, for a file that only redefines functions or changes
-- grants, something only that file's version has). Read-only: run it in the
-- Supabase SQL editor on any project, whether or not the CLI applied the
-- migrations (only the CLI records them in supabase_migrations.schema_migrations;
-- running files in the SQL editor doesn't).
--
-- `applied = false` means that file's marker is missing: apply it, and every
-- later file, in filename order (docs/DEPLOYMENT.md, "Migrations"). A `true`
-- is strong evidence, not proof, that the whole file ran: each file runs in
-- one transaction in the SQL editor only if it's run as a single query.
--
-- tests/server/applied-migrations-check.test.ts applies the migrations one by
-- one and checks each row turns true exactly when its file is applied, and
-- that every file has a row: add one here with every new migration.

with fn as (
  select p.proname, p.prosrc
    from pg_proc p
   where p.pronamespace = to_regnamespace('private')
),
col as (
  select a.attrelid, a.attname
    from pg_attribute a
   where a.attnum > 0 and not a.attisdropped
)
select version, file, coalesce(applied, false) as applied
  from (values
    ('20260925000000', 'init', to_regclass('public.events') is not null),
    ('20260926000000', 'refunds_and_emails',
      exists (select 1 from col where attrelid = to_regclass('public.orders') and attname = 'tickets_emailed_at')),
    ('20260927000000', 'review_fixes',
      exists (select 1 from col where attrelid = to_regclass('public.orders') and attname = 'stripe_refund_id')),
    ('20260929000000', 'event_images', to_regclass('public.event_images') is not null),
    ('20260930000000', 'event_images_lockdown',
      not has_table_privilege('anon', to_regclass('public.event_images'), 'select')),
    ('20261001000000', 'whos_going', to_regclass('public.event_attendees') is not null),
    ('20261002000000', 'whos_going_hardening', to_regclass('private.social_suspensions') is not null),
    ('20261003000000', 'messages', to_regclass('public.messages') is not null),
    ('20261004000000', 'messaging_hardening', to_regclass('private.conversation_pairs') is not null),
    ('20261005000000', 'favourites', to_regclass('public.event_favourites') is not null),
    ('20261006000000', 'event_analytics', to_regclass('public.event_view_counts') is not null),
    ('20261014000000', 'email_outbox', to_regclass('private.email_outbox') is not null),
    ('20261014000100', 'free_order_protection', to_regclass('private.free_order_refusals') is not null),
    ('20261015000000', 'analytics_hardening', to_regclass('private.event_view_cap_days') is not null),
    ('20261016000000', 'organiser_public_profile',
      exists (select 1 from col where attrelid = to_regclass('public.organisers') and attname = 'instagram_handle')),
    ('20261017000000', 'free_order_caps', exists (select 1 from fn where proname = 'platform_rate_limit_used_up')),
    ('20261018000000', 'organiser_profile_moderation', to_regclass('private.organiser_profile_edits') is not null),
    ('20261020000000', 'payment_refunds', exists (select 1 from fn where proname = 'record_payment_refund')),
    ('20261021000000', 'ticket_check_in', to_regclass('public.ticket_check_ins') is not null),
    ('20261021120000', 'listing_fixes', to_regclass('public.events_status_ends_idx') is not null),
    ('20261021130000', 'check_in_followups',
      exists (select 1 from col where attrelid = to_regclass('public.ticket_check_ins') and attname = 'public_id')),
    ('20261022000000', 'external_ticketing', exists (select 1 from fn where proname = 'external_ticket_url_ok')),
    ('20261022000100', 'admin_event_authoring', exists (select 1 from fn where proname = 'orders_platform_free_only')),
    ('20261022000200', 'external_ticketing_hardening',
      exists (select 1 from fn where proname = 'external_ticket_url_ok' and strpos(prosrc, 'linktr\.ee') > 0)),
    ('20261023000000', 'trending', to_regclass('private.trending_snapshot') is not null),
    ('20261023000100', 'review_hardening', exists (select 1 from fn where proname = 'event_images_touch_event')),
    ('20261023000200', 'trending_distinct', to_regclass('public.orders_event_paid_created_idx') is not null),
    ('20261024000000', 'waitlist', to_regclass('private.event_waitlist') is not null),
    ('20261024000100', 'member_profiles', to_regclass('private.profile_avatars') is not null),
    ('20261024000200', 'organiser_follows', to_regclass('public.organiser_follows') is not null),
    ('20261101000000', 'reserved_seating', to_regclass('public.event_seat_maps') is not null),
    ('20261101000100', 'seat_holds', exists (select 1 from fn where proname = 'hold_seats')),
    ('20261102000000', 'seating_hardening',
      exists (select 1 from fn where proname = 'write_seat_map' and prosrc like '%event_seat_maps_no_orders%')),
    ('20261102000100', 'social_hardening', to_regclass('private.report_photos') is not null),
    ('20261103000000', 'seat_hold_client_limits', to_regclass('private.client_rate_limits') is not null),
    ('20261103000100', 'refuse_ended_event_orders', exists (select 1 from fn where proname = 'orders_not_ended')),
    ('20261105000000', 'organiser_logos', to_regclass('private.organiser_logos') is not null),
    ('20261106000000', 'event_clips', to_regclass('private.event_clips') is not null)
  ) as m(version, file, applied)
 order by version;
