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
  select p.proname, p.prosrc, p.proargnames
    from pg_proc p
   where p.pronamespace = to_regnamespace('private')
),
col as (
  select a.attrelid, a.attname
    from pg_attribute a
   where a.attnum > 0 and not a.attisdropped
),
-- The outbox's constraints as Postgres prints them (the kinds and their keys).
outbox_check as (
  select c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conrelid = to_regclass('private.email_outbox')
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
    ('20261106000000', 'event_clips', to_regclass('private.event_clips') is not null),
    ('20261106000100', 'event_clip_dimensions',
      exists (select 1 from col where attrelid = to_regclass('private.event_clips') and attname = 'width')),
    ('20261106000200', 'event_clip_hardening', to_regclass('private.event_clip_uploads') is not null),
    ('20261107000000', 'admin_review_emails', to_regclass('private.email_job_recipients') is not null),
    ('20261108000000', 'account_invites', to_regclass('private.account_invites') is not null),
    ('20261109000000', 'paid_events_need_payouts', exists (select 1 from fn where proname = 'submit_event')),
    ('20261109000100', 'event_refund_policy',
      exists (select 1 from fn where proname = 'refund_policy_tightens')
      and exists (select 1 from fn where proname = 'event_has_payable_orders')),
    -- 24 to 26 were 20261104000000/…100/…200 on the payments audit branch. Judged by their substance, not
    -- just their tables: a project that ran the old names before 20261107000000 and 20261108000000 has the
    -- tables, but those two files then replaced the outbox's kind check, lease_outbox_jobs and the purge
    -- (docs/DEPLOYMENT.md, "Migrations").
    ('20261109000200', 'payment_reconciliation',
      to_regclass('private.payment_exceptions') is not null
      and exists (select 1 from outbox_check where conname = 'email_outbox_kind_check'
                   and def like '%ops_alert%' and def like '%event_review%')
      and exists (select 1 from fn where proname = 'lease_outbox_jobs' and prosrc like '%ops_alert%')
      and exists (select 1 from fn where proname = 'purge_operational_data'
                   and 'early_charge_refunds_deleted' = any(proargnames) and 'account_invites_deleted' = any(proargnames))),
    ('20261109000300', 'email_outbox_health',
      to_regclass('private.cron_runs') is not null and exists (select 1 from fn where proname = 'email_outbox_health')),
    ('20261109000400', 'checkout_attempts',
      to_regclass('private.checkout_attempts') is not null
      and exists (select 1 from outbox_check where conname = 'email_outbox_kind_key'
                   and def like '%ops_event_id%' and def like '%organiser_id%')
      and exists (select 1 from fn where proname = 'purge_operational_data'
                   and 'checkout_attempts_deleted' = any(proargnames) and 'account_invites_deleted' = any(proargnames))),
    ('20261109000500', 'ticket_wallet_serial',
      exists (select 1 from col where attrelid = to_regclass('public.tickets') and attname = 'wallet_serial')),
    ('20261110000000', 'event_place_time_zone',
      exists (select 1 from col where attrelid = to_regclass('public.events') and attname = 'time_zone')
      and exists (select 1 from fn where proname = 'admin_edit_event' and prosrc like '%v_time_zone%')),
    ('20261110000100', 'order_support',
      exists (select 1 from col where attrelid = to_regclass('public.orders') and attname = 'support_cents')
      and exists (select 1 from fn where proname = 'hold_seats' and 'p_support_cents' = any(proargnames))),
    ('20261110000150', 'support_in_exceptions',
      exists (select 1 from pg_constraint c
               where c.conrelid = to_regclass('private.payment_exceptions') and c.conname = 'payment_exceptions_kind_check'
                 and pg_get_constraintdef(c.oid) like '%amount_mismatch%')
      and exists (select 1 from fn where proname = 'raise_payment_exception' and prosrc like '%amount_mismatch%')
      and exists (select 1 from fn where proname = 'record_refund_status' and prosrc like '%supportCents%')
      and exists (select 1 from fn where proname = 'fulfil_order_detailed' and prosrc like '%supportCents%')),
    -- 20261111000300 redefines this file's only function (without supportKeptCents): its marker counts too.
    ('20261110000200', 'support_ticket_refund',
      exists (select 1 from fn where proname = 'record_payment_refund'
                and (prosrc like '%supportKeptCents%' or prosrc like '%refund_no_inference%'))),
    ('20261110000300', 'amount_mismatch_refund',
      exists (select 1 from fn where proname = 'fail_mismatched_order')),
    ('20261111000000', 'event_publish_now',
      exists (select 1 from col where attrelid = to_regclass('public.organisers') and attname = 'event_review_required')
      and exists (select 1 from fn where proname = 'publish_event')
      and exists (select 1 from outbox_check where conname = 'email_outbox_kind_check' and def like '%event_published%')
      and exists (select 1 from fn where proname = 'lease_outbox_jobs' and prosrc like '%event_published%')),
    ('20261111000100', 'event_venue_location',
      exists (select 1 from col where attrelid = to_regclass('public.events') and attname = 'venue_place_id')
      and exists (select 1 from fn where proname = 'event_location_json')
      and exists (select 1 from fn where proname = 'publish_event' and prosrc like '%location_required%')
      -- 20261111000400 takes the pin check back out of submit_event: its marker counts too.
      and exists (select 1 from fn where proname = 'submit_event'
                    and (prosrc like '%location_required%' or prosrc like '%submit_location_in_app%'))),
    ('20261111000200', 'first_paid_event_review',
      exists (select 1 from fn where proname = 'publish_event' and prosrc like '%first_paid_event%')
      and exists (select 1 from fn where proname = 'admin_unpublish_event')),
    ('20261111000300', 'refund_no_inference',
      exists (select 1 from fn where proname = 'record_payment_refund' and prosrc like '%refund_no_inference%')
      and exists (select 1 from fn where proname = 'fulfil_order_detailed' and prosrc like '%refund_no_inference%')),
    ('20261111000400', 'submit_event_location_in_app',
      exists (select 1 from fn where proname = 'submit_event' and prosrc like '%submit_location_in_app%')),
    ('20261111000500', 'organiser_invite_links',
      to_regclass('private.organiser_invite_links') is not null
      and exists (select 1 from fn where proname = 'join_with_organiser_invite_link'
                   and prosrc like '%organiser_joined%' and prosrc like '%suspended%')
      -- 20261111000700 redefines lease_outbox_jobs with an allowlist (no organiser_joined): its marker counts too.
      and exists (select 1 from fn where proname = 'lease_outbox_jobs'
                   and (prosrc like '%organiser_joined%'
                     or prosrc like '%o.kind in (''ticket_email'', ''waitlist_available'', ''organiser_new_events'', ''event_review'', ''organiser_review'')%'))
      and exists (select 1 from fn where proname = 'purge_operational_data'
                   and 'organiser_invite_links_deleted' = any(proargnames))),
    ('20261111000600', 'pin_search_path',
      exists (select 1 from pg_proc p
               where p.oid = to_regprocedure('public.set_updated_at()')
                 and 'search_path=""' = any (coalesce(p.proconfig, '{}')))
      and exists (select 1 from pg_proc p
                   where p.pronamespace = to_regnamespace('private') and p.proname = 'transition_event'
                     and 'search_path=""' = any (coalesce(p.proconfig, '{}')))),
    ('20261111000700', 'onboarding_emails',
      to_regclass('private.onboarding_emails') is not null
      and exists (select 1 from col where attrelid = to_regclass('private.email_outbox') and attname = 'onboarding_id')
      and exists (select 1 from outbox_check where conname = 'email_outbox_kind_check' and def like '%onboarding%')
      and exists (select 1 from fn where proname = 'queue_onboarding_email')
      and exists (select 1 from fn where proname = 'queue_member_welcomes')
      -- The allowlist's code (not its comment) and the two triggers.
      and exists (select 1 from fn where proname = 'lease_outbox_jobs'
                   and prosrc like '%o.kind in (''ticket_email'', ''waitlist_available'', ''organiser_new_events'', ''event_review'', ''organiser_review'')%')
      and (select count(*) from pg_trigger t
            where t.tgrelid = to_regclass('public.organisers')
              and t.tgname in ('organisers_onboarding_email_insert', 'organisers_onboarding_email_approved')) = 2),
    ('20261113000000', 'release_tickets', exists (select 1 from fn where proname = 'release_tickets')),
    ('20261114000000', 'external_price',
      exists (select 1 from col where attrelid = to_regclass('public.events') and attname = 'external_price_from_cents')
      and exists (select 1 from pg_constraint where conname = 'events_external_price_from')
      and (select count(*) from pg_proc p
            where p.pronamespace = to_regnamespace('private') and p.proname = 'admin_set_event_ticketing') = 2),
    ('20261115000000', 'event_image_focus',
      exists (select 1 from col where attrelid = to_regclass('public.event_images') and attname = 'focus_x')
      and exists (select 1 from fn where proname = 'admin_set_event_image_focus')),
    ('20261116000000', 'external_going',
      to_regclass('private.external_event_going') is not null
      and exists (select 1 from fn where proname = 'set_external_going')
      and exists (select 1 from fn where proname = 'external_going_state')
      and exists (select 1 from fn where proname = 'unset_external_going'))
  ) as m(version, file, applied)
 order by version;
