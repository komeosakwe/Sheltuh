import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminRejectEvent } from "@/lib/server/handlers/admin";
import { submitEventForReview } from "@/lib/server/handlers/events";
import {
  getPublicEventBySlug,
  listPublicEvents,
  PUBLIC_EVENT_CACHE_CONTROL,
  PUBLIC_EVENTS_CACHE_CONTROL,
} from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

const titles = (res: { body: { items: { title: string }[] } }) => res.body.items.map((e) => e.title);

describe("public event visibility", () => {
  it("draft, pending and rejected events are invisible; published ones appear", async () => {
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    const pending = await draftEvent(api, organiser, { title: "Pending" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const rejected = await draftEvent(api, organiser, { title: "Rejected" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: rejected.eventId }, body: { reason: "x" } });
    const live = await publishedEvent(api, organiser, admin, { title: "Live" });

    expect(titles(await api.call(listPublicEvents))).toEqual(["Live"]);
    for (const hidden of [draft, pending, rejected]) {
      expect((await api.call(getPublicEventBySlug, { params: { slug: hidden.slug } })).status).toBe(404);
    }
    expect((await api.call(getPublicEventBySlug, { params: { slug: live.slug } })).status).toBe(200);
    expect((await api.call(getPublicEventBySlug, { params: { slug: "never-existed" } })).status).toBe(404);
  });

  it("exposes only public fields — no status, moderation log or rejection details", async () => {
    const live = await publishedEvent(api, organiser, admin);
    const res = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "category",
        "description",
        "endsAt",
        "eventId",
        "organiserId",
        "organiserName",
        "slug",
        "startsAt",
        "suburb",
        "ticketTypes",
        "title",
        "venueAddress",
        "venueName",
        // External ticketing (B2): always sent; externalTicketUrl only for external events.
        "ticketingMode",
        "externalFree",
        "externalProvider",
        // Waitlist (B-WL): always sent.
        "soldOut",
        // Refund policy: always sent; refundDays only for days_before.
        "refundPolicy",
        // Events Australia-wide: always sent.
        "state",
        "timeZone",
        // Venue location: only when the event has one (the fixture's events do: a manual pin).
        "location",
      ].sort(),
    );
    expect(res.body).toMatchObject({ ticketingMode: "sheltuh", externalFree: false, externalProvider: null, refundPolicy: "no_change_of_mind" });
    const list = await api.call(listPublicEvents);
    expect(list.body.items[0]).toEqual(res.body);
  });

  it("ignores any attempt to widen the feed with a status parameter", async () => {
    await draftEvent(api, organiser, { title: "Draft" });
    expect(titles(await api.call(listPublicEvents, { query: { status: "draft" } }))).toEqual([]);
  });
});

