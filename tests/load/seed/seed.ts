/**
 * Load-test data for a STAGING database (never production): the events the
 * k6 scenarios in tests/load/scenarios/ open, buy and scan. Run through
 * seed-load-data.ts (`npm run load:seed`); tests/server/load-seed.test.ts runs
 * it against every migration.
 *
 * Everything belongs to one approved organiser owned by a staging account (the
 * one the door scenario signs in as), and every title starts with
 * SEED_TITLE_PREFIX: the write scenarios refuse any other event.
 *
 * - browse: `browseEvents` published, upcoming events over the next 8 weeks,
 *   in every category, around Melbourne (with map pins), some with a photo,
 *   every 8th one externally ticketed. Free tickets.
 * - onsale: one free event with a big allowance (the on-sale spike's page and
 *   its member claims).
 * - scarce: one free event with `scarceQuantity` tickets (the sell-out run;
 *   `scarceLabel` makes a fresh one for another run).
 * - paid: one A$10 event, only when the organiser already has Stripe payouts
 *   set up (a TEST-mode Connect account): card checkouts need one.
 * - door: with `doorTickets` > 0, a new event in progress now with that many
 *   paid (free, A$0) tickets in orders of 1 to 4, and their codes. A new
 *   event each time (`doorLabel` in its slug), so every door run starts
 *   with nothing checked in. No buyer email: no ticket email is queued.
 *
 * Re-running is safe: existing seeded events keep their tickets and orders
 * and only have their dates moved forward, so they stay upcoming.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../../../lib/server/db";
import { TICKET_CODE_ALPHABET } from "../../../lib/ticket-code";

export const SEED_TITLE_PREFIX = "[Load test]";
export const SEED_SLUG_PREFIX = "load-test-";
export const ORGANISER_NAME = "Load Test Collective";

export interface SeedImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
}

export interface SeedOptions {
  /** The staging account that owns the load-test organiser (auth.users id). */
  ownerUserId: string;
  /** Its email: the organiser's contact address. */
  organiserEmail: string;
  browseEvents: number;
  scarceQuantity: number;
  /** 0: no door event. */
  doorTickets: number;
  /** Makes the door event's slug unique: lowercase letters, digits and hyphens. */
  doorLabel: string;
  /** A new scarce event (slug suffix) for another sell-out run; absent: the first one. */
  scarceLabel?: string;
  /** Photos for the browse events, used in turn (every other event gets one). Empty: none. */
  images: SeedImage[];
  now?: Date;
}

export interface SeededEvent {
  eventId: string;
  slug: string;
}

export interface SeedOutput {
  generatedAt: string;
  organiser: { organiserId: string; payoutsReady: boolean };
  browse: { count: number };
  onsale: SeededEvent;
  scarce: SeededEvent & { quantity: number };
  paid: SeededEvent | null;
  door: (SeededEvent & { tickets: number; codes: string[] }) | null;
}

/**
 * What LOAD_SEED_CONFIRM must say for a connection string: the Supabase
 * project ref (from the pooler's `postgres.<ref>` user name or the direct
 * `db.<ref>.supabase.co` host), else the host name.
 */
export function databaseLabel(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const pooled = /^postgres\.([a-z0-9]+)$/.exec(user);
  if (pooled) return pooled[1];
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (direct) return direct[1];
  return url.hostname;
}

/**
 * The n-th seeded member's email. No `+tag`: the free-ticket allowance is per
 * person, and private.email_key folds `name+tag@` into `name@`, so plus
 * addresses would all share one allowance of 4 tickets per event.
 */
export function memberEmail(n: number, domain: string): string {
  return `loadtest-member${n}@${domain}`;
}

const CATEGORIES = ["live-music", "art", "workshop", "pop-up", "theatre"] as const;

/** Melbourne suburbs with a pin near their centre (inside AUSTRALIA_BOUNDS). */
const PLACES = [
  { suburb: "Fitzroy", lat: -37.7984, lng: 144.9783 },
  { suburb: "Brunswick", lat: -37.7667, lng: 144.9623 },
  { suburb: "Collingwood", lat: -37.8022, lng: 144.9874 },
  { suburb: "Northcote", lat: -37.7699, lng: 144.9997 },
  { suburb: "Footscray", lat: -37.8002, lng: 144.8993 },
  { suburb: "St Kilda", lat: -37.8676, lng: 144.9809 },
  { suburb: "Richmond", lat: -37.8183, lng: 144.9983 },
  { suburb: "Melbourne", lat: -37.8136, lng: 144.9631 },
  { suburb: "Thornbury", lat: -37.7556, lng: 145.0047 },
  { suburb: "Southbank", lat: -37.8226, lng: 144.9646 },
] as const;

