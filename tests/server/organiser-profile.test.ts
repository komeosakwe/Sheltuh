import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import { adminRejectEvent, adminRejectOrganiser, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { applyAsOrganiser, getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile, PROFILE_EVENT_LIMIT } from "@/lib/server/handlers/public-organisers";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
});

const socials = {
  instagramHandle: "  @static.collective ",
  tiktokHandle: "@static_collective",
  facebookPage: "StaticCollective",
  xHandle: "@static_mel",
};

const PUBLIC_EVENT_KEYS = [
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
].sort();

function profile(organiserId: string) {
  return api.call(getPublicOrganiserProfile, { params: { organiserId } });
}

function patchMe(token: string, body: unknown) {
  return api.call(resubmitOrganiser, { token, body, method: "PATCH" });
}

/** Moves a published event into the past (it ended yesterday). */
async function endInPast(eventId: string, daysAgo = 1) {
  await api.db.query(
    `update public.events set starts_at = now() - make_interval(days => $2::int, hours => 3),
                              ends_at = now() - make_interval(days => $2::int)
      where id = $1`,
    [eventId, daysAgo],
  );
}

describe("social handles on an application", () => {
  it("stores handles trimmed and without a leading '@', and returns them on the owner's record", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, ...socials } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      instagramHandle: "static.collective",
      tiktokHandle: "static_collective",
      facebookPage: "StaticCollective",
      xHandle: "static_mel",
    });
    const mine = await api.call(getMyOrganiser, { token: user.token });
    expect(mine.body.instagramHandle).toBe("static.collective");
    expect(mine.body.xHandle).toBe("static_mel");
  });

  it("leaves handles unset when they're not sent, or blank", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, instagramHandle: "   ", xHandle: null },
    });
    expect(res.status).toBe(201);
    for (const key of ["instagramHandle", "tiktokHandle", "facebookPage", "xHandle"]) {
      expect(res.body[key]).toBeUndefined();
    }
  });

  it.each([
    ["instagramHandle", "https://instagram.com/static"],
    ["instagramHandle", "a".repeat(31)],
    ["instagramHandle", "bad handle"],
    ["instagramHandle", "..."],
    ["instagramHandle", "@"],
    ["instagramHandle", "@@static"],
    ["tiktokHandle", "static-collective"],
    ["tiktokHandle", "<script>"],
    ["facebookPage", "abcd"],
    ["facebookPage", "static_collective"],
    ["facebookPage", "a".repeat(51)],
    ["xHandle", "a".repeat(16)],
    ["xHandle", "static.mel"],
    ["xHandle", "javascript:alert(1)"],
    ["xHandle", 42],
    ["xHandle", ["static"]],
  ])("rejects %s %j with a field error", async (field, value) => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, [field]: value } });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    expect((await api.call(getMyOrganiser, { token: user.token })).status).toBe(404);
  });

  it("accepts handles at the edges of each rule", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: {
        ...application,
        instagramHandle: "a".repeat(30),
        tiktokHandle: "x",
        facebookPage: "ab.cd",
        xHandle: "_".repeat(14) + "a",
      },
    });
    expect(res.status).toBe(201);
  });

  it("only accepts http(s) website URLs, trimmed", async () => {
    for (const websiteUrl of ["javascript:alert(1)", " javascript:alert(1)", "data:text/html,hi", "http:example.com", "//example.com", `https://example.com/${"a".repeat(2048)}`]) {
      const user = await api.signUp();
      const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, websiteUrl } });
      expect(res.status, websiteUrl).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["websiteUrl"]);
    }
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, websiteUrl: "  HTTPS://static.example/about  " },
    });
    expect(res.status).toBe(201);
    expect(res.body.websiteUrl).toBe("HTTPS://static.example/about");
  });
});

describe("database constraints", () => {
  async function insertOrganiser(db: Db, column: string, value: string) {
    return db.query(
      `insert into public.organisers (display_name, contact_email, description, categories, ${column})
       values ('X', 'x@example.com', 'd', '{art}', $1)`,
      [value],
    );
  }

  it.each([
    ["instagram_handle", "@static"],
    ["instagram_handle", "a".repeat(31)],
    ["instagram_handle", "..."],
    ["tiktok_handle", "has space"],
    ["facebook_page", "abcd"],
    ["x_handle", "a".repeat(16)],
    ["x_handle", "a\nb"],
    ["website_url", "javascript:alert(1)"],
    ["website_url", `https://example.com/${"a".repeat(2048)}`],
  ])("refuses %s = %j whatever the API does", async (column, value) => {
    await expect(insertOrganiser(api.db, column, value)).rejects.toThrow(/check constraint|violates/i);
  });

  it("accepts valid values", async () => {
    await insertOrganiser(api.db, "instagram_handle", "static.collective");
    await insertOrganiser(api.db, "website_url", "https://static.example");
  });
});

