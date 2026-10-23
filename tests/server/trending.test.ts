import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/server/db";
import { getMyEvent } from "@/lib/server/handlers/events";
import {
  adminGetEventCuration,
  adminSetEventCuration,
  getTrendingEvents,
  runTrendingCron,
  TRENDING_CACHE_CONTROL,
} from "@/lib/server/handlers/trending";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { createTestDb } from "./helpers/test-db";

/**
 * Trending (docs/architecture.md, "Trending"; migration 20261023000000).
 * Most tests build the data straight in SQL and refresh as of a fixed instant
 * (`pNow`: noon today, Melbourne time), so day boundaries are deterministic.
 */

let db: Db;
let reset: () => Promise<void>;
let api: TestApi;
/** Noon today in Melbourne, as an ISO instant: the refresh's "now" in most tests. */
let pNow: string;

beforeAll(async () => {
  ({ db, reset } = await createTestDb());
});

beforeEach(async () => {
  await reset();
  api = new TestApi(db);
  const [row] = await db.query<{ t: Date }>(
    `select (((now() at time zone 'Australia/Melbourne')::date + interval '12 hours')::timestamp
              at time zone 'Australia/Melbourne') as t`,
  );
  pNow = new Date(row.t).toISOString();
});

// ---------------------------------------------------------------------------
// Fixtures (SQL)
// ---------------------------------------------------------------------------

interface Org {
  organiserId: string;
  owner: { token: string; userId: string; email: string };
  contactEmail: string;
}

async function organiser(status: "approved" | "pending" | "rejected" = "approved"): Promise<Org> {
  const owner = await api.signUp();
  const contactEmail = `contact-${crypto.randomUUID().slice(0, 8)}@organiser.example`;
  const [row] = await db.query<{ id: string }>(
    `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
     values ($1, 'Static Collective', $2, 'Gigs.', '{live-music}', $3::public.organiser_status) returning id`,
    [owner.userId, contactEmail, status],
  );
  return { organiserId: row.id, owner, contactEmail };
}

interface EventOptions {
  /** Days from pNow to the start (negative: started already). Default 3. */
  startsInDays?: number;
  /** Default 3 hours. */
  durationHours?: number;
  status?: "draft" | "pending_review" | "published" | "rejected";
  /** One 'approved' log entry per value, hours before pNow, in this order. Default [24]. */
  approvedHoursAgo?: number[];
  external?: boolean;
  whosGoingEnabled?: boolean;
}

async function event(org: Org, options: EventOptions = {}): Promise<string> {
  const startsInDays = options.startsInDays ?? 3;
  const external = options.external ?? false;
  const [row] = await db.query<{ id: string }>(
    `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
       starts_at, ends_at, status, ticketing_mode, external_ticket_url, whos_going_enabled)
     values ($1, $2, 'Neon Static', 'Bands.', 'live-music', 'The Tote', '71 Johnston St', 'Collingwood',
       $3::timestamptz + make_interval(secs => $4::double precision * 86400),
       $3::timestamptz + make_interval(secs => $4::double precision * 86400 + $5::double precision * 3600),
       $6::public.event_status, $7, $8, $9)
     returning id`,
    [
      org.organiserId,
      `neon-${crypto.randomUUID().slice(0, 12)}`,
      pNow,
      startsInDays,
      options.durationHours ?? 3,
      options.status ?? "published",
      external ? "external" : "sheltuh",
      external ? "https://events.humanitix.com/neon-static" : null,
      options.whosGoingEnabled ?? true,
    ],
  );
  for (const hours of options.approvedHoursAgo ?? [24]) {
    await db.query(
      `insert into public.event_moderation_log (event_id, action, created_at)
       values ($1, 'approved', $2::timestamptz - make_interval(secs => $3::double precision * 3600))`,
      [row.id, pNow, hours],
    );
  }
  return row.id;
}

/** 10:00 Melbourne time, `daysAgo` Melbourne days before pNow's. */
async function dayAt(daysAgo: number, hour = 10): Promise<string> {
  const [row] = await db.query<{ t: Date }>(
    `select ((($1::timestamptz at time zone 'Australia/Melbourne')::date - $2::int) + make_interval(hours => $3::int))::timestamp
              at time zone 'Australia/Melbourne' as t`,
    [pNow, daysAgo, hour],
  );
  return new Date(row.t).toISOString();
}

/** `count` favourites by fresh accounts, `daysAgo` days ago (or by `userId`, once). */
async function favourites(eventId: string, count: number, daysAgo = 0, userId?: string) {
  const at = await dayAt(daysAgo);
  if (userId) {
    await db.query(`insert into public.event_favourites (user_id, event_id, created_at) values ($1, $2, $3)`, [userId, eventId, at]);
    return;
  }
  await db.query(
    `with u as (insert into auth.users (id, email)
                select gen_random_uuid(), gen_random_uuid()::text || '@fan.example' from generate_series(1, $2) returning id)
     insert into public.event_favourites (user_id, event_id, created_at) select id, $1, $3 from u`,
    [eventId, count, at],
  );
}

