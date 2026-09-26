import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { createPostgresDb, type Db } from "@/lib/server/db";

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../../supabase");

function setupSql(): string[] {
  const migrationsDir = path.join(SUPABASE_DIR, "migrations");
  return [
    readFileSync(path.join(SUPABASE_DIR, "test/supabase-stubs.sql"), "utf8"),
    ...readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(path.join(migrationsDir, f), "utf8")),
  ];
}

const RESET_SQL = `truncate public.tickets, public.orders, public.event_moderation_log, public.ticket_types,
  public.events, public.organisers, auth.users cascade`;

/**
 * A real Postgres with Supabase's auth stubs and every migration in
 * supabase/migrations applied, in order — so tests exercise the exact SQL
 * and plpgsql the app runs in production.
 *
 * By default that's PGlite (in-process, nothing to install). Set
 * TEST_DATABASE_URL to a Postgres server you can create databases on to run
 * the same suite through the production driver (postgres.js) instead; each
 * test file gets its own throwaway database.
 */
export async function createTestDb(): Promise<{ db: Db; reset: () => Promise<void> }> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  return serverUrl ? createServerTestDb(serverUrl) : createPgliteTestDb();
}

async function createPgliteTestDb() {
  const pg = new PGlite();
  for (const sql of setupSql()) await pg.exec(sql);
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query(text, params)).rows as T[];
    },
  };
  return { db, reset: async () => void (await pg.exec(RESET_SQL)) };
}

async function createServerTestDb(serverUrl: string) {
  const name = `sheltuh_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const setup = postgres(url.toString(), { max: 1, onnotice: () => {} });
  for (const sql of setupSql()) await setup.unsafe(sql);
  await setup.end();

  const db = createPostgresDb(url.toString());
  return { db, reset: async () => void (await db.query(RESET_SQL)) };
}