describe("PATCH /organisers/me by an approved organiser", () => {
  it("edits the profile without a new review", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const before = (await api.call(getMyOrganiser, { token: organiser.token })).body;

    const res = await patchMe(organiser.token, {
      description: "  New bio.  ",
      websiteUrl: "https://new.example",
      ...socials,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "approved",
      description: "New bio.",
      websiteUrl: "https://new.example",
      instagramHandle: "static.collective",
      tiktokHandle: "static_collective",
      facebookPage: "StaticCollective",
      xHandle: "static_mel",
      displayName: application.displayName,
      contactEmail: application.contactEmail,
      reviewedAt: before.reviewedAt,
    });
    expect(res.body.reviewedBy).toBeUndefined();

    const [row] = await api.db.query<{ status: string; reviewed_by: string }>(
      `select status::text as status, reviewed_by from public.organisers where id = $1`,
      [organiser.organiserId],
    );
    expect(row).toEqual({ status: "approved", reviewed_by: admin.userId });
  });

  it("changes only the fields sent; null or blank clears a handle or the website", async () => {
    const organiser = await approvedOrganiser(api, admin, socials);

    const partial = await patchMe(organiser.token, { xHandle: "@renamed" });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      xHandle: "renamed",
      instagramHandle: "static.collective",
      description: application.description,
      websiteUrl: application.websiteUrl,
    });

    const cleared = await patchMe(organiser.token, { instagramHandle: null, tiktokHandle: "", websiteUrl: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.instagramHandle).toBeUndefined();
    expect(cleared.body.tiktokHandle).toBeUndefined();
    expect(cleared.body.websiteUrl).toBeUndefined();
    expect(cleared.body).toMatchObject({ xHandle: "renamed", facebookPage: "StaticCollective" });

    // An empty edit is a no-op.
    const noop = await patchMe(organiser.token, {});
    expect(noop.status).toBe(200);
    expect(noop.body).toMatchObject({ xHandle: "renamed", status: "approved" });
  });

  it("rejects invalid fields without changing anything", async () => {
    const organiser = await approvedOrganiser(api, admin, socials);
    const res = await patchMe(organiser.token, {
      description: " ",
      websiteUrl: "javascript:alert(1)",
      xHandle: "far_too_long_for_x",
      instagramHandle: "fine",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["description", "websiteUrl", "xHandle"]);
    const mine = (await api.call(getMyOrganiser, { token: organiser.token })).body;
    expect(mine).toMatchObject({ instagramHandle: "static.collective", xHandle: "static_mel", description: application.description });
  });

  it("can send the reviewed fields back unchanged, but not change them", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const same = await patchMe(organiser.token, {
      displayName: application.displayName,
      contactEmail: application.contactEmail,
      categories: application.categories,
      description: "Updated.",
    });
    expect(same.status).toBe(200);
    expect(same.body.description).toBe("Updated.");

    const changed = await patchMe(organiser.token, {
      displayName: "Someone Else",
      contactEmail: "other@example.com",
      categories: ["art"],
      description: "Sneaky.",
    });
    expect(changed.status).toBe(400);
    expect(Object.keys(changed.body.fieldErrors).sort()).toEqual(["categories", "contactEmail", "displayName"]);
    const mine = (await api.call(getMyOrganiser, { token: organiser.token })).body;
    expect(mine).toMatchObject({ displayName: application.displayName, description: "Updated.", status: "approved" });
  });

  it("only ever edits the caller's own organiser", async () => {
    const first = await approvedOrganiser(api, admin, socials);
    const second = await approvedOrganiser(api, admin, { displayName: "Second" });

    // Ownership comes from the token: there's no way to name another organiser.
    const res = await patchMe(second.token, { organiserId: first.organiserId, xHandle: "hijacked", description: "Mine" });
    expect(res.status).toBe(200);
    expect(res.body.organiserId).toBe(second.organiserId);

    const firstNow = (await api.call(getMyOrganiser, { token: first.token })).body;
    expect(firstNow).toMatchObject({ xHandle: "static_mel", description: application.description });

    const stranger = await api.signUp();
    expect((await patchMe(stranger.token, { xHandle: "hijacked" })).status).toBe(404);
    expect((await patchMe("forged", { xHandle: "hijacked" })).status).toBe(401);
    expect((await api.call(resubmitOrganiser, { body: { xHandle: "hijacked" }, method: "PATCH" })).status).toBe(401);
  });
});

