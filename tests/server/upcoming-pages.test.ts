import { beforeAll, describe, expect, it } from "vitest";
import { adminListEvents, foldOrganiserSearch } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { listPublicEvents } from "@/lib/server/handlers/public-events";
import { encodeCursor } from "@/lib/server/pagination";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * The upcoming feed (GET /api/events?upcoming=1) and the admin's upcoming
 * list select their page's ids first (lib/server/upcoming-page.ts) rather
 * than filtering `ends_at > now()` along the starts index. These pin that the
 * pages are exactly what the plain query gives, whatever the filters, page
 * size and offset: events in progress (long-running ones included) first,
 * ties on starts_at broken by id, ended and unpublished events never.
 */

let api: TestApi;
let admin: { token: string; userId: string };

const FREE = [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }];

/** Moves an event to `start`/`end` hours from `base` (one instant for the whole set, so ties are exact). */
async function place(eventId: string, base: Date, start: number, end: number, perth = false) {
  await api.db.query(
    `update public.events
        set starts_at = $2::timestamptz + make_interval(mins => $3::int),
            ends_at = $2::timestamptz + make_interval(mins => $4::int)
            ${perth ? `, state = 'WA', time_zone = 'Australia/Perth'` : ""}
      where id = $1`,
    [eventId, base.toISOString(), Math.round(start * 60), Math.round(end * 60)],
  );
}

/** "YYYY-MM-DD", `days` from today in Melbourne. */
let melbourneDate: (days: number) => string;

beforeAll(async () => {
  const testDb = await createTestDb();
  api = new TestApi(testDb.db);
  await testDb.reset();
  admin = await signUpAdmin(api);
  const organiser = await approvedOrganiser(api, admin);
  const other = await approvedOrganiser(api, admin, { displayName: "Twin Peaks Presents" });

  const [{ base }] = await api.db.query<{ base: Date }>(`select date_trunc('second', now()) as base`);
  const at = new Date(base);

  const published: [string, Record<string, unknown>, number, number, boolean?][] = [
    ["Ended long ago", {}, -200, -190],
    ["Ended just now", {}, -3, -1 / 60],
    ["Running all week", { category: "art" }, -30, 50],
    ["On now", { category: "art", ticketTypes: FREE }, -1, 2],
    ["On now twin", {}, -1, 3],
    ["Tonight", {}, 5, 8],
    ["Tonight twin", { ticketTypes: FREE }, 5, 9],
    ["Tonight triple", { category: "workshop" }, 5, 6],
    ["Tomorrow in Perth", {}, 20, 23, true],
    ["Late tomorrow in Perth", {}, 40, 42, true],
    ["Next week", {}, 170, 173],
    ["Next week workshop", { category: "workshop", ticketTypes: FREE }, 170, 172],
    ["Far future", {}, 2000, 2003],
  ];
  for (const [title, overrides, start, end, perth] of published) {
    const event = await publishedEvent(api, organiser, admin, { title, ...overrides });
    await place(event.eventId, at, start, end, perth);
  }
  for (const [title, start, end] of [
    ["Other organiser on now", -2, 1],
    ["Other organiser tonight", 5, 7],
  ] as const) {
    const event = await publishedEvent(api, other, admin, { title });
    await place(event.eventId, at, start, end);
  }
  // A platform-managed organiser's (no owner account), for the admin list's platformManaged.
  const platform = await api.call(adminCreateOrganiser, {
    token: admin.token,
    body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
  });
  const platformEvent = await api.call(adminCreateEvent, {
    token: admin.token,
    body: { ...eventInput({ ticketTypes: FREE, title: "House party twin" }), organiserId: platform.body.organiserId, publish: true },
  });
  await place(platformEvent.body.eventId, at, 5, 10);
  // Never in the public feed: a draft in progress, and one coming up.
  for (const [title, start, end] of [
    ["Draft on now", -1, 2],
    ["Draft tonight", 5, 8],
  ] as const) {
    const draft = await draftEvent(api, organiser, { title });
    await place(draft.eventId, at, start, end);
  }

  const dates = await api.db.query<{ d: number; date: string }>(
    `select d, to_char((now() at time zone 'Australia/Melbourne')::date + d, 'YYYY-MM-DD') as date
       from generate_series(-2, 9) d`,
  );
  melbourneDate = (days) => dates.find((row) => row.d === days)!.date;
}, 300_000);