/** Words the browse scenario searches for (tests/load/lib/journeys.js), so searches find something. */
const TOPICS = [
  ["Jazz", "late night jazz and soul"],
  ["Ceramics", "a hands-on ceramics workshop"],
  ["Zine", "a zine fair with risograph printing"],
  ["Poetry", "poetry and noise"],
  ["Film", "short film screenings"],
  ["Print", "an analog print market"],
  ["Dance", "a dance night"],
  ["Comedy", "new comedy"],
] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ticketCode(): string {
  // 256 is a multiple of the 32-letter alphabet, so `byte % 32` has no bias (as lib/server/ticket-issuance.ts).
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += TICKET_CODE_ALPHABET[bytes[i] % TICKET_CODE_ALPHABET.length];
    if (i === 3) code += "-";
  }
  return code;
}

function orderId(): string {
  return `ord_${randomBytes(16).toString("hex")}`;
}

interface EventSpec {
  slug: string;
  title: string;
  description: string;
  category: (typeof CATEGORIES)[number];
  place: (typeof PLACES)[number];
  startsAt: Date;
  hours: number;
  ticketTypes: Record<string, unknown>[];
  externalUrl?: string;
}

/**
 * Inserts the event (published) or, when the slug is already one of this
 * organiser's, moves its dates. Ticket types, the approval log entry and the
 * photo only for a new event. Throws when the slug belongs to someone else.
 */
async function upsertEvent(db: Db, organiserId: string, spec: EventSpec, image?: SeedImage): Promise<SeededEvent & { inserted: boolean }> {
  if (!spec.title.startsWith(SEED_TITLE_PREFIX) || !spec.slug.startsWith(SEED_SLUG_PREFIX)) {
    throw new Error(`Seeded events must be marked as such: ${spec.slug}`);
  }
  const external = spec.externalUrl !== undefined;
  const endsAt = new Date(spec.startsAt.getTime() + spec.hours * HOUR);
  const [row] = await db.query<{ id: string; inserted: boolean }>(
    `insert into public.events as e (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
       starts_at, ends_at, status, ticketing_mode, external_ticket_url, external_free, is_free,
       state, time_zone, location_source, venue_lat, venue_lng)
     values ($1, $2, $3, $4, $5::public.event_category, $6, $7, $8, $9, $10, 'published',
       $11, $12, $13, $13, 'VIC', 'Australia/Melbourne', 'manual_pin', $14, $15)
     on conflict (slug) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at
       where e.organiser_id = excluded.organiser_id
     returning e.id, (xmax = 0) as inserted`,
    [
      organiserId,
      spec.slug,
      spec.title,
      spec.description,
      spec.category,
      `${spec.place.suburb} Load Test Hall`,
      `1 Test Lane, ${spec.place.suburb} VIC`,
      spec.place.suburb,
      spec.startsAt.toISOString(),
      endsAt.toISOString(),
      external ? "external" : "sheltuh",
      spec.externalUrl ?? null,
      external,
      spec.place.lat,
      spec.place.lng,
    ],
  );
  if (!row) throw new Error(`The slug ${spec.slug} is taken by another organiser's event: not touched.`);
  if (row.inserted) {
    if (!external) {
      await db.query(`select private.replace_ticket_types($1, $2::text::jsonb)`, [row.id, JSON.stringify(spec.ticketTypes)]);
    }
    await db.query(`insert into public.event_moderation_log (event_id, action) values ($1, 'approved')`, [row.id]);
    if (image) {
      await db.query(`insert into public.event_images (event_id, content_type, data) values ($1, $2, $3)`, [
        row.id,
        image.contentType,
        image.data,
      ]);
    }
  }
  return { eventId: row.id, slug: spec.slug, inserted: row.inserted };
}