/** `count` Who's Going opt-ins by fresh members (with profiles), optionally suspended; or by `userId`, once. */
async function optIns(eventId: string, count: number, options: { daysAgo?: number; suspended?: boolean; userId?: string } = {}) {
  const at = await dayAt(options.daysAgo ?? 0);
  const ids = options.userId
    ? [options.userId]
    : (
        await db.query<{ id: string }>(
          `insert into auth.users (id, email)
           select gen_random_uuid(), gen_random_uuid()::text || '@member.example' from generate_series(1, $1) returning id`,
          [count],
        )
      ).map((r) => r.id);
  for (const id of ids) {
    await db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'Member', now()) on conflict do nothing`,
      [id],
    );
    await db.query(`insert into public.event_attendees (event_id, user_id, created_at) values ($1, $2, $3)`, [eventId, id, at]);
    if (options.suspended) await db.query(`insert into private.social_suspensions (user_id) values ($1)`, [id]);
  }
}

/** `count` orders (default paid, A$0 = free), `daysAgo` days ago. */
async function orders(
  eventId: string,
  org: Org,
  count: number,
  options: { daysAgo?: number; totalCents?: number; email?: string; status?: string } = {},
) {
  const at = await dayAt(options.daysAgo ?? 0);
  const total = options.totalCents ?? 0;
  await db.query(
    `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
       subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status, created_at)
     select 'ord_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, 'Neon Static',
            coalesce($3, gen_random_uuid()::text || '@buyer.example'), '[]'::jsonb, $4, 0, $4, 0,
            $5::public.order_status, $6
       from generate_series(1, $7)`,
    [eventId, org.organiserId, options.email ?? null, total, options.status ?? "paid", at, count],
  );
}

/** Views on one Melbourne day; `flood` marks the day's view cap as reached. */
async function views(eventId: string, count: number, daysAgo = 0, flood = false) {
  await db.query(
    `insert into public.event_view_counts (event_id, day, source, views)
     values ($1, ($2::timestamptz at time zone 'Australia/Melbourne')::date - $3::int, 'direct', $4)`,
    [eventId, pNow, daysAgo, count],
  );
  if (flood) {
    await db.query(
      `insert into private.event_view_cap_days (event_id, day)
       values ($1, ($2::timestamptz at time zone 'Australia/Melbourne')::date - $3::int)`,
      [eventId, pNow, daysAgo],
    );
  }
}

async function refresh(at: string = pNow) {
  const [row] = await db.query<{ eligible: number; ranked: number }>(
    `select eligible, ranked from private.refresh_trending($1::timestamptz)`,
    [at],
  );
  return row;
}

async function snapshot() {
  return db.query<{ rank: number; event_id: string; score: number }>(
    `select rank, event_id, score from private.trending_snapshot order by rank`,
  );
}

async function ranked(): Promise<string[]> {
  return (await snapshot()).map((r) => r.event_id);
}

async function setBoost(eventId: string, boost: number, excluded = false) {
  await db.query(
    `insert into private.event_curation (event_id, boost, excluded) values ($1, $2, $3)
     on conflict (event_id) do update set boost = excluded.boost, excluded = excluded.excluded`,
    [eventId, boost, excluded],
  );
}

// The formula, written out independently of the SQL.
const utility = (v: number, flood: boolean, f: number, g: number, op: number, of: number) =>
  6 * Math.log(1 + (flood ? 0 : Math.min(v, 300))) +
  8 * Math.min(f, 50) +
  15 * Math.min(g, 50) +
  25 * Math.min(op, 50) +
  10 * Math.min(of, 50);
const decay = (age: number) => (age >= 0 && age <= 13 ? 0.5 ** (age / 3) : 0);
const shrink = (raw: number, n: number, prior: number) => (n * raw + 2 * prior) / (n + 2);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function sqlNumber(sql: string, params: unknown[] = []): Promise<number> {
  const [row] = await db.query<{ v: number }>(`select (${sql})::double precision as v`, params);
  return Number(row.v);
}

// ---------------------------------------------------------------------------
// Formula
// ---------------------------------------------------------------------------

describe("formula helpers", () => {
  it("daily utility: weights, views capped at 300 and logged, the rest capped at 50, flood days count no views", async () => {
    const u = (args: string) => sqlNumber(`private.trending_day_utility(${args})`);
    expect(await u("0, false, 0, 0, 0, 0")).toBe(0);
    expect(await u("100, false, 0, 0, 0, 0")).toBeCloseTo(6 * Math.log(101), 10);
    expect(await u("300, false, 0, 0, 0, 0")).toBeCloseTo(6 * Math.log(301), 10);
    expect(await u("5000, false, 0, 0, 0, 0")).toBeCloseTo(6 * Math.log(301), 10);
    expect(await u("5000, true, 0, 0, 0, 0")).toBe(0);
    expect(await u("0, false, 1, 0, 0, 0")).toBe(8);
    expect(await u("0, false, 0, 1, 0, 0")).toBe(15);
    expect(await u("0, false, 0, 0, 1, 0")).toBe(25);
    expect(await u("0, false, 0, 0, 0, 1")).toBe(10);
    expect(await u("0, false, 80, 80, 80, 80")).toBe((8 + 15 + 25 + 10) * 50);
    expect(await u("-5, false, -1, -1, -1, -1")).toBe(0);
    expect(await u("10, true, 2, 1, 1, 1")).toBe(16 + 15 + 25 + 10);
  });

  it("decay: 3-day half-life over days 0 to 13, nothing outside", async () => {
    const d = (age: number) => sqlNumber(`private.trending_decay($1::int)`, [age]);
    expect(await d(0)).toBe(1);
    expect(await d(3)).toBeCloseTo(0.5, 12);
    expect(await d(6)).toBeCloseTo(0.25, 12);
    expect(await d(13)).toBeCloseTo(0.5 ** (13 / 3), 12);
    expect(await d(14)).toBe(0);
    expect(await d(-1)).toBe(0);
  });

  it("shrinkage: m = 2 pseudo-events at the prior; no prior leaves the raw score", async () => {
    const s = (raw: number, n: number, prior: number | null) =>
      sqlNumber(`private.trending_shrink($1::float8, $2::int, $3::float8, 2)`, [raw, n, prior]);
    expect(await s(10, 2, 20)).toBe(15);
    expect(await s(100, 3, 0)).toBe(60);
    expect(await s(100, 98, 0)).toBe(98);
    expect(await s(42, 5, null)).toBe(42);
  });

  it("start proximity: 1 within 7 days (or started), linear to 0.3 at 60 days, 0.3 beyond", async () => {
    const p = (days: number) =>
      sqlNumber(`private.trending_proximity($1::timestamptz + make_interval(secs => $2::float8 * 86400), $1::timestamptz)`, [
        pNow,
        days,
      ]);
    expect(await p(-2)).toBe(1);
    expect(await p(0)).toBe(1);
    expect(await p(7)).toBe(1);
    expect(await p(33.5)).toBeCloseTo(0.65, 10);
    expect(await p(60)).toBeCloseTo(0.3, 10);
    expect(await p(90)).toBeCloseTo(0.3, 10);
  });
});

describe("refresh_trending: scores", () => {
  it("decays daily utility over 14 days, shrinks towards the median and caps each day", async () => {
    const orgA = await organiser();
    const orgB = await organiser();
    const a = await event(orgA);
    const b = await event(orgB);
    const c = await event(await organiser());
    const d = await event(await organiser());

    // A: today 120 views and 3 favourites; 3 days ago 2 paid orders; 14 days ago (outside the window) 10 favourites.
    await views(a, 120, 0);
    await favourites(a, 3, 0);
    await orders(a, orgA, 2, { daysAgo: 3, totalCents: 3000 });
    await favourites(a, 10, 14);
    // B: yesterday 4 free orders and an opt-in.
    await orders(b, orgB, 4, { daysAgo: 1 });
    await optIns(b, 1, { daysAgo: 1 });
    // C: today 500 views (capped at 300); 2 days ago a flood day of 400; 6 days ago 3 favourites.
    await views(c, 500, 0);
    await views(c, 400, 2, true);
    await favourites(c, 3, 6);
    // D: today 80 favourites (capped at 50 for the score; 80 different people for the shrinkage).
    await favourites(d, 80, 0);

    expect(await refresh()).toEqual({ eligible: 4, ranked: 4 });

    const raw = {
      [a]: utility(120, false, 3, 0, 0, 0) * decay(0) + utility(0, false, 0, 0, 2, 0) * decay(3),
      [b]: utility(0, false, 0, 1, 0, 4) * decay(1),
      [c]: utility(500, false, 0, 0, 0, 0) * decay(0) + utility(400, true, 0, 0, 0, 0) * decay(2) + utility(0, false, 3, 0, 0, 0) * decay(6),
      [d]: utility(0, false, 80, 0, 0, 0) * decay(0),
    };
    // n: distinct people (every fixture action here is by a different account or buyer email).
    const n = { [a]: 5, [b]: 5, [c]: 3, [d]: 80 };
    const prior = median(Object.values(raw));
    const expected = Object.fromEntries(Object.entries(raw).map(([id, r]) => [id, shrink(r, n[id], prior)]));

    const rows = await snapshot();
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.score).toBeCloseTo(expected[row.event_id], 8);
    const order = Object.entries(expected)
      .sort((x, y) => y[1] - x[1])
      .map(([id]) => id);
    expect(rows.map((r) => r.event_id)).toEqual(order);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("multiplies by start proximity and the admin boost", async () => {
    const soon = await event(await organiser(), { startsInDays: 3 });
    const far = await event(await organiser(), { startsInDays: 60 });
    const boosted = await event(await organiser(), { startsInDays: 3 });
    const halved = await event(await organiser(), { startsInDays: 3 });
    for (const id of [soon, far, boosted, halved]) await favourites(id, 3, 1);
    await setBoost(boosted, 2);
    await setBoost(halved, 0.5);
    await refresh();
    const score = Object.fromEntries((await snapshot()).map((r) => [r.event_id, r.score]));
    expect(score[far] / score[soon]).toBeCloseTo(0.3, 10);
    expect(score[boosted] / score[soon]).toBeCloseTo(2, 10);
    expect(score[halved] / score[soon]).toBeCloseTo(0.5, 10);
    expect(await ranked()).toEqual([boosted, soon, halved, far]);
  });

  it("replaces the whole snapshot on every refresh", async () => {
    const org = await organiser();
    const first = await event(org);
    await favourites(first, 3, 0);
    await refresh();
    expect(await ranked()).toEqual([first]);
    await db.query(`update public.events set status = 'draft' where id = $1`, [first]);
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });
    expect(await snapshot()).toEqual([]);
  });
});

describe("refresh_trending: eligibility", () => {
  it("keeps only published events of approved organisers, not ended, starting within 60 days, approved 6+ hours ago, not excluded, with 3+ people engaging", async () => {
    const org = await organiser();
    const cases: Record<string, string> = {
      eligible: await event(org),
      inProgress: await event(await organiser(), { startsInDays: -1, durationHours: 48 }),
      external: await event(await organiser(), { external: true }),
      draft: await event(await organiser(), { status: "draft" }),
      pendingReview: await event(await organiser(), { status: "pending_review" }),
      organiserRejected: await event(await organiser("rejected")),
      organiserPending: await event(await organiser("pending")),
      ended: await event(await organiser(), { startsInDays: -2, durationHours: 3 }),
      startsIn61Days: await event(await organiser(), { startsInDays: 61 }),
      approved5HoursAgo: await event(await organiser(), { approvedHoursAgo: [5] }),
      reapproved5HoursAgo: await event(await organiser(), { approvedHoursAgo: [240, 5] }),
      neverApproved: await event(await organiser(), { approvedHoursAgo: [] }),
      excluded: await event(await organiser()),
      twoEngagements: await event(await organiser()),
      viewsOnly: await event(await organiser()),
    };
    for (const [name, id] of Object.entries(cases)) {
      if (name === "twoEngagements") await favourites(id, 2, 0);
      else if (name === "viewsOnly") await views(id, 300, 0);
      else await favourites(id, 3, 1);
    }
    await setBoost(cases.excluded, 2, true);

    const result = await refresh();
    const names = Object.fromEntries(Object.entries(cases).map(([name, id]) => [id, name]));
    expect((await ranked()).map((id) => names[id]).sort()).toEqual(["eligible", "external", "inProgress"]);
    expect(result).toEqual({ eligible: 3, ranked: 3 });
  });

  it("counts favourites, opt-ins and paid and free orders as engagement; not pending, failed or refunded orders, or suspended members", async () => {
    const orgMixed = await organiser();
    const orgNot = await organiser();
    const mixed = await event(orgMixed);
    const notCounted = await event(orgNot);
    await favourites(mixed, 1, 2);
    await optIns(mixed, 1, { daysAgo: 1 });
    await orders(mixed, orgMixed, 1, { totalCents: 2500 });
    await orders(notCounted, orgNot, 2, { status: "pending" });
    await orders(notCounted, orgNot, 2, { status: "failed" });
    await orders(notCounted, orgNot, 2, { status: "refunded", totalCents: 2500 });
    await optIns(notCounted, 3, { suspended: true });
    await refresh();
    expect(await ranked()).toEqual([mixed]);
  });

  it("leaves out the organiser's own favourites, opt-ins and orders (owner account or contact email)", async () => {
    const org = await organiser();
    const id = await event(org);
    await favourites(id, 1, 0, org.owner.userId);
    await optIns(id, 1, { userId: org.owner.userId });
    await orders(id, org, 2, { email: org.owner.email.toUpperCase() });
    await orders(id, org, 2, { email: org.contactEmail, totalCents: 2000 });
    await favourites(id, 2, 0);
    // Counted, the owner's activity would make 8 engagement events; without it there are 2.
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });
    await favourites(id, 1, 1);
    expect(await refresh()).toEqual({ eligible: 1, ranked: 1 });
    // And it adds nothing to the score: the same as an event with only those 3 favourites.
    const twin = await event(await organiser());
    await favourites(twin, 2, 0);
    await favourites(twin, 1, 1);
    await refresh();
    const [x, y] = await snapshot();
    expect(x.score).toBeCloseTo(y.score, 10);
  });

  it("one person doing everything (favourite, opt-in, paid and free orders) doesn't make an event eligible", async () => {
    const org = await organiser();
    const id = await event(org);
    const fan = await api.signUp({ email: "Fan.Person@example.com" });
    await favourites(id, 1, 0, fan.userId);
    await optIns(id, 1, { userId: fan.userId, daysAgo: 1 });
    // Their guest checkouts, under the same address however it's typed (case, spaces, a +tag).
    await orders(id, org, 3, { email: " fan.person+gig@EXAMPLE.com ", totalCents: 2500 });
    await orders(id, org, 4, { email: "FAN.PERSON@example.com", daysAgo: 2 });
    // 9 engagement events, 1 person.
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });

    // A second person, also busy: still 2 people.
    const second = await api.signUp();
    await favourites(id, 1, 0, second.userId);
    await orders(id, org, 5, { email: second.email });
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });

    // A Gmail address with dots and googlemail.com is one person too.
    await orders(id, org, 1, { email: "third.fan@gmail.com" });
    await orders(id, org, 1, { email: "thirdfan@googlemail.com" });
    await orders(id, org, 1, { email: "third.fan+x@gmail.com", totalCents: 1500 });
    // ...and the third: now 3 people.
    expect(await refresh()).toEqual({ eligible: 1, ranked: 1 });
    expect(await ranked()).toEqual([id]);
  });

  it("three different people qualify, however each engaged (account or guest email)", async () => {
    const org = await organiser();
    const id = await event(org);
    await favourites(id, 1, 0);
    await optIns(id, 1, { daysAgo: 3 });
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });
    await orders(id, org, 1, { email: "guest@buyer.example", daysAgo: 5 });
    expect(await refresh()).toEqual({ eligible: 1, ranked: 1 });
  });

  it("a member's favourite and their guest order (same address) are one person; an order with no email is nobody", async () => {
    const org = await organiser();
    const id = await event(org);
    const member = await api.signUp({ email: "member@fan.example" });
    await favourites(id, 1, 0, member.userId);
    await orders(id, org, 1, { email: "MEMBER@fan.example" });
    await favourites(id, 1, 0);
    await db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
         subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status, created_at)
       values ('ord_noemail', $1, $2, 'Neon Static', null, '[]'::jsonb, 2500, 0, 2500, 0, 'paid', $3)`,
      [id, org.organiserId, await dayAt(0)],
    );
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });
    await optIns(id, 1);
    expect(await refresh()).toEqual({ eligible: 1, ranked: 1 });
  });

  it("leaves out the organiser's activity under a variant of their address, and an account with the contact email", async () => {
    const org = await organiser();
    const id = await event(org);
    const [local, domain] = org.owner.email.split("@");
    await orders(id, org, 1, { email: `${local}+promo@${domain.toUpperCase()}` });
    const contactAccount = await api.signUp({ email: org.contactEmail.toUpperCase() });
    await favourites(id, 1, 0, contactAccount.userId);
    await favourites(id, 2, 0);
    expect(await refresh()).toEqual({ eligible: 0, ranked: 0 });
  });

  it("buckets activity into Melbourne days across the start of daylight saving (4 Oct 2026)", async () => {
    // Saturday 17 Oct 2026, 13:00 in Melbourne (AEDT, UTC+11). The window is
    // 4 to 17 Oct: it starts at midnight on 4 Oct, still AEST (UTC+10), which
    // is 2026-10-03T14:00Z; daylight saving began at 02:00 that morning.
    pNow = "2026-10-17T02:00:00.000Z";
    const id = await event(await organiser(), { startsInDays: 3 });
    const fan = async (at: string) => {
      const person = await api.signUp();
      await db.query(`insert into public.event_favourites (user_id, event_id, created_at) values ($1, $2, $3)`, [person.userId, id, at]);
    };
    await fan("2026-10-03T14:30:00.000Z"); // 4 Oct 00:30 AEST: in the window, 13 days old
    await fan("2026-10-04T12:30:00.000Z"); // 4 Oct 23:30 AEDT: 13 days old
    await fan("2026-10-03T13:30:00.000Z"); // 3 Oct 23:30 AEST: before the window (00:30 on 4 Oct at today's offset)
    expect(await refresh(pNow)).toEqual({ eligible: 0, ranked: 0 });

    await fan("2026-10-04T13:30:00.000Z"); // 5 Oct 00:30 AEDT: 12 days old
    expect(await refresh(pNow)).toEqual({ eligible: 1, ranked: 1 });
    // The only eligible event is its own prior, so the score is its raw score (P = 1, B = 1).
    const [row] = await snapshot();
    expect(row.score).toBeCloseTo(utility(0, false, 2, 0, 0, 0) * decay(13) + utility(0, false, 1, 0, 0, 0) * decay(12), 10);
  });

  it("buckets activity into Melbourne days across the end of daylight saving (5 Apr 2026)", async () => {
    // Sunday 5 Apr 2026, 12:00 in Melbourne (AEST, UTC+10, since 03:00 AEDT
    // became 02:00 AEST). Today starts at midnight AEDT: 2026-04-04T13:00Z.
    pNow = "2026-04-05T02:00:00.000Z";
    const id = await event(await organiser(), { startsInDays: 3 });
    const fan = async (at: string) => {
      const person = await api.signUp();
      await db.query(`insert into public.event_favourites (user_id, event_id, created_at) values ($1, $2, $3)`, [person.userId, id, at]);
    };
    await fan("2026-04-04T13:30:00.000Z"); // 5 Apr 00:30 AEDT: today (still 4 Apr at today's offset)
    await fan("2026-04-04T12:30:00.000Z"); // 4 Apr 23:30 AEDT: yesterday
    await fan("2026-04-04T00:00:00.000Z"); // 4 Apr 11:00 AEDT: yesterday
    expect(await refresh(pNow)).toEqual({ eligible: 1, ranked: 1 });
    const [row] = await snapshot();
    expect(row.score).toBeCloseTo(utility(0, false, 1, 0, 0, 0) * decay(0) + utility(0, false, 2, 0, 0, 0) * decay(1), 10);
  });
});