describe("PATCH /organisers/me before approval", () => {
  it("a pending application can't be edited", async () => {
    const user = await api.signUp();
    await api.call(applyAsOrganiser, { token: user.token, body: application });
    const res = await patchMe(user.token, { xHandle: "static_mel" });
    expect(res.status).toBe(409);
    expect((await api.call(getMyOrganiser, { token: user.token })).body.xHandle).toBeUndefined();
  });

  it("a rejected application is resubmitted in full, keeping handles it doesn't send", async () => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, ...socials } });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      body: { reason: "Need more detail" },
    });

    // A profile-style partial edit isn't a resubmission.
    const partial = await patchMe(user.token, { xHandle: "new_x" });
    expect(partial.status).toBe(400);

    const res = await patchMe(user.token, { ...application, xHandle: "@new_x", facebookPage: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "pending", xHandle: "new_x", instagramHandle: "static.collective" });
    expect(res.body.facebookPage).toBeUndefined();
    expect(res.body.rejectionReason).toBeUndefined();

    const bad = await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      body: { reason: "Again" },
    });
    expect(bad.status).toBe(200);
    const invalid = await patchMe(user.token, { ...application, tiktokHandle: "no spaces allowed" });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.fieldErrors)).toEqual(["tiktokHandle"]);
    expect((await api.call(getMyOrganiser, { token: user.token })).body.status).toBe("rejected");
  });
});