describe("public feed filters and paging", () => {
  beforeEach(async () => {
    await publishedEvent(api, organiser, admin, {
      title: "Paid gig",
      start: { date: "2027-03-06", time: "20:00" },
      end: { date: "2027-03-06", time: "23:00" },
    });
    await publishedEvent(api, organiser, admin, {
      title: "Free life drawing",
      category: "art",
      start: { date: "2027-03-01", time: "18:00" },
      end: { date: "2027-03-01", time: "20:00" },
      ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 30 }],
    });
    await publishedEvent(api, organiser, admin, {
      title: "Later workshop",
      category: "workshop",
      start: { date: "2027-04-10", time: "10:00" },
      end: { date: "2027-04-10", time: "12:00" },
      ticketTypes: [
        { id: "free", name: "Observer", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 },
        { id: "paid", name: "Participant", priceCents: 4500, feePolicy: "buyer-pays", quantityAvailable: 10 },
      ],
    });
  });

  it("sorts by start time", async () => {
    expect(titles(await api.call(listPublicEvents))).toEqual(["Free life drawing", "Paid gig", "Later workshop"]);
  });

  it("searches title, venue, suburb and organiser text, case-insensitively, treating wildcards literally", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { q: "DRAWING" } }))).toEqual(["Free life drawing"]);
    // Every fixture event is at The Tote in Collingwood, by "Static Collective".
    expect(await api.call(listPublicEvents, { query: { q: "collingwood" } })).toMatchObject({
      body: { items: expect.arrayContaining([expect.objectContaining({ title: "Paid gig" })]) },
    });
    expect((await api.call(listPublicEvents, { query: { q: "static collective" } })).body.items).toHaveLength(3);
    expect(titles(await api.call(listPublicEvents, { query: { q: "no such thing" } }))).toEqual([]);
    expect(titles(await api.call(listPublicEvents, { query: { q: "%" } }))).toEqual([]);
    expect(titles(await api.call(listPublicEvents, { query: { q: "draw_ng" } }))).toEqual([]);
  });

  it("filters by category, price and start date", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { category: "art" } }))).toEqual(["Free life drawing"]);
    expect(titles(await api.call(listPublicEvents, { query: { pricing: "free" } }))).toEqual(["Free life drawing"]);
    // An event is only "free" if every ticket type is.
    expect(titles(await api.call(listPublicEvents, { query: { pricing: "paid" } }))).toEqual([
      "Paid gig",
      "Later workshop",
    ]);
    expect(titles(await api.call(listPublicEvents, { query: { onOrAfter: "2027-03-06" } }))).toEqual([
      "Paid gig",
      "Later workshop",
    ]);
  });

  it("rejects malformed filters with 400", async () => {
    const malformed: Record<string, string>[] = [
      { category: "karaoke" },
      { pricing: "cheap" },
      { onOrAfter: "06/03/2027" },
      { cursor: "x" },
    ];
    for (const query of malformed) {
      expect((await api.call(listPublicEvents, { query })).status).toBe(400);
    }
  });

  it("pages through results with an opaque cursor", async () => {
    const page1 = await api.call(listPublicEvents, { query: { limit: "2" } });
    expect(titles(page1)).toHaveLength(2);
    const page2 = await api.call(listPublicEvents, { query: { limit: "2", cursor: page1.body.nextCursor } });
    expect(titles(page2)).toEqual(["Later workshop"]);
    expect(page2.body.nextCursor).toBeUndefined();
  });
});

/** Moves an event's start and end relative to the database's now(), e.g. ("-3 hours", "-1 hour"). */
async function setTimes(eventId: string, startOffset: string, endOffset: string) {
  await api.db.query(
    `update public.events set starts_at = now() + $2::interval, ends_at = now() + $3::interval where id = $1`,
    [eventId, startOffset, endOffset],
  );
}

