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

  it("row-level security is on for every table in `public`", async () => {
    const open = await db.query(
      `select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    expect(open).toEqual([]);
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
});
