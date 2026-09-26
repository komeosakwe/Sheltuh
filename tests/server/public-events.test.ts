import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminRejectEvent } from "@/lib/server/handlers/admin";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
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
      ].sort(),
    );
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