describe("recent=1: ended in the last 14 days, after the upcoming ones", () => {
  beforeEach(async () => {
    const make = async (title: string, start: string, end: string) => {
      const created = await publishedEvent(api, organiser, admin, { title });
      await setTimes(created.eventId, start, end);
      return created;
    };
    await make("Ended 20 days ago", "-20 days -3 hours", "-20 days");
    await make("Ended 15 days ago", "-15 days -3 hours", "-15 days");
    await make("Ended 13 days ago", "-13 days -3 hours", "-13 days");
    await make("Ended 2 days ago", "-2 days -3 hours", "-2 days");
    await make("Ended a minute ago", "-3 hours", "-1 minute");
    await make("On now", "-1 hour", "2 hours");
    await make("Tonight", "5 hours", "8 hours");
    await make("Next week", "7 days", "7 days 3 hours");
  });

  it("upcoming by start, then ended ones, most recently ended first; older than 14 days is out", async () => {
    for (const recent of ["1", "true"]) {
      expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", recent } }))).toEqual([
        "On now",
        "Tonight",
        "Next week",
        "Ended a minute ago",
        "Ended 2 days ago",
        "Ended 13 days ago",
      ]);
    }
  });

  it("only: just the ended ones in that window", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", recent: "only" } }))).toEqual([
      "Ended a minute ago",
      "Ended 2 days ago",
      "Ended 13 days ago",
    ]);
  });

  it("pages across the boundary with the cursor, nothing repeated or missed", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i++) {
      const page = await api.call(listPublicEvents, { query: { upcoming: "1", recent: "1", limit: "2", ...(cursor ? { cursor } : {}) } });
      seen.push(...titles(page));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["On now", "Tonight", "Next week", "Ended a minute ago", "Ended 2 days ago", "Ended 13 days ago"]);
  });

  it("combines with the other filters, and an unpublished event is never listed", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", recent: "1", q: "ended 2" } }))).toEqual(["Ended 2 days ago"]);
    const [row] = await api.db.query(`select id from public.events where title = 'Ended 2 days ago'`);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [(row as { id: string }).id]);
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", recent: "only" } }))).not.toContain("Ended 2 days ago");
  });

  it("an ended event stays openable by slug", async () => {
    const [row] = await api.db.query(`select slug from public.events where title = 'Ended 13 days ago'`);
    const res = await api.call(getPublicEventBySlug, { params: { slug: (row as { slug: string }).slug } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Ended 13 days ago" });
  });

  it("is additive: absent, 0, false or empty change nothing; it needs upcoming=1; junk is 400", async () => {
    const plain = titles(await api.call(listPublicEvents, { query: { upcoming: "1" } }));
    expect(plain).toEqual(["On now", "Tonight", "Next week"]);
    for (const recent of ["0", "false", ""]) {
      expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", recent } }))).toEqual(plain);
      expect((await api.call(listPublicEvents, { query: { recent } })).status).toBe(200);
    }
    for (const query of [{ recent: "1" }, { recent: "only" }, { upcoming: "0", recent: "1" }] as Record<string, string>[]) {
      expect((await api.call(listPublicEvents, { query })).status, JSON.stringify(query)).toBe(400);
    }
    for (const recent of ["yes", "2", "ONLY"]) {
      const res = await api.call(listPublicEvents, { query: { upcoming: "1", recent } });
      expect(res.status, recent).toBe(400);
      expect(res.body).toMatchObject({ error: "recent must be 1, only or 0." });
    }
  });
});

describe("upcoming=1 (home page and /events)", () => {
  beforeEach(async () => {
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended last week" });
    await setTimes(ended.eventId, "-7 days -3 hours", "-7 days");
    const justEnded = await publishedEvent(api, organiser, admin, { title: "Ended a minute ago" });
    await setTimes(justEnded.eventId, "-3 hours", "-1 minute");
    const inProgress = await publishedEvent(api, organiser, admin, { title: "On now" });
    await setTimes(inProgress.eventId, "-1 hour", "2 hours");
    const tonight = await publishedEvent(api, organiser, admin, { title: "Tonight" });
    await setTimes(tonight.eventId, "5 hours", "8 hours");
    const nextWeek = await publishedEvent(api, organiser, admin, { title: "Next week" });
    await setTimes(nextWeek.eventId, "7 days", "7 days 3 hours");
  });

  it("drops events that have ended, keeps ones in progress, soonest first", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1" } }))).toEqual([
      "On now",
      "Tonight",
      "Next week",
    ]);
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "true" } }))).toEqual([
      "On now",
      "Tonight",
      "Next week",
    ]);
  });

  it("without it (or with 0, false or empty), still lists every published event, past ones included", async () => {
    const all = ["Ended last week", "Ended a minute ago", "On now", "Tonight", "Next week"];
    expect(titles(await api.call(listPublicEvents))).toEqual(all);
    for (const upcoming of ["0", "false", ""]) {
      expect(titles(await api.call(listPublicEvents, { query: { upcoming } }))).toEqual(all);
    }
  });

  it("pages with the cursor through upcoming events only", async () => {
    const page1 = await api.call(listPublicEvents, { query: { upcoming: "1", limit: "2" } });
    expect(titles(page1)).toEqual(["On now", "Tonight"]);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await api.call(listPublicEvents, {
      query: { upcoming: "1", limit: "2", cursor: page1.body.nextCursor },
    });
    expect(titles(page2)).toEqual(["Next week"]);
    expect(page2.body.nextCursor).toBeUndefined();
  });

  it("combines with the other filters", async () => {
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", q: "week" } }))).toEqual(["Next week"]);
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", pricing: "free" } }))).toEqual([]);
    expect(titles(await api.call(listPublicEvents, { query: { upcoming: "1", pricing: "paid" } }))).toHaveLength(3);
  });

  it("rejects any other value with 400", async () => {
    for (const upcoming of ["yes", "2", "TRUE", "1 ", "upcoming", "-1"]) {
      const res = await api.call(listPublicEvents, { query: { upcoming } });
      expect(res.status, upcoming).toBe(400);
      expect(res.body).toMatchObject({ error: "upcoming must be 1 or 0." });
    }
  });
});

