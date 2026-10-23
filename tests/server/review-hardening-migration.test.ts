import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * supabase/migrations/20261023000100_review_hardening.sql revalidates every
 * stored ticket link before it replaces the events_external_ticket_url_valid
 * check constraint with a trigger: a link the current rules refuse stops the
 * migration, naming the event, and nothing of it is applied. Runs on PGlite
 * only (it applies the migrations itself, up to a point).
 */

const SUPABASE_DIR = path.resolve(import.meta.dirname, "../../supabase");
const MIGRATION = "20261023000100_review_hardening.sql";

/** Every migration before this one, split at the one that tightened the link rules (20261022000200). */
function migrations() {
  const dir = path.join(SUPABASE_DIR, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
  const earlier = files.slice(0, files.indexOf(MIGRATION));
  return {
    stubs: readFileSync(path.join(SUPABASE_DIR, "test/supabase-stubs.sql"), "utf8"),
    beforeTightening: earlier.filter((f) => f < "20261022000200").map(read),
    fromTightening: earlier.filter((f) => f >= "20261022000200").map(read),
    migration: read(MIGRATION),
  };
}

describe(`${MIGRATION}: revalidating stored ticket links`, () => {
  it("stops, naming the event, when a stored link is refused by the current rules; applies once it's replaced", async () => {
    const { stubs, beforeTightening, fromTightening, migration } = migrations();
    const pg = new PGlite();
    await pg.exec(stubs);
    for (const sql of beforeTightening) await pg.exec(sql);

    // linktr.ee was allowed until 20261022000200_external_ticketing_hardening.sql refused it.
    const {
      rows: [{ id: organiserId }],
    } = await pg.query<{ id: string }>(
      `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
       values (null, 'Sheltüh Presents', 'events@sheltuh.example', '', '{live-music}', 'approved') returning id`,
    );
    const {
      rows: [{ id: eventId }],
    } = await pg.query<{ id: string }>(
      `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                  starts_at, ends_at, status, ticketing_mode, external_ticket_url)
       values ($1, 'late-night', 'Late night', '', 'live-music', 'Hall', '1 St', 'Fitzroy',
               now() + interval '1 day', now() + interval '1 day 3 hours', 'published', 'external', 'https://linktr.ee/late')
       returning id`,
      [organiserId],
    );
    for (const sql of fromTightening) await pg.exec(sql);

    await expect(pg.exec(migration)).rejects.toThrow(eventId);
    // Nothing of it applied: the constraint is still there, the trigger isn't.
    const constraint = await pg.query(
      `select 1 from pg_constraint where conname = 'events_external_ticket_url_valid'`,
    );
    expect(constraint.rows).toHaveLength(1);
    const trigger = await pg.query(`select 1 from pg_trigger where tgname = 'event_images_touch_event'`);
    expect(trigger.rows).toHaveLength(0);

    // The runbook: replace the link, then run it again.
    await pg.query(`update public.events set external_ticket_url = 'https://events.humanitix.com/late' where id = $1`, [eventId]);
    await pg.exec(migration);
    const replaced = await pg.query(
      `select 1 from pg_constraint where conname = 'events_external_ticket_url_valid'`,
    );
    expect(replaced.rows).toHaveLength(0);
    await pg.close();
  }, 60_000);
});