/** The staging organiser, created approved when the account has none. Throws for one that isn't approved. */
async function ensureOrganiser(db: Db, ownerUserId: string, email: string) {
  const [existing] = await db.query<{ id: string; status: string; payouts_ready: boolean }>(
    `select id, status::text as status, (stripe_account_id is not null and payouts_enabled) as payouts_ready
       from public.organisers where owner_user_id = $1`,
    [ownerUserId],
  );
  if (existing) {
    if (existing.status !== "approved") {
      throw new Error(`The account's organiser is ${existing.status}, not approved: approve it in the staging admin first.`);
    }
    return { organiserId: existing.id, payoutsReady: existing.payouts_ready };
  }
  const [created] = await db.query<{ id: string }>(
    `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
     values ($1, $2, $3, 'Organiser for load testing on staging. Not a real organiser.', $4::text::public.event_category[], 'approved')
     returning id`,
    // An array literal: the same text whichever driver sends it (postgres.js, PGlite).
    [ownerUserId, ORGANISER_NAME, email, `{${CATEGORIES.join(",")}}`],
  );
  return { organiserId: created.id, payoutsReady: false };
}

const free = (id: string, name: string, quantityAvailable: number) => ({
  id,
  name,
  priceCents: 0,
  feePolicy: "buyer-pays",
  quantityAvailable,
});

/** The door's orders: 1 to 4 tickets each, `tickets` in all. */
function doorOrders(tickets: number, ticketTypeId: string, ticketTypeName: string) {
  const orders: { id: string; lineItems: unknown[]; tickets: { ticketCode: string; ticketTypeId: string; ticketTypeName: string }[] }[] = [];
  let left = tickets;
  for (let i = 0; left > 0; i++) {
    const quantity = Math.min(left, (i % 4) + 1);
    left -= quantity;
    orders.push({
      id: orderId(),
      lineItems: [{ ticketTypeId, ticketTypeName, unitPriceCents: 0, feePolicy: "buyer-pays", quantity }],
      tickets: Array.from({ length: quantity }, () => ({ ticketCode: ticketCode(), ticketTypeId, ticketTypeName })),
    });
  }
  return orders;
}

/**
 * Pending free orders, then each fulfilled by private.fulfil_order_detailed
 * (the webhook's own step: stock taken, tickets issued, order paid), in
 * chunks. No buyer email, so no ticket email is queued.
 */
async function issueDoorTickets(db: Db, event: SeededEvent, organiserId: string, title: string, tickets: number): Promise<string[]> {
  const orders = doorOrders(tickets, "door", "General admission");
  const codes: string[] = [];
  for (let start = 0; start < orders.length; start += 100) {
    const chunk = orders.slice(start, start + 100);
    await db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
         subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
       select o ->> 'id', $1, $2, $3, null, o -> 'lineItems', 0, 0, 0, 0, 'pending'
         from jsonb_array_elements($4::text::jsonb) o`,
      [event.eventId, organiserId, title, JSON.stringify(chunk)],
    );
    const fulfilled = await db.query<{ status: string | null }>(
      `select f.order_status::text as status
         from jsonb_array_elements($1::text::jsonb) x
        cross join lateral private.fulfil_order_detailed(x ->> 'id', null, null, x -> 'tickets') f`,
      [JSON.stringify(chunk.map((o) => ({ id: o.id, tickets: o.tickets })))],
    );
    const notPaid = fulfilled.filter((f) => f.status !== "paid").length;
    if (notPaid > 0) throw new Error(`${notPaid} door order(s) weren't fulfilled.`);
    for (const o of chunk) for (const t of o.tickets) codes.push(t.ticketCode);
  }
  return codes;
}

