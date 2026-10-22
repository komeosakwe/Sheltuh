import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { createTestDb } from "./helpers/test-db";

let db: Db;

beforeAll(async () => {
  db = (await createTestDb()).db;
});

/**
 * docs/architecture.md: the browser never talks to the database. Supabase's
 * Data API is shut out by RLS *and* by having no grants for the anon and
 * authenticated roles. Supabase grants new tables to those roles by default
 * (mirrored in supabase/test/supabase-stubs.sql), so every table must revoke —
 * this fails for any table added without doing so.
 */
describe("Data API lock-out", () => {
  it("no table or view in `public` grants anything to anon or authenticated", async () => {
    const grants = await db.query(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
        order by table_name, grantee, privilege_type`,
    );
    expect(grants).toEqual([]);
  });

  it("no column of any table in `public` or `private` is granted to anon, authenticated or PUBLIC", async () => {
    // A column-level grant (`grant select (display_name) on public.organisers
    // to anon`) doesn't show in role_table_grants, but exposes the column
    // through the Data API all the same.
    const viaInformationSchema = await db.query(
      `select table_schema, table_name, column_name, grantee, privilege_type from information_schema.role_column_grants
        where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated', 'PUBLIC')
        order by 1, 2, 3, 4, 5`,
    );
    expect(viaInformationSchema).toEqual([]);
    // The same from the catalogue, which doesn't depend on which roles the
    // test connection is a member of.
    const viaCatalogue = await db.query(
      `select n.nspname as schema, c.relname as table_name, a.attname as column_name, x.privilege_type
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace,
              aclexplode(a.attacl) x
        where n.nspname in ('public', 'private') and a.attacl is not null
          and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
        order by 1, 2, 3, 4`,
    );
    expect(viaCatalogue).toEqual([]);
  });

  it("row-level security is on for every table in `public`", async () => {
    const open = await db.query(
      `select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    expect(open).toEqual([]);
  });

  it("the messaging, favourites, analytics, outbound-click, check-in and seating tables exist in `public` with RLS on, no policies and no client grants", async () => {
    const tables = [
      "conversations",
      "event_favourites",
      "event_outbound_clicks",
      "event_seat_maps",
      "event_seats",
      "event_tracking_links",
      "event_view_counts",
      "messages",
      "organiser_follows",
      "ticket_check_ins",
      "user_blocks",
    ];
    const rows = await db.query<{ table_name: string; rls: boolean; policies: number; grants: number }>(
      `select c.relname as table_name, c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
              (select count(*)::int from information_schema.role_table_grants g
                where g.table_schema = 'public' and g.table_name = c.relname
                  and g.grantee in ('anon', 'authenticated', 'PUBLIC')) as grants
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[]) order by 1`,
      [tables],
    );
    expect(rows).toEqual(tables.map((table_name) => ({ table_name, rls: true, policies: 0, grants: 0 })));
  });

  it("no sequence in `public` or `private` grants anything to anon, authenticated or PUBLIC", async () => {
    // Supabase grants new sequences (identity columns' included) to anon and
    // authenticated by default, like tables (mirrored in supabase-stubs.sql).
    const sequences = await db.query<{ seq: string }>(
      `select n.nspname || '.' || c.relname as seq from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'S' and n.nspname in ('public', 'private') order by 1`,
    );
    expect(sequences.length).toBeGreaterThan(0);
    const granted = await db.query(
      `select n.nspname || '.' || c.relname as seq, a.grantee::regrole::text as grantee, a.privilege_type
         from pg_class c join pg_namespace n on n.oid = c.relnamespace,
              aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
        where c.relkind = 'S' and n.nspname in ('public', 'private')
          and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))
        order by 1, 2, 3`,
    );
    expect(granted).toEqual([]);
  });

  it("tables in `private` have RLS on and grant nothing to anon, authenticated or PUBLIC", async () => {
    const tables = await db.query<{ table_name: string; rls: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'private' and c.relkind = 'r' order by 1`,
    );
    expect(tables).toEqual([
      { table_name: "analytics_settings", rls: true },
      { table_name: "checkout_attempts", rls: true },
      { table_name: "client_rate_limits", rls: true },
      { table_name: "conversation_pairs", rls: true },
      { table_name: "cron_runs", rls: true },
      { table_name: "early_charge_refunds", rls: true },
      { table_name: "email_outbox", rls: true },
      { table_name: "event_curation", rls: true },
      { table_name: "event_rate_limits", rls: true },
      { table_name: "event_view_cap_days", rls: true },
      { table_name: "event_waitlist", rls: true },
      { table_name: "event_waitlist_tokens", rls: true },
      { table_name: "free_order_refusals", rls: true },
      { table_name: "organiser_event_announcements", rls: true },
      { table_name: "organiser_follow_tokens", rls: true },
      { table_name: "organiser_profile_edits", rls: true },
      { table_name: "payment_exceptions", rls: true },
      { table_name: "platform_rate_limits", rls: true },
      { table_name: "profile_avatars", rls: true },
      { table_name: "profile_moderation_log", rls: true },
      { table_name: "rate_limits", rls: true },
      { table_name: "report_photos", rls: true },
      { table_name: "social_suspensions", rls: true },
      { table_name: "trending_snapshot", rls: true },
      { table_name: "user_reports", rls: true },
    ]);
    const grants = await db.query(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(grants).toEqual([]);
  });

  it("no function in `private` is executable by anon, authenticated or PUBLIC", async () => {
    // New functions are executable by PUBLIC by default, so each migration
    // that adds one must revoke it (the schema's usage is revoked too, but
    // this keeps a mistaken grant on the schema from exposing them).
    const executable = await db.query(
      `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute')
            or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1`,
    );
    expect(executable).toEqual([]);
  });

  it("the admin authoring functions and platform-managed and review-hardening guards exist, pin search_path and aren't client-executable", async () => {
    const names = [
      "admin_create_event",
      "admin_delete_event_image",
      "admin_edit_event",
      "admin_put_event_image",
      "event_images_touch_event",
      "events_external_ticket_url_valid",
      "events_platform_free_only",
      "orders_platform_free_only",
      "organisers_platform_free_only",
      "ticket_check_ins_guard",
      "ticket_types_platform_free_only",
    ];
    const rows = await db.query<{ fn: string; pinned: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, client: false })));
  });

  it("the trending functions exist, pin search_path and aren't client-executable", async () => {
    const names = [
      "refresh_trending",
      "set_event_curation",
      "trending_day_utility",
      "trending_decay",
      "trending_proximity",
      "trending_shrink",
    ];
    const rows = await db.query<{ fn: string; pinned: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, client: false })));
  });

  it("the waitlist functions and triggers exist, pin search_path and aren't client-executable", async () => {
    const names = [
      "claim_outbox_jobs",
      "confirm_waitlist_join",
      "events_waitlist_release",
      "join_waitlist",
      "leave_waitlist",
      "notify_waitlist",
      "request_waitlist_join",
      "ticket_types_waitlist_release",
      "waitlist_join_state",
    ];
    const rows = await db.query<{ fn: string; pinned: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, client: false })));
    // The waitlist's personal data has no policies (RLS on, nothing allowed to the Data API).
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'private' and c.relname in ('event_waitlist', 'event_waitlist_tokens')`,
    );
    expect(policies.n).toBe(0);
  });

  it("the reserved seating functions and triggers (and the per-client hold limit's) exist, pin search_path and aren't client-executable", async () => {
    const names = [
      "admin_replace_seat_map",
      "admin_set_event_ticketing",
      "check_in_ticket",
      "clear_seat_map",
      "confirm_free_order",
      "delete_seat_map",
      "edit_event_draft",
      "event_seat_maps_sheltuh_only",
      "event_seat_maps_touch_event",
      "fulfil_order",
      "hold_seats",
      "lock_event_seats",
      "order_seats_match",
      "place_free_seated_order",
      "purge_operational_data",
      "record_payment_refund",
      "release_seat_holds",
      "replace_seat_map",
      "request_free_seated_order",
      "seat_map_summary",
      "take_client_rate_limit",
      "take_seat_hold_attempt",
      "ticket_types_seated_capacity",
      "unavailable_seats",
      "write_seat_map",
    ];
    const rows = await db.query<{ fn: string; pinned: boolean; client: boolean }>(
      `select p.proname as fn,
              bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')) as pinned,
              bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) group by p.proname order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, client: false })));
    // The version sequence isn't the Data API's either.
    const [seq] = await db.query<{ granted: number }>(
      `select count(*)::int as granted from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
        where c.oid = 'private.seat_map_versions'::regclass and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))`,
    );
    expect(seq.granted).toBe(0);
  });

  it("the member profile and organiser follow functions and triggers exist, pin search_path and aren't client-executable", async () => {
    const names = [
      "admin_remove_featured_video",
      "admin_remove_profile_content",
      "claim_email_outbox",
      "create_block_by_profile",
      "edit_organiser_profile",
      "events_followers_announce",
      "file_profile_report",
      "follow_organiser",
      "member_profile_visible",
      "notify_followers",
      "request_conversation_by_profile",
      "unsubscribe_follow",
      "user_reports_target_type",
    ];
    const rows = await db.query<{ fn: string; pinned: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, client: false })));
    // Photos, follows, tokens and the moderation log: RLS on, no policies.
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname in ('profile_avatars', 'profile_moderation_log', 'organiser_follows',
                            'organiser_follow_tokens', 'organiser_event_announcements')`,
    );
    expect(policies.n).toBe(0);
  });

  it("the payment reconciliation functions exist (both record_payment_refund forms), pin search_path and aren't client-executable", async () => {
    const names = [
      "claim_email_outbox",
      "fulfil_order",
      "lock_payment_intent",
      "purge_operational_data",
      "raise_payment_exception",
      "record_payment_refund",
      "record_refund_status",
      "resolve_payment_exception",
    ];
    const rows = await db.query<{ fn: string; forms: number; pinned: boolean; client: boolean }>(
      `select p.proname as fn, count(*)::int as forms,
              bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')) as pinned,
              bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) group by p.proname order by 1`,
      [names],
    );
    expect(rows).toEqual(
      names.map((fn) => ({ fn, forms: fn === "record_payment_refund" ? 2 : 1, pinned: true, client: false })),
    );
    // The new tables: RLS on, no policies.
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'private' and c.relname in ('payment_exceptions', 'early_charge_refunds')`,
    );
    expect(policies.n).toBe(0);
  });

  it("the email outbox health function exists, pins search_path and isn't client-executable; cron_runs has no policies", async () => {
    const rows = await db.query<{ pinned: boolean; client: boolean }>(
      `select exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'email_outbox_health'`,
    );
    expect(rows).toEqual([{ pinned: true, client: false }]);
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p where p.polrelid = 'private.cron_runs'::regclass`,
    );
    expect(policies.n).toBe(0);
  });

  it("the checkout attempt functions exist, pin search_path and aren't client-executable; checkout_attempts has no policies", async () => {
    const names = [
      "begin_checkout_attempt",
      "checkout_attempt_state",
      "fail_checkout_attempt",
      "finish_checkout_attempt",
      "purge_operational_data",
      "release_checkout_order",
      "take_checkout_attempt",
      "take_checkout_limits",
    ];
    const rows = await db.query<{ fn: string; forms: number; pinned: boolean; client: boolean }>(
      `select p.proname as fn, count(*)::int as forms,
              bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')) as pinned,
              bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) group by p.proname order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, forms: 1, pinned: true, client: false })));
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p where p.polrelid = 'private.checkout_attempts'::regclass`,
    );
    expect(policies.n).toBe(0);
  });

  it("every `private` function pins its search_path, apart from the two that predate the rule", async () => {
    // A function without a pinned search_path resolves names through the
    // caller's. New ones must set it (`set search_path = ''`); these two
    // (init migration) predate the rule and schema-qualify every name instead.
    // fulfil_order was pinned when the email outbox redefined it,
    // replace_ticket_types when the listing fixes did, and create_event_draft
    // when external ticketing did (update_event_draft is superseded by
    // edit_event_draft and no longer called).
    const unpinned = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
        order by 1`,
    );
    expect(unpinned.map((r) => r.fn)).toEqual([
      "transition_event",
      "update_event_draft",
    ]);
  });
});