describe("GET /organisers/{organiserId}/profile", () => {
  it("returns exactly the public fields of an approved organiser", async () => {
    const organiser = await approvedOrganiser(api, admin, socials);
    await api.db.query(`update public.organisers set stripe_account_id = 'acct_secret_1', payouts_enabled = true where id = $1`, [
      organiser.organiserId,
    ]);

    const res = await profile(organiser.organiserId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "categories",
      "description",
      "displayName",
      "eventsHosted",
      "featuredVideo",
      "followerCount",
      "memberSince",
      "organiserId",
      "recentEvents",
      "socialLinks",
      "upcomingEvents",
      "websiteUrl",
    ]);
    expect(res.body).toMatchObject({
      featuredVideo: null,
      followerCount: null,
      eventsHosted: 0,
      organiserId: organiser.organiserId,
      displayName: application.displayName,
      description: application.description,
      categories: application.categories,
      websiteUrl: application.websiteUrl,
      upcomingEvents: [],
      recentEvents: [],
    });
    expect(res.body.socialLinks).toEqual({
      instagram: "https://www.instagram.com/static.collective/",
      tiktok: "https://www.tiktok.com/@static_collective",
      facebook: "https://www.facebook.com/StaticCollective",
      x: "https://x.com/static_mel",
    });
    expect(res.body.memberSince).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    const [{ month }] = await api.db.query<{ month: string }>(
      `select to_char(created_at at time zone 'Australia/Melbourne', 'YYYY-MM') as month from public.organisers where id = $1`,
      [organiser.organiserId],
    );
    expect(res.body.memberSince).toBe(month);

    // Nothing private anywhere in the response.
    const text = JSON.stringify(res.body);
    for (const secret of [application.contactEmail, organiser.userId, admin.userId, "acct_secret_1", "payouts", "status"]) {
      expect(text).not.toContain(secret);
    }
    // Public, like the event routes: not marked private.
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("leaves out the website and social links the organiser hasn't set", async () => {
    const organiser = await approvedOrganiser(api, admin, { websiteUrl: undefined, xHandle: "only_x" });
    const res = await profile(organiser.organiserId);
    expect(res.body.websiteUrl).toBeUndefined();
    expect(res.body.socialLinks).toEqual({ x: "https://x.com/only_x" });
  });

  it("is a 404 for pending, rejected and unknown organisers", async () => {
    const pendingUser = await api.signUp();
    const pending = await api.call(applyAsOrganiser, { token: pendingUser.token, body: application });
    const rejectedUser = await api.signUp();
    const rejected = await api.call(applyAsOrganiser, { token: rejectedUser.token, body: application });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: rejected.body.organiserId },
      body: { reason: "No" },
    });

    for (const organiserId of [pending.body.organiserId, rejected.body.organiserId, crypto.randomUUID()]) {
      const res = await profile(organiserId);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Organiser not found." });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("is a 404 for an id that isn't a uuid, without touching the database", async () => {
    let queries = 0;
    const counting = new TestApi({
      query: async (text, params) => {
        queries += 1;
        return api.db.query(text, params);
      },
    });
    for (const organiserId of ["me", "not-a-uuid", "1 or 1=1", ""]) {
      const res = await counting.call(getPublicOrganiserProfile, { params: { organiserId } });
      expect(res.status).toBe(404);
    }
    expect(queries).toBe(0);
  });

  it("lists only the organiser's published events, in the public event shape", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const other = await approvedOrganiser(api, admin, { displayName: "Other Org" });

    await draftEvent(api, organiser, { title: "Draft" });
    const pending = await draftEvent(api, organiser, { title: "Pending" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const rejected = await draftEvent(api, organiser, { title: "Rejected" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: rejected.eventId }, body: { reason: "x" } });
    const unpublished = await publishedEvent(api, organiser, admin, { title: "Unpublished" });
    await api.call(adminUnpublishEvent, {
      token: admin.token,
      params: { eventId: unpublished.eventId },
      body: { reason: "x" },
    });
    await publishedEvent(api, other, admin, { title: "Someone else's" });
    const live = await publishedEvent(api, organiser, admin, { title: "Live" });

    const res = await profile(organiser.organiserId);
    expect(res.status).toBe(200);
    expect(res.body.upcomingEvents.map((e: { title: string }) => e.title)).toEqual(["Live"]);
    expect(res.body.recentEvents).toEqual([]);

    const [event] = res.body.upcomingEvents;
    expect(Object.keys(event).sort()).toEqual(PUBLIC_EVENT_KEYS);
    // The same shape, field for field, as the public event route.
    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect(event).toEqual(bySlug.body);
  });

  it("puts upcoming events first (soonest first), then past ones (most recent first)", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const later = await publishedEvent(api, organiser, admin, {
      title: "Later",
      start: { date: "2027-05-01", time: "20:00" },
      end: { date: "2027-05-01", time: "23:00" },
    });
    const sooner = await publishedEvent(api, organiser, admin, {
      title: "Sooner",
      start: { date: "2027-04-01", time: "20:00" },
      end: { date: "2027-04-01", time: "23:00" },
    });
    const lastWeek = await publishedEvent(api, organiser, admin, { title: "Last week" });
    const lastMonth = await publishedEvent(api, organiser, admin, { title: "Last month" });
    await endInPast(lastWeek.eventId, 7);
    await endInPast(lastMonth.eventId, 30);

    const res = await profile(organiser.organiserId);
    expect(res.body.upcomingEvents.map((e: { eventId: string }) => e.eventId)).toEqual([sooner.eventId, later.eventId]);
    expect(res.body.recentEvents.map((e: { eventId: string }) => e.eventId)).toEqual([lastWeek.eventId, lastMonth.eventId]);
  });

  it(`lists at most ${PROFILE_EVENT_LIMIT} events, upcoming ones first`, async () => {
    const organiser = await approvedOrganiser(api, admin);
    // Straight into the database: going through review 26 times adds nothing here.
    const insertEvents = (count: number, past: boolean, prefix: string) =>
      api.db.query(
        `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                    starts_at, ends_at, status)
         select $1, $4 || '-' || g, $4 || ' ' || g, 'd', 'art', 'v', 'a', 's',
                now() + make_interval(days => case when $3 then -g else g end),
                now() + make_interval(days => case when $3 then -g else g end, hours => 2),
                'published'
           from generate_series(1, $2::int) g`,
        [organiser.organiserId, count, past, prefix],
      );

    await insertEvents(20, false, "up");
    await insertEvents(10, true, "past");
    let res = await profile(organiser.organiserId);
    expect(res.body.upcomingEvents).toHaveLength(20);
    expect(res.body.recentEvents).toHaveLength(PROFILE_EVENT_LIMIT - 20);
    expect(res.body.recentEvents[0].title).toBe("past 1");

    await insertEvents(10, false, "more");
    res = await profile(organiser.organiserId);
    expect(res.body.upcomingEvents).toHaveLength(PROFILE_EVENT_LIMIT);
    expect(res.body.recentEvents).toEqual([]);
  });

  it("the public event routes carry the organiserId and name that link to the profile", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const live = await publishedEvent(api, organiser, admin);
    const event = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect(event.body).toMatchObject({ organiserId: organiser.organiserId, organiserName: application.displayName });

    const res = await profile(event.body.organiserId);
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe(event.body.organiserName);
  });
});
