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

  it("the messaging, favourites, analytics and check-in tables exist in `public` with RLS on, no policies and no client grants", async () => {
    const tables = [
      "conversations",
      "event_favourites",
      "event_tracking_links",
      "event_view_counts",
      "messages",
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
      { table_name: "conversation_pairs", rls: true },
      { table_name: "email_outbox", rls: true },
      { table_name: "event_rate_limits", rls: true },
      { table_name: "event_view_cap_days", rls: true },
      { table_name: "free_order_refusals", rls: true },
      { table_name: "organiser_profile_edits", rls: true },
      { table_name: "platform_rate_limits", rls: true },
      { table_name: "rate_limits", rls: true },
      { table_name: "social_suspensions", rls: true },
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

  it("every `private` function pins its search_path, apart from the four that predate the rule", async () => {
    // A function without a pinned search_path resolves names through the
    // caller's. New ones must set it (`set search_path = ''`); these four
    // (init migration) predate the rule and schema-qualify every name instead.
    // fulfil_order was pinned when the email outbox redefined it.
    const unpinned = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
        order by 1`,
    );
    expect(unpinned.map((r) => r.fn)).toEqual([
      "create_event_draft",
      "replace_ticket_types",
      "transition_event",
      "update_event_draft",
    ]);
  });
});
