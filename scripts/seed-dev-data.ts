/**
 * Loads the fictional sample events (lib/sample-events.ts) into a dev
 * database as published events, so the live feed has something to show
 * before any real organiser has been through review. Each sample organiser
 * becomes a platform-managed organiser (no account). Safe to re-run: events
 * whose slug already exists are skipped.
 *
 * Never run this against production.
 *
 * Usage (needs DATABASE_URL, e.g. in .env.local):
 *   npm run seed-dev-data
 */
import postgres from "postgres";
import { sampleEvents } from "../lib/sample-events";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL. Add it to .env.local (see docs/supabase-setup.md).");
    process.exit(1);
  }
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });

  let created = 0;
  try {
    for (const event of sampleEvents) {
      await sql.begin(async (tx) => {
        const [organiser] = await tx`
          select id from public.organisers where owner_user_id is null and display_name = ${event.organiserName}`;
        const organiserId =
          organiser?.id ??
          (
            await tx`
              insert into public.organisers (display_name, contact_email, description, categories, status)
              values (${event.organiserName}, 'hello@sheltuh.com.au', 'Sample organiser for development.',
                      ${[event.category]}::public.event_category[], 'approved')
              returning id`
          )[0].id;

        const [inserted] = await tx`
          insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address,
                                     suburb, starts_at, ends_at, status)
          values (${organiserId}, ${event.slug}, ${event.title}, ${event.description}, ${event.category},
                  ${event.venueName}, ${event.venueAddress}, ${event.suburb}, ${event.startsAt},
                  ${event.endsAt ?? event.startsAt}, 'published')
          on conflict (slug) do nothing
          returning id`;
        if (!inserted) return;

        await tx`select private.replace_ticket_types(${inserted.id}, ${JSON.stringify(event.ticketTypes)}::text::jsonb)`;
        await tx`insert into public.event_moderation_log (event_id, action) values (${inserted.id}, 'approved')`;
        created += 1;
      });
    }
  } finally {
    await sql.end();
  }
  console.log(`Seeded ${created} new sample event(s); ${sampleEvents.length - created} already existed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
