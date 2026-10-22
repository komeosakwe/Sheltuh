import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * scripts/check-applied-migrations.sql (docs/DEPLOYMENT.md, "Migrations"):
 * the owner's way to see which migrations a Supabase project has when they
 * were run in the SQL editor (which records nothing). Applied one file at a
 * time, each file's row must turn true with that file and not before, and
 * every file must have a row.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const CHECK_SQL = readFileSync(path.join(ROOT, "scripts/check-applied-migrations.sql"), "utf8");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** "20261103000100_refuse_ended_event_orders.sql" → ["20261103000100", "refuse_ended_event_orders"] */
const parts = (file: string) => {
  const [, version, name] = /^(\d{14})_(.+)\.sql$/.exec(file)!;
  return { version, file: name };
};

describe("scripts/check-applied-migrations.sql", () => {
  // Booting PGlite can take seconds on a busy machine (parallel workers, CI).
  it("has one row per migration file, in order", { timeout: 60_000 }, async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync(path.join(ROOT, "supabase/test/supabase-stubs.sql"), "utf8"));
    const { rows } = await pg.query<{ version: string; file: string }>(CHECK_SQL);
    expect(rows.map(({ version, file }) => ({ version, file }))).toEqual(files.map(parts));
    await pg.close();
  });

  it("each row turns true exactly when its migration is applied", { timeout: 120_000 }, async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync(path.join(ROOT, "supabase/test/supabase-stubs.sql"), "utf8"));
    const applied = async () => (await pg.query<{ applied: boolean }>(CHECK_SQL)).rows.map((row) => row.applied);

    expect(await applied()).toEqual(files.map(() => false));
    for (const [index, file] of files.entries()) {
      await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      expect(await applied(), `after ${file}`).toEqual(files.map((_, i) => i <= index));
    }
    await pg.close();
  });
});