describe("refresh_trending: limits", () => {
  it("breaks equal scores by the sooner start, then by id", async () => {
    // Every start within 7 days (P = 1) and the same activity: four equal scores.
    const later = await event(await organiser(), { startsInDays: 5 });
    const sooner = await event(await organiser(), { startsInDays: 2 });
    const sameA = await event(await organiser(), { startsInDays: 4 });
    const sameB = await event(await organiser(), { startsInDays: 4 });
    for (const id of [later, sooner, sameA, sameB]) await favourites(id, 3, 1);
    await refresh();
    const rows = await snapshot();
    expect(new Set(rows.map((r) => r.score)).size).toBe(1);
    const [first, second] = [sameA, sameB].sort();
    expect(rows.map((r) => r.event_id)).toEqual([sooner, first, second, later]);
  });

  it("an organiser's two places go to its best two, ties by sooner start", async () => {
    const org = await organiser();
    const a = await event(org, { startsInDays: 6 });
    const b = await event(org, { startsInDays: 2 });
    const c = await event(org, { startsInDays: 4 });
    for (const id of [a, b, c]) await favourites(id, 3, 1);
    expect(await refresh()).toEqual({ eligible: 3, ranked: 2 });
    expect(await ranked()).toEqual([b, c]);
  });

  it("ranks at most 2 events per organiser (their best two)", async () => {
    const big = await organiser();
    const first = await event(big);
    const second = await event(big);
    const third = await event(big);
    const other = await event(await organiser());
    await favourites(first, 6, 0);
    await favourites(second, 5, 0);
    await favourites(third, 4, 0);
    await favourites(other, 3, 0);
    expect(await refresh()).toEqual({ eligible: 4, ranked: 3 });
    expect(await ranked()).toEqual([first, second, other]);
  });

  it("keeps the top 24", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      const org = await organiser();
      for (let j = 0; j < 2; j++) {
        const id = await event(org);
        await favourites(id, 3 + i, 0);
        ids.push(id);
      }
    }
    expect(await refresh()).toEqual({ eligible: 26, ranked: 24 });
    const rows = await snapshot();
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    // The lowest organiser's two events (3 favourites each) are the ones left out.
    expect(rows.map((r) => r.event_id)).not.toContain(ids[0]);
    expect(rows.map((r) => r.event_id)).not.toContain(ids[1]);
  });
});