describe("CDN caching (docs/architecture.md, \"CDN windows\")", () => {
  it("shares the feed for a minute (two more stale) and an event for 15 seconds (45 more stale); browsers always revalidate", async () => {
    expect(PUBLIC_EVENTS_CACHE_CONTROL).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=120");
    expect(PUBLIC_EVENT_CACHE_CONTROL).toBe("public, max-age=0, s-maxage=15, stale-while-revalidate=45");
    const live = await publishedEvent(api, organiser, admin);

    const queries: Record<string, string>[] = [{}, { upcoming: "1" }, { upcoming: "1", limit: "50", category: "live-music" }, { q: "" }];
    for (const query of queries) {
      const res = await api.call(listPublicEvents, { query });
      expect([query, res.status, res.headers.get("cache-control")]).toEqual([query, 200, PUBLIC_EVENTS_CACHE_CONTROL]);
    }
    const one = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect([one.status, one.headers.get("cache-control")]).toEqual([200, PUBLIC_EVENT_CACHE_CONTROL]);
    // The seat page's cache-busting `seatMapVersion` (and any other unknown
    // parameter) changes only the cache key: same event, same shared header.
    const bustingQueries: Record<string, string>[] = [{ seatMapVersion: "7" }, { seatMapVersion: "x", other: "1" }];
    for (const query of bustingQueries) {
      const busted = await api.call(getPublicEventBySlug, { params: { slug: live.slug }, query });
      expect([query, busted.status, busted.headers.get("cache-control")]).toEqual([query, 200, PUBLIC_EVENT_CACHE_CONTROL]);
      expect(busted.body).toEqual(one.body);
    }
  });

  it("never shares a search: any non-empty `q` is private, no-store (a CDN hit would reveal a recent search)", async () => {
    const live = await publishedEvent(api, organiser, admin, { title: "Neon Search Night" });
    const queries: Record<string, string>[] = [
      { q: "neon" },
      { upcoming: "1", limit: "50", category: "live-music", q: "neon" },
      { upcoming: "1", q: "no such event anywhere" },
      { q: "   " },
    ];
    for (const query of queries) {
      const res = await api.call(listPublicEvents, { query });
      expect([query, res.status, res.headers.get("cache-control")]).toEqual([query, 200, "private, no-store"]);
    }
    // Still the search's results, not a different response.
    const found = await api.call(listPublicEvents, { query: { q: "neon search" } });
    expect(found.body.items.map((e: { eventId: string }) => e.eventId)).toContain(live.eventId);
  });

  it("never caches an error: a 400 or a 404 (an unpublished event, so it shows as soon as it's approved) is private, no-store", async () => {
    const draft = await draftEvent(api, organiser);
    const malformed: Record<string, string>[] = [{ category: "karaoke" }, { cursor: "x" }, { upcoming: "yes" }, { onOrAfter: "2027-02-30" }];
    for (const query of malformed) {
      const res = await api.call(listPublicEvents, { query });
      expect([query, res.status, res.headers.get("cache-control")]).toEqual([query, 400, "private, no-store"]);
    }
    for (const slug of [draft.slug, "never-existed"]) {
      const res = await api.call(getPublicEventBySlug, { params: { slug } });
      expect([slug, res.status, res.headers.get("cache-control")]).toEqual([slug, 404, "private, no-store"]);
    }
  });

  it("answers a signed-in caller exactly as an anonymous one: same body, same shared header", async () => {
    const live = await publishedEvent(api, organiser, admin);
    const member = await api.signUp();
    const callers = [undefined, member.token, organiser.token, admin.token];
    const reads = [
      (token?: string) => api.call(listPublicEvents, { query: { upcoming: "1" }, token }),
      (token?: string) => api.call(getPublicEventBySlug, { params: { slug: live.slug }, token }),
      (token?: string) =>
        api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId }, token }),
    ];
    for (const read of reads) {
      const [anonymous, ...signedIn] = await Promise.all(callers.map(read));
      expect(anonymous.status).toBe(200);
      for (const res of signedIn) {
        expect(res.body).toEqual(anonymous.body);
        expect(res.headers.get("cache-control")).toBe(anonymous.headers.get("cache-control"));
      }
    }
  });
});

