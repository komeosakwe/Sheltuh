/**
 * One-off: strips the metadata (GPS location, camera make/model/serial, ICC,
 * XMP, IPTC, PNG text, JPEG comments, trailing data) from event photos stored
 * before uploads were re-encoded server-side, by re-encoding each such photo
 * exactly as an upload is today (encodeEventImage). Owner-run, from your own
 * computer, against the database whose connection string you give it.
 *
 * Usage (the connection string from Supabase → Project Settings → Database;
 * never pass it as an argument):
 *   DATABASE_URL='postgresql://…' npx tsx scripts/backfill-event-image-metadata.ts           # dry run
 *   DATABASE_URL='postgresql://…' npx tsx scripts/backfill-event-image-metadata.ts --apply   # re-encode
 *
 * The dry run changes nothing. Exits non-zero if any photo couldn't be read
 * or re-encoded (those are left untouched). Safe to run again: a second
 * --apply finds nothing to do. Runbook: docs/supabase-setup.md, "Event photos
 * stored before re-encoding". All the logic, and its tests, live in
 * scripts/event-image-backfill.ts and tests/server/event-image-backfill.test.ts.
 */
import type postgres from "postgres";
import { connectPostgres } from "../lib/server/db";
import { main } from "./event-image-backfill";

main({
  argv: process.argv.slice(2),
  env: process.env,
  connect: (databaseUrl) => {
    // Same TLS rule as the app (lib/server/db.ts): any host off this machine is always reached over TLS.
    // One connection, no prepared statements (works through Supabase's pooler too), notices not printed.
    const sql = connectPostgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
    return {
      db: {
        async query<T>(text: string, params: unknown[] = []) {
          return (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[];
        },
      },
      end: () => sql.end({ timeout: 5 }),
    };
  },
  print: (line) => console.log(line),
  printError: (line) => console.error(line),
})
  // exitCode, not exit(): Node then exits once the report has been written out (to a pipe or a slow terminal
  // too, which process.exit() could cut short). main() has closed the database connection by then.
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    // main() catches and redacts every error itself; this is only a last resort, so it prints no details.
    console.error("The event photo backfill failed unexpectedly.");
    process.exitCode = 1;
  });
