/**
 * Seeds a STAGING Supabase project for the k6 load tests (tests/load/README.md).
 * Never run this against production: it refuses unless LOAD_SEED_CONFIRM names
 * the database it's about to write to, and refuses PRODUCTION_SUPABASE_REF.
 *
 * It deliberately reads LOAD_SEED_* variables, not DATABASE_URL, so an
 * .env.local that points at production can't be picked up by accident.
 *
 *   npm run load:seed -- --organiser-email you+loadorg@example.com --door 1200 --members 25
 *
 * Environment (put them in .env.load.local, which git ignores):
 *   LOAD_SEED_DATABASE_URL    the staging project's connection string (direct or session pooler)
 *   LOAD_SEED_CONFIRM         the staging project's ref (printed if wrong), to confirm the target
 *   PRODUCTION_SUPABASE_REF   optional: production's project ref, always refused
 *   LOAD_SUPABASE_URL, LOAD_SUPABASE_SECRET_KEY   staging only; needed for --members, and to
 *                             create the organiser's account when it doesn't exist yet
 *   LOAD_ORGANISER_PASSWORD   that account's password, when the seed creates it
 *   LOAD_MEMBER_PASSWORD      the members' password (--members)
 *
 * Options:
 *   --organiser-email <email>  the staging account that owns the load-test organiser (required)
 *   --browse <n>               browse events (default 60)
 *   --scarce <n>               tickets on the sell-out event (default 20; only when it's first made)
 *   --scarce-label <label>     a fresh sell-out event, for another sell-out run
 *   --door <n>                 a new door event with n tickets (default 0: none)
 *   --door-label <label>       the door event's label (default: the time now, e.g. 20261113-0930)
 *   --members <n>              n member accounts with confirmed emails (default 0)
 *   --member-domain <domain>   their email domain (default example.com: mail to it goes nowhere)
 *   --no-images                no photos on the browse events
 *
 * Writes tests/load/seed/seed-output.local.json (event ids, slugs and door
 * codes) and tests/load/seed/members.local.json (member emails, no
 * passwords). Both are git-ignored: the codes are tickets.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { connectPostgres, type Db } from "../../../lib/server/db";
import { databaseLabel, memberEmail, seedLoadData, type SeedImage, type SeedOutput } from "./seed";

const OUT_DIR = import.meta.dirname;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`Missing ${name} (see tests/load/README.md, "Seed the staging database").`);
  return value;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[a.slice(2)] = true;
    else {
      args[a.slice(2)] = next;
      i += 1;
    }
  }
  return args;
}

function count(args: Record<string, string | true>, name: string, fallback: number, max: number): number {
  const raw = args[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(`--${name} must be a whole number from 0 to ${max}.`);
  return n;
}

/** Event photos: noisy gradients, so they're photo-sized JPEGs (a few hundred KB), like an organiser's upload. */
async function makeImages(): Promise<SeedImage[]> {
  const colours = [
    { r: 214, g: 72, b: 38 },
    { r: 36, g: 92, b: 170 },
    { r: 30, g: 140, b: 90 },
    { r: 150, g: 60, b: 160 },
  ];
  return Promise.all(
    colours.map(async (background) => ({
      contentType: "image/jpeg" as const,
      data: new Uint8Array(
        await sharp({ create: { width: 1200, height: 750, channels: 3, background, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
          .jpeg({ quality: 82 })
          .toBuffer(),
      ),
    })),
  );
}

function adminClient() {
  const url = requireEnv("LOAD_SUPABASE_URL");
  return { url, client: createClient(url, requireEnv("LOAD_SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }) };
}

/** A confirmed account (no email is sent): created, or "exists" (its password is left as it was). */
async function ensureAccount(email: string, password: string): Promise<"created" | "exists"> {
  const { client } = adminClient();
  const { error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return "created";
  if (error.code === "email_exists" || error.code === "user_already_exists") return "exists";
  throw new Error(`Creating ${email.replace(/^(.).*@/, "$1***@")} failed: ${error.message}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const organiserEmail = typeof args["organiser-email"] === "string" ? args["organiser-email"].trim().toLowerCase() : "";
  if (!organiserEmail.includes("@")) fail("--organiser-email <email> is required: the staging account that owns the load-test organiser.");
  const browse = count(args, "browse", 60, 500);
  const scarce = Math.max(1, count(args, "scarce", 20, 10_000));
  const doorTickets = count(args, "door", 0, 20_000);
  const members = count(args, "members", 0, 200);
  const memberDomain = typeof args["member-domain"] === "string" ? args["member-domain"] : "example.com";
  const scarceLabel = typeof args["scarce-label"] === "string" ? args["scarce-label"] : undefined;
  const doorLabel =
    typeof args["door-label"] === "string"
      ? args["door-label"]
      : new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");

  // Which database: confirmed by name, never production.
  const databaseUrl = requireEnv("LOAD_SEED_DATABASE_URL");
  const label = databaseLabel(databaseUrl);
  const productionRef = process.env.PRODUCTION_SUPABASE_REF?.trim().toLowerCase();
  if (productionRef && label.toLowerCase() === productionRef) fail("LOAD_SEED_DATABASE_URL is the production project. Refusing.");
  if (process.env.LOAD_SEED_CONFIRM !== label) {
    fail(`To seed this database, set LOAD_SEED_CONFIRM=${label} (check it's the STAGING project, not production).`);
  }
  if (process.env.LOAD_SUPABASE_URL && !new URL(process.env.LOAD_SUPABASE_URL).hostname.includes(label) && /^[a-z0-9]{20}$/.test(label)) {
    fail("LOAD_SUPABASE_URL isn't the same Supabase project as LOAD_SEED_DATABASE_URL.");
  }

  const sql = connectPostgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
  };
  try {
    // The organiser's account: found, or created confirmed when there's an admin key.
    let [owner] = await db.query<{ id: string }>(`select id from auth.users where lower(email) = $1`, [organiserEmail]);
    if (!owner) {
      if (!process.env.LOAD_SUPABASE_SECRET_KEY) {
        fail("No staging account has --organiser-email. Sign up with it on the staging site (and confirm it), or set LOAD_SUPABASE_URL, LOAD_SUPABASE_SECRET_KEY and LOAD_ORGANISER_PASSWORD.");
      }
      await ensureAccount(organiserEmail, requireEnv("LOAD_ORGANISER_PASSWORD"));
      [owner] = await db.query<{ id: string }>(`select id from auth.users where lower(email) = $1`, [organiserEmail]);
      if (!owner) fail("The organiser's account was created but can't be found in auth.users: is the database the same project?");
    }

    const images = args["no-images"] ? [] : await makeImages();
    const output = await seedLoadData(db, {
      ownerUserId: owner.id,
      organiserEmail,
      browseEvents: browse,
      scarceQuantity: scarce,
      doorTickets,
      doorLabel,
      scarceLabel,
      images,
    });
    // A run without --door keeps the last door event (and its codes) in the output.
    const outFile = path.join(OUT_DIR, "seed-output.local.json");
    if (!output.door && existsSync(outFile)) {
      const previous = JSON.parse(readFileSync(outFile, "utf8")) as Partial<SeedOutput>;
      if (previous.door) output.door = previous.door;
    }
    writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });

    if (members > 0) {
      const password = requireEnv("LOAD_MEMBER_PASSWORD");
      const list: { email: string }[] = [];
      let created = 0;
      for (let i = 1; i <= members; i++) {
        const email = memberEmail(i, memberDomain);
        if ((await ensureAccount(email, password)) === "created") created += 1;
        list.push({ email });
      }
      writeFileSync(path.join(OUT_DIR, "members.local.json"), `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
      console.log(`Members: ${created} created, ${members - created} already there (their passwords unchanged).`);
    }

    console.log(
      `Seeded ${label}: organiser ${output.organiser.organiserId} (payouts ${output.organiser.payoutsReady ? "ready" : "not set up: no paid event"}), ` +
        `${output.browse.count} browse events, on-sale ${output.onsale.slug}, scarce ${output.scarce.slug} (${output.scarce.quantity} tickets)` +
        (output.paid ? `, paid ${output.paid.slug}` : "") +
        (output.door ? `, door ${output.door.slug} with ${output.door.tickets} tickets` : "") +
        `. Wrote tests/load/seed/seed-output.local.json.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