/** The feed's query as it was before the page-ids rewrite: every condition in one WHERE, cut by limit/offset. */
async function plainFeedIds(query: Record<string, string>, limit: number, offset: number): Promise<string[]> {
  const where = [`e.status = 'published'`, `e.ends_at > now()`];
  const params: unknown[] = [];
  if (query.category) {
    params.push(query.category);
    where.push(`e.category = $${params.length}::public.event_category`);
  }
  if (query.pricing) {
    where.push(
      query.pricing === "free"
        ? "e.is_free"
        : "exists (select 1 from public.ticket_types t where t.event_id = e.id and t.price_cents > 0)",
    );
  }
  if (query.onOrAfter) {
    params.push(query.onOrAfter);
    const n = params.length;
    where.push(
      `e.starts_at >= (($${n}::date - 1)::timestamp at time zone 'UTC')`,
      `(e.starts_at at time zone e.time_zone)::date >= $${n}::date`,
    );
  }
  if (query.q) {
    params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    where.push(
      `(e.title ilike $${n} or e.venue_name ilike $${n} or e.suburb ilike $${n}
        or o.display_name ilike $${n} or e.description ilike $${n})`,
    );
  }
  params.push(limit + 1, offset);
  const rows = await api.db.query<{ id: string }>(
    `select e.id from public.events e join public.organisers o on o.id = e.organiser_id
      where ${where.join(" and ")}
      order by e.starts_at, e.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return rows.map((row) => row.id);
}

/** As plainFeedIds, for the admin list (status, upcoming, platformManaged, folded q). */
async function plainAdminIds(
  status: string,
  options: { platformManaged?: boolean; q?: string },
  limit: number,
  offset: number,
): Promise<string[]> {
  const where = [`e.status = $1::public.event_status`, `e.ends_at > now()`];
  const params: unknown[] = [status];
  if (options.platformManaged !== undefined) {
    where.push(options.platformManaged ? "o.owner_user_id is null" : "o.owner_user_id is not null");
  }
  if (options.q) {
    params.push(`%${foldOrganiserSearch(options.q)}%`);
    const fold = (column: string) => `lower(regexp_replace(normalize(coalesce(${column}, ''), NFKD), '[\\u0300-\\u036f]', '', 'g'))`;
    where.push(`(${fold("e.title")} like $${params.length} or ${fold("o.display_name")} like $${params.length})`);
  }
  params.push(limit + 1, offset);
  const rows = await api.db.query<{ id: string }>(
    `select e.id from public.events e join public.organisers o on o.id = e.organiser_id
      where ${where.join(" and ")}
      order by e.starts_at, e.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return rows.map((row) => row.id);
}

/** The page the API gives, as the plain query's shape: the page's ids, plus one more id if there's a next page. */
function pageShape(body: { items: { eventId: string }[]; nextCursor?: string }, nextId: string | undefined) {
  return [...body.items.map((e) => e.eventId), ...(body.nextCursor ? [nextId ?? "(next page)"] : [])];
}

/** Offsets 0 to past the end, for every page size. */
function* pages(total: number) {
  for (const limit of [1, 2, 3, 50]) {
    for (let offset = 0; offset <= total + 1; offset += limit === 50 ? 7 : 1) yield { limit, offset };
  }
}

describe("GET /api/events?upcoming=1: the page-ids query gives the plain query's pages", () => {
  const filters: Record<string, string>[] = [
    {},
    { category: "art" },
    { category: "workshop" },
    { pricing: "free" },
    { pricing: "paid" },
    { q: "twin" },
    { q: "twin peaks" },
    { q: "static collective" },
    { q: "%" },
    { pricing: "paid", q: "tonight" },
  ];

  it("in progress first, ties on starts_at by id, ended and unpublished events never", async () => {
    const all = await plainFeedIds({}, 50, 0);
    const res = await api.call(listPublicEvents, { query: { upcoming: "1", limit: "50" } });
    expect(res.body.items.map((e: { eventId: string }) => e.eventId)).toEqual(all);
    const items = res.body.items as { title: string; eventId: string }[];
    const titles = items.map((e) => e.title);
    // In progress, by start: the long-running one first; the two starting together by id.
    expect(titles.slice(0, 2)).toEqual(["Running all week", "Other organiser on now"]);
    expect(new Set(titles.slice(2, 4))).toEqual(new Set(["On now", "On now twin"]));
    expect(items[2].eventId < items[3].eventId).toBe(true);
    // Three starting together tonight, also by id.
    const tonight = items.filter((e) => e.title.startsWith("Tonight"));
    expect(tonight.map((e) => e.eventId)).toEqual(tonight.map((e) => e.eventId).sort());
    expect(titles).not.toContain("Ended long ago");
    expect(titles).not.toContain("Ended just now");
    expect(titles).not.toContain("Draft on now");
    expect(titles).not.toContain("Draft tonight");
    expect(titles).toHaveLength(14);
  });

  for (const filter of filters) {
    it(`matches across page sizes and offsets: ${JSON.stringify(filter)}`, async () => {
      const total = (await plainFeedIds(filter, 50, 0)).length;
      for (const { limit, offset } of pages(total)) {
        const expected = await plainFeedIds(filter, limit, offset);
        const query = { ...filter, upcoming: "1", limit: String(limit), ...(offset ? { cursor: encodeCursor(offset) } : {}) };
        const res = await api.call(listPublicEvents, { query });
        expect(res.status).toBe(200);
        expect([limit, offset, pageShape(res.body, expected[limit])]).toEqual([limit, offset, expected]);
      }
    }, 120_000);
  }

  it("matches with onOrAfter, each event judged in its own zone", async () => {
    for (const days of [-2, -1, 0, 1, 2, 7, 9]) {
      const filter = { onOrAfter: melbourneDate(days) };
      const total = (await plainFeedIds(filter, 50, 0)).length;
      for (const { limit, offset } of pages(total)) {
        if (limit === 2) continue;
        const expected = await plainFeedIds(filter, limit, offset);
        const query = { ...filter, upcoming: "1", limit: String(limit), ...(offset ? { cursor: encodeCursor(offset) } : {}) };
        const res = await api.call(listPublicEvents, { query });
        expect([days, limit, offset, pageShape(res.body, expected[limit])]).toEqual([days, limit, offset, expected]);
      }
    }
  }, 120_000);

  it("an offset past the end is an empty last page", async () => {
    const res = await api.call(listPublicEvents, { query: { upcoming: "1", cursor: encodeCursor(1000) } });
    expect(res.body).toEqual({ items: [] });
  });
});

describe("GET /api/admin/events (upcoming): the page-ids query gives the plain query's pages", () => {
  const cases: { query: Record<string, string>; status: string; platformManaged?: boolean; q?: string }[] = [
    { query: { status: "published" }, status: "published" },
    { query: { status: "published", upcoming: "1" }, status: "published" },
    { query: { status: "published", q: "TWIN" }, status: "published", q: "TWIN" },
    { query: { status: "published", platformManaged: "1" }, status: "published", platformManaged: true },
    { query: { status: "published", platformManaged: "0" }, status: "published", platformManaged: false },
    { query: { status: "draft", upcoming: "1" }, status: "draft" },
  ];

  for (const c of cases) {
    it(`matches across page sizes and offsets: ${JSON.stringify(c.query)}`, async () => {
      const total = (await plainAdminIds(c.status, c, 50, 0)).length;
      expect(total).toBeGreaterThan(0);
      for (const { limit, offset } of pages(total)) {
        const expected = await plainAdminIds(c.status, c, limit, offset);
        const query = { ...c.query, limit: String(limit), ...(offset ? { cursor: encodeCursor(offset) } : {}) };
        const res = await api.call(adminListEvents, { token: admin.token, query });
        expect(res.status).toBe(200);
        expect([limit, offset, pageShape(res.body, expected[limit])]).toEqual([limit, offset, expected]);
      }
    }, 120_000);
  }

  it("without upcoming, past events stay listed (unchanged query)", async () => {
    const res = await api.call(adminListEvents, { token: admin.token, query: { status: "published", upcoming: "0", limit: "50" } });
    const titles = res.body.items.map((e: { title: string }) => e.title);
    expect(titles[0]).toBe("Ended long ago");
    expect(titles).toContain("Ended just now");
  });
});