describe("events with no ticket types", () => {
  // The organiser's form requires a ticket type for a Sheltüh-ticketed event.
  // Such an event can still have none: an admin moving an external event back
  // to Sheltüh ticketing (external-ticketing.test.ts), or the database
  // function itself, as here.
  async function withoutTicketTypes(title: string) {
    const event = await publishedEvent(api, organiser, admin, {
      title,
      ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 30 }],
    });
    await api.db.query(`select private.replace_ticket_types($1, '[]'::jsonb)`, [event.eventId]);
    return event;
  }

  const isFree = async (eventId: string) =>
    (await api.db.query<{ is_free: boolean }>(`select is_free from public.events where id = $1`, [eventId]))[0].is_free;

  it("are neither free nor paid, but still listed with an empty ticket list", async () => {
    const bare = await withoutTicketTypes("No tickets yet");
    await publishedEvent(api, organiser, admin, { title: "Paid gig" });
    const free = await publishedEvent(api, organiser, admin, {
      title: "Free gig",
      ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 30 }],
    });

    expect(await isFree(bare.eventId)).toBe(false);
    expect(await isFree(free.eventId)).toBe(true);
    expect(titles(await api.call(listPublicEvents, { query: { pricing: "free" } }))).toEqual(["Free gig"]);
    expect(titles(await api.call(listPublicEvents, { query: { pricing: "paid" } }))).toEqual(["Paid gig"]);

    const listed = (await api.call(listPublicEvents)).body.items.find((e: { title: string }) => e.title === "No tickets yet");
    expect(listed.ticketTypes).toEqual([]);
    const page = await api.call(getPublicEventBySlug, { params: { slug: bare.slug } });
    expect(page.status).toBe(200);
    expect(page.body.ticketTypes).toEqual([]);
  });

  it("is_free follows the ticket types as they're replaced: none, all free, some paid", async () => {
    const event = await withoutTicketTypes("Changing");
    const set = (types: unknown[]) =>
      api.db.query(`select private.replace_ticket_types($1, $2::text::jsonb)`, [event.eventId, JSON.stringify(types)]);
    const freeType = { id: "f", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 };
    const paidType = { id: "p", name: "Paid", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 5 };

    await set([freeType]);
    expect(await isFree(event.eventId)).toBe(true);
    // A published event's new paid ticket type needs the organiser's payouts.
    await setUpPayouts(api, event.organiserId);
    await set([freeType, paidType]);
    expect(await isFree(event.eventId)).toBe(false);
    await set([]);
    expect(await isFree(event.eventId)).toBe(false);
  });
});