export async function seedLoadData(db: Db, options: SeedOptions): Promise<SeedOutput> {
  const now = options.now ?? new Date();
  const label = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!label.test(options.doorLabel)) throw new Error("doorLabel: lowercase letters, digits and hyphens only.");
  if (options.scarceLabel !== undefined && !label.test(options.scarceLabel)) {
    throw new Error("scarceLabel: lowercase letters, digits and hyphens only.");
  }
  const { organiserId, payoutsReady } = await ensureOrganiser(db, options.ownerUserId, options.organiserEmail);
  // Tomorrow at 7 pm Melbourne-ish (09:00 UTC), so nothing seeded is in the past.
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 9));

  for (let i = 0; i < options.browseEvents; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const place = PLACES[i % PLACES.length];
    const [topic, blurb] = TOPICS[i % TOPICS.length];
    const external = i % 8 === 7;
    await upsertEvent(
      db,
      organiserId,
      {
        slug: `${SEED_SLUG_PREFIX}browse-${i + 1}`,
        title: `${SEED_TITLE_PREFIX} ${topic} in ${place.suburb} #${i + 1}`,
        description: `A load-test event: ${blurb} in ${place.suburb}. Not a real event.`,
        category,
        place,
        startsAt: new Date(base.getTime() + (i % 56) * DAY + (i % 3) * HOUR),
        hours: 3,
        ticketTypes: [free("ga", "General admission", 500)],
        ...(external ? { externalUrl: `https://www.humanitix.com/au/events/load-test-${i + 1}` } : {}),
      },
      options.images.length > 0 && i % 2 === 0 ? options.images[(i / 2) % options.images.length] : undefined,
    );
  }

  const onsale = await upsertEvent(
    db,
    organiserId,
    {
      slug: `${SEED_SLUG_PREFIX}onsale-free`,
      title: `${SEED_TITLE_PREFIX} On-sale night (free)`,
      description: "The on-sale spike's event. Not a real event.",
      category: "live-music",
      place: PLACES[0],
      startsAt: new Date(base.getTime() + 14 * DAY),
      hours: 4,
      ticketTypes: [free("free", "Free entry", 50_000)],
    },
    options.images[0],
  );
  const scarce = await upsertEvent(db, organiserId, {
    slug: `${SEED_SLUG_PREFIX}scarce-free${options.scarceLabel ? `-${options.scarceLabel}` : ""}`,
    title: `${SEED_TITLE_PREFIX} Scarce free tickets${options.scarceLabel ? ` ${options.scarceLabel}` : ""}`,
    description: "Sells out on purpose (the sell-out run). Not a real event.",
    category: "art",
    place: PLACES[1],
    startsAt: new Date(base.getTime() + 15 * DAY),
    hours: 3,
    ticketTypes: [free("free", "Free entry", options.scarceQuantity)],
  });
  const [{ quantity }] = await db.query<{ quantity: number }>(
    `select quantity_available as quantity from public.ticket_types where event_id = $1 and id = 'free'`,
    [scarce.eventId],
  );

  let paid: SeededEvent | null = null;
  if (payoutsReady) {
    const event = await upsertEvent(db, organiserId, {
      slug: `${SEED_SLUG_PREFIX}onsale-paid`,
      title: `${SEED_TITLE_PREFIX} On-sale night (paid, Stripe test mode)`,
      description: "The paid checkout run's event. Stripe TEST mode only. Not a real event.",
      category: "live-music",
      place: PLACES[2],
      startsAt: new Date(base.getTime() + 16 * DAY),
      hours: 4,
      ticketTypes: [{ id: "ga", name: "General admission", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 50_000 }],
    });
    paid = { eventId: event.eventId, slug: event.slug };
  }

  let door: SeedOutput["door"] = null;
  if (options.doorTickets > 0) {
    const title = `${SEED_TITLE_PREFIX} Door ${options.doorLabel}`;
    // In progress: started an hour ago, ends in five.
    const event = await upsertEvent(db, organiserId, {
      slug: `${SEED_SLUG_PREFIX}door-${options.doorLabel}`,
      title,
      description: "The door check-in run's event. Not a real event.",
      category: "live-music",
      place: PLACES[3],
      startsAt: new Date(now.getTime() - HOUR),
      hours: 6,
      ticketTypes: [free("door", "General admission", options.doorTickets)],
    });
    if (!event.inserted) throw new Error(`A door event labelled ${options.doorLabel} already exists: use a new label.`);
    const codes = await issueDoorTickets(db, event, organiserId, title, options.doorTickets);
    door = { eventId: event.eventId, slug: event.slug, tickets: codes.length, codes };
  }

  return {
    generatedAt: now.toISOString(),
    organiser: { organiserId, payoutsReady },
    browse: { count: options.browseEvents },
    onsale: { eventId: onsale.eventId, slug: onsale.slug },
    scarce: { eventId: scarce.eventId, slug: scarce.slug, quantity },
    paid,
    door,
  };
}