// ---------------------------------------------------------------------------
// Public endpoint
// ---------------------------------------------------------------------------

describe("GET /api/events/trending", () => {
  async function threeTrending() {
    const ids = [await event(await organiser()), await event(await organiser()), await event(await organiser())];
    for (const id of ids) await favourites(id, 3, 1);
    await refresh();
    return ids;
  }

  it("serves the snapshot's events in rank order, in the feed's public shape, cacheable by the CDN", async () => {
    const ids = await threeTrending();
    const res = await api.call(getTrendingEvents);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(TRENDING_CACHE_CONTROL);
    expect(TRENDING_CACHE_CONTROL).toMatch(/^public, .*s-maxage=300.*stale-while-revalidate/);
    expect(res.body.items.map((i: { event: { eventId: string } }) => i.event.eventId)).toEqual(await ranked());
    expect(new Set(res.body.items.map((i: { event: { eventId: string } }) => i.event.eventId))).toEqual(new Set(ids));
    const [first] = res.body.items;
    expect(Object.keys(first).sort()).toEqual(["event", "label"]);
    // Public fields only: no status, moderation log, scores or counts.
    expect(first.event).not.toHaveProperty("moderationLog");
    expect(first.event).not.toHaveProperty("status");
    expect(JSON.stringify(res.body)).not.toMatch(/score|favourite|views|rank/i);
  });

  it("is empty with fewer than 3 events, counted after the read-time checks", async () => {
    const [a, b, c] = await threeTrending();
    expect((await api.call(getTrendingEvents)).body.items).toHaveLength(3);

    await db.query(`update public.events set status = 'draft' where id = $1`, [a]);
    const res = await api.call(getTrendingEvents);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(res.headers.get("cache-control")).toBe(TRENDING_CACHE_CONTROL);
    // Still in the snapshot: hidden at read time only.
    expect(await ranked()).toEqual(expect.arrayContaining([b, c]));
  });

  it("drops events that have since ended, been unpublished, had their organiser taken down or been excluded", async () => {
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const id = await event(await organiser());
      await favourites(id, 3 + i, 1);
      ids.push(id);
    }
    await refresh();
    const [ended, unpublished, takenDown, excluded, ...kept] = ids;
    await db.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [ended]);
    await db.query(`update public.events set status = 'draft' where id = $1`, [unpublished]);
    await db.query(
      `update public.organisers set status = 'rejected' where id = (select organiser_id from public.events where id = $1)`,
      [takenDown],
    );
    await setBoost(excluded, 1, true);
    const res = await api.call(getTrendingEvents);
    expect(res.body.items.map((i: { event: { eventId: string } }) => i.event.eventId).sort()).toEqual([...kept].sort());
  });

  it("labels: going (with the count) at 5+ open opt-ins, else just announced within 72 hours of the first approval, else popular", async () => {
    const going = await event(await organiser(), { approvedHoursAgo: [200] });
    const fourGoing = await event(await organiser(), { approvedHoursAgo: [24] });
    const suspendedDontCount = await event(await organiser(), { approvedHoursAgo: [200] });
    const goingClosed = await event(await organiser(), { approvedHoursAgo: [200], whosGoingEnabled: false });
    const reapproved = await event(await organiser(), { approvedHoursAgo: [200, 10] });
    const external = await event(await organiser(), { approvedHoursAgo: [200], external: true });
    await optIns(going, 5, { daysAgo: 1 });
    await optIns(fourGoing, 4, { daysAgo: 1 });
    await optIns(suspendedDontCount, 4, { daysAgo: 1 });
    await optIns(suspendedDontCount, 2, { daysAgo: 1, suspended: true });
    await favourites(suspendedDontCount, 1, 1);
    await optIns(goingClosed, 6, { daysAgo: 1 });
    await favourites(reapproved, 3, 1);
    // An external event's Who's Going is always closed: never "going", whatever is stored.
    await favourites(external, 3, 1);
    await optIns(external, 6, { daysAgo: 1 });
    await refresh();

    const res = await api.call(getTrendingEvents);
    const byId = Object.fromEntries(
      res.body.items.map((i: { event: { eventId: string }; label: string; goingCount?: number }) => [i.event.eventId, i]),
    );
    expect(Object.keys(byId)).toHaveLength(6);
    expect(byId[going]).toMatchObject({ label: "going", goingCount: 5 });
    expect(byId[fourGoing]).toMatchObject({ label: "just-announced" });
    expect(byId[suspendedDontCount]).toMatchObject({ label: "popular" });
    expect(byId[goingClosed]).toMatchObject({ label: "popular" });
    expect(byId[reapproved]).toMatchObject({ label: "popular" });
    expect(byId[external]).toMatchObject({ label: "popular" });
    expect(byId[external].event.ticketingMode).toBe("external");
    for (const id of [fourGoing, suspendedDontCount, goingClosed, reapproved, external]) {
      expect(byId[id]).not.toHaveProperty("goingCount");
    }
  });

  it("serves the last snapshot, however old, until the next refresh", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const id = await event(await organiser());
      await favourites(id, 3, 1);
      ids.push(id);
    }
    await refresh();
    await db.query(`update private.trending_snapshot set computed_at = computed_at - interval '2 days'`);
    expect((await api.call(getTrendingEvents)).body.items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

describe("GET /api/cron/trending", () => {
  function cronRequest(authorization?: string) {
    return new Request(`${SITE_URL}/api/cron/trending`, {
      headers: authorization === undefined ? {} : { authorization },
    });
  }

  it("refuses without the secret, with a wrong one, or when CRON_SECRET isn't set (401), and refreshes nothing", async () => {
    const id = await event(await organiser());
    await favourites(id, 3, 1);
    for (const auth of [undefined, "Bearer wrong", CRON_SECRET, `Basic ${CRON_SECRET}`]) {
      expect((await api.send(runTrendingCron, cronRequest(auth))).status).toBe(401);
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.cronSecret = undefined;
    expect((await api.send(runTrendingCron, cronRequest(`Bearer ${CRON_SECRET}`))).status).toBe(401);
    error.mockRestore();
    expect(await snapshot()).toEqual([]);
  });

  it("rebuilds the snapshot with the secret and returns counts only, privately", async () => {
    const id = await event(await organiser());
    await favourites(id, 3, 1);
    const res = await api.send(runTrendingCron, cronRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligible: 1, ranked: 1 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await ranked()).toEqual([id]);
  });
});

// ---------------------------------------------------------------------------
// Admin curation
// ---------------------------------------------------------------------------

describe("PUT/GET /api/admin/events/{id}/curation", () => {
  it("is admin only: 401 signed out, 403 for anyone else", async () => {
    const org = await organiser();
    const id = await event(org);
    const member = await api.signUp();
    const body = { boost: 2, excluded: false, reason: "Great lineup" };
    for (const handler of [adminSetEventCuration, adminGetEventCuration]) {
      const method = handler === adminSetEventCuration ? "PUT" : "GET";
      const withBody = method === "PUT" ? { body } : {};
      expect((await api.call(handler, { params: { eventId: id }, method, ...withBody })).status).toBe(401);
      expect((await api.call(handler, { params: { eventId: id }, method, token: member.token, ...withBody })).status).toBe(403);
      expect((await api.call(handler, { params: { eventId: id }, method, token: org.owner.token, ...withBody })).status).toBe(403);
    }
    expect(await db.query(`select 1 from private.event_curation`)).toEqual([]);
  });

  it("404s an unknown or malformed event id", async () => {
    const admin = await api.signUp({ admin: true });
    const body = { boost: 1.5, excluded: false, reason: "x" };
    for (const eventId of ["nope", crypto.randomUUID()]) {
      expect((await api.call(adminSetEventCuration, { params: { eventId }, method: "PUT", token: admin.token, body })).status).toBe(404);
      expect((await api.call(adminGetEventCuration, { params: { eventId }, token: admin.token })).status).toBe(404);
    }
  });

  it("validates boost (0.5 to 2), excluded and reason (400 fieldErrors), saving nothing", async () => {
    const admin = await api.signUp({ admin: true });
    const id = await event(await organiser());
    const put = (body: unknown) => api.call(adminSetEventCuration, { params: { eventId: id }, method: "PUT", token: admin.token, body });
    for (const boost of [0.49, 2.01, 3, -1, "1.5", null, Number.NaN]) {
      const res = await put({ boost, excluded: false, reason: "Because" });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty("boost");
    }
    for (const excluded of [undefined, "true", 1]) {
      const res = await put({ boost: 1, excluded, reason: "Because" });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty("excluded");
    }
    for (const reason of [undefined, "", "   ", "x".repeat(501), "bad\u0000reason"]) {
      const res = await put({ boost: 1, excluded: true, reason });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty("reason");
    }
    expect(await db.query(`select 1 from private.event_curation`)).toEqual([]);
    expect(await db.query(`select 1 from public.event_moderation_log where action = 'curated'`)).toEqual([]);
  });

  it("sets boost and exclusion, logs 'curated' with the admin, reason and changes, and logs nothing when nothing changes", async () => {
    const admin = await api.signUp({ admin: true });
    const org = await organiser();
    const id = await event(org);
    const put = (body: unknown) => api.call(adminSetEventCuration, { params: { eventId: id }, method: "PUT", token: admin.token, body });

    const before = await api.call(adminGetEventCuration, { params: { eventId: id }, token: admin.token });
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ eventId: id, boost: 1, excluded: false, updatedAt: null, log: [] });
    expect(before.headers.get("cache-control")).toBe("private, no-store");

    const first = await put({ boost: 1.234, excluded: false, reason: "Strong lineup" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ eventId: id, boost: 1.23, excluded: false });
    expect(first.body.updatedAt).toEqual(expect.any(String));
    expect(first.body.log).toEqual([
      { by: admin.userId, at: expect.any(String), reason: "Strong lineup", changes: { boost: { old: 1, new: 1.23 } } },
    ]);

    const second = await put({ boost: 1.23, excluded: true, reason: "Duplicate listing" });
    expect(second.body.log[0]).toEqual({
      by: admin.userId,
      at: expect.any(String),
      reason: "Duplicate listing",
      changes: { excluded: { old: false, new: true } },
    });
    expect(second.body.log).toHaveLength(2);

    const unchanged = await put({ boost: 1.23, excluded: true, reason: "Again" });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.log).toHaveLength(2);

    const rows = await db.query<{ actor_id: string; reason: string; details: unknown }>(
      `select actor_id, reason, details from public.event_moderation_log where event_id = $1 and action = 'curated' order by id`,
      [id],
    );
    expect(rows).toEqual([
      { actor_id: admin.userId, reason: "Strong lineup", details: { boost: { old: 1, new: 1.23 } } },
      { actor_id: admin.userId, reason: "Duplicate listing", details: { excluded: { old: false, new: true } } },
    ]);

    // Editorial: the organiser's own view of the event never shows curation.
    const own = await api.call(getMyEvent, { params: { eventId: id }, token: org.owner.token });
    expect(own.status).toBe(200);
    expect(own.body.moderationLog.map((e: { action: string }) => e.action)).toEqual(["approved"]);
  });

  it("works for an event in any status; a boost takes effect at the next refresh, an exclusion straight away", async () => {
    const admin = await api.signUp({ admin: true });
    const draft = await event(await organiser(), { status: "draft" });
    expect(
      (await api.call(adminSetEventCuration, {
        params: { eventId: draft },
        method: "PUT",
        token: admin.token,
        body: { boost: 0.5, excluded: false, reason: "Pre-launch" },
      })).status,
    ).toBe(200);

    const ids = [];
    for (let i = 0; i < 4; i++) {
      const id = await event(await organiser());
      await favourites(id, 3 + i, 1);
      ids.push(id);
    }
    await refresh();
    const last = ids[0];
    expect((await ranked()).at(-1)).toBe(last);
    await api.call(adminSetEventCuration, {
      params: { eventId: last },
      method: "PUT",
      token: admin.token,
      body: { boost: 2, excluded: false, reason: "Feature it" },
    });
    expect((await ranked()).at(-1)).toBe(last);
    await refresh();
    expect((await ranked())[0]).toBe(last);

    await api.call(adminSetEventCuration, {
      params: { eventId: last },
      method: "PUT",
      token: admin.token,
      body: { boost: 2, excluded: true, reason: "Complaint" },
    });
    const res = await api.call(getTrendingEvents);
    expect(res.body.items.map((i: { event: { eventId: string } }) => i.event.eventId)).not.toContain(last);
    expect(res.body.items).toHaveLength(3);
  });
});
