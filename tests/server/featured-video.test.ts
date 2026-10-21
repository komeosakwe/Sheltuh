import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  featuredVideoEmbedUrl,
  featuredVideoPageUrl,
  parseFeaturedVideoUrl,
} from "@/lib/api/featured-video";
import { adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { adminListOrganisers, adminRemoveFeaturedVideo } from "@/lib/server/handlers/admin";
import { applyAsOrganiser, getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The organiser's featured video: lib/api/featured-video.ts, docs/architecture.md
// ("Organiser profiles"), supabase/migrations/20261024000200_organiser_follows.sql.

const YT = "dQw4w9WgXcQ";

describe("parseFeaturedVideoUrl", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, "youtube", YT],
    [`https://youtube.com/watch?v=${YT}&t=42s&si=abc`, "youtube", YT],
    [`https://m.youtube.com/watch?feature=share&v=${YT}`, "youtube", YT],
    [`http://www.youtube.com/watch?v=${YT}`, "youtube", YT],
    [`www.youtube.com/watch?v=${YT}`, "youtube", YT],
    [`  https://youtu.be/${YT}?si=Xy1  `, "youtube", YT],
    [`https://youtu.be/${YT}/`, "youtube", YT],
    [`https://www.youtube.com/shorts/${YT}?feature=share`, "youtube", YT],
    [`https://YOUTUBE.com/watch?v=${YT}`, "youtube", YT],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://www.vimeo.com/76979871?share=copy", "vimeo", "76979871"],
    ["vimeo.com/1", "vimeo", "1"],
  ])("accepts %s", (url, provider, id) => {
    expect(parseFeaturedVideoUrl(url)).toEqual({ provider, id });
  });

  it.each([
    ["an empty string", ""],
    ["a bare id", YT],
    ["another site", `https://example.com/watch?v=${YT}`],
    ["a look-alike host", `https://youtube.com.evil.example/watch?v=${YT}`],
    ["a youtube subdomain we don't take", `https://music.youtube.com/watch?v=${YT}`],
    ["the embed URL", `https://www.youtube.com/embed/${YT}`],
    ["the no-cookie embed", `https://www.youtube-nocookie.com/embed/${YT}`],
    ["a playlist", "https://www.youtube.com/playlist?list=PL123"],
    ["a channel", "https://www.youtube.com/@sheltuh"],
    ["a watch URL with no id", "https://www.youtube.com/watch"],
    ["an id too short", "https://www.youtube.com/watch?v=dQw4w9WgXc"],
    ["an id too long", "https://youtu.be/dQw4w9WgXcQQ"],
    ["an id with bad characters", "https://youtu.be/dQw4w9W$XcQ"],
    ["two v parameters", `https://www.youtube.com/watch?v=${YT}&v=${YT}`],
    ["an extra path segment", `https://youtu.be/${YT}/extra`],
    ["shorts with extra segments", `https://www.youtube.com/shorts/${YT}/x`],
    ["a private Vimeo link (hash)", "https://vimeo.com/76979871/abcdef1234"],
    ["the Vimeo player URL", "https://player.vimeo.com/video/76979871"],
    ["a Vimeo channel", "https://vimeo.com/channels/staffpicks"],
    ["a Vimeo id too long", "https://vimeo.com/1234567890123"],
    ["a username", `https://user@youtube.com/watch?v=${YT}`],
    ["credentials", `https://youtube.com:pw@evil.example/watch?v=${YT}`],
    ["a port", `https://youtube.com:8443/watch?v=${YT}`],
    ["javascript:", `javascript:alert(1)//youtube.com/watch?v=${YT}`],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["ftp", `ftp://youtube.com/watch?v=${YT}`],
    ["a space inside", `https://youtu.be/ ${YT}`],
    ["a zero-width space", `https://you​tu.be/${YT}`],
    ["a backslash", `https://youtu.be\\${YT}`],
    ["a punycode look-alike", `https://xn--yutube-wqf.com/watch?v=${YT}`],
    ["something huge", `https://youtu.be/${YT}?${"a".repeat(3000)}`],
  ])("refuses %s", (_name, url) => {
    expect(parseFeaturedVideoUrl(url)).toBeNull();
  });

  it("builds the privacy-enhanced player and the page link from provider and id only", () => {
    expect(featuredVideoEmbedUrl({ provider: "youtube", id: YT })).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1&rel=0`,
    );
    expect(featuredVideoEmbedUrl({ provider: "vimeo", id: "76979871" })).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&autoplay=1",
    );
    expect(featuredVideoPageUrl({ provider: "vimeo", id: "76979871" })).toBe("https://vimeo.com/76979871");
  });
});

describe("featured video on organiser profiles", () => {
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

  const patchMe = (token: string, body: unknown) => api.call(resubmitOrganiser, { token, body, method: "PATCH" });
  const publicProfile = (organiserId: string) => api.call(getPublicOrganiserProfile, { params: { organiserId } });
  async function adminRecord(organiserId: string) {
    const res = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    return res.body.items.find((o: { organiserId: string }) => o.organiserId === organiserId);
  }

  it("is part of the application (reviewed), stored as provider and id only, and public once approved", async () => {
    const organiser = await approvedOrganiser(api, admin, { featuredVideoUrl: `https://youtu.be/${YT}?si=tracking` });
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.featuredVideo).toEqual({
      provider: "youtube",
      id: YT,
    });
    const [row] = await api.db.query<Record<string, unknown>>(
      `select featured_video_provider, featured_video_id from public.organisers where id = $1`,
      [organiser.organiserId],
    );
    expect(row).toEqual({ featured_video_provider: "youtube", featured_video_id: YT });
    expect((await publicProfile(organiser.organiserId)).body.featuredVideo).toEqual({ provider: "youtube", id: YT });
  });

  it("an invalid link is a 400 on apply, resubmit and edit", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, featuredVideoUrl: "https://example.com/video" },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["featuredVideoUrl"]);

    const organiser = await approvedOrganiser(api, admin);
    const edited = await patchMe(organiser.token, { featuredVideoUrl: "https://vimeo.com/123/abc" });
    expect(edited.status).toBe(400);
    expect(Object.keys(edited.body.fieldErrors)).toEqual(["featuredVideoUrl"]);
    expect(edited.body.featuredVideo).toBeUndefined();
  });

  it("an approved organiser edits it without review; each change is logged; null removes it", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const set = await patchMe(organiser.token, { featuredVideoUrl: "https://vimeo.com/76979871" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ status: "approved", featuredVideo: { provider: "vimeo", id: "76979871" } });
    // The same video again is a no-op (nothing logged).
    await patchMe(organiser.token, { featuredVideoUrl: "https://www.vimeo.com/76979871" });
    const removed = await patchMe(organiser.token, { featuredVideoUrl: null });
    expect(removed.body.featuredVideo).toBeUndefined();
    expect((await publicProfile(organiser.organiserId)).body.featuredVideo).toBeNull();

    const record = await adminRecord(organiser.organiserId);
    expect(record.recentEdits.map((e: { changes: unknown }) => e.changes)).toEqual([
      { featuredVideo: { old: "vimeo:76979871", new: null } },
      { featuredVideo: { old: null, new: "vimeo:76979871" } },
    ]);
    expect(record.recentEdits.every((e: { byStaff?: boolean }) => e.byStaff === undefined)).toBe(true);
  });

  it("a rejected applicant's resubmission keeps the video unless it's sent", async () => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, featuredVideoUrl: `https://www.youtube.com/shorts/${YT}` },
    });
    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [applied.body.organiserId]);
    const kept = await patchMe(user.token, application);
    expect(kept.body.featuredVideo).toEqual({ provider: "youtube", id: YT });
    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [applied.body.organiserId]);
    const cleared = await patchMe(user.token, { ...application, featuredVideoUrl: "" });
    expect(cleared.body.featuredVideo).toBeUndefined();
  });

  it("admins remove it with a reason, logged as the Sheltüh team's edit; nothing to remove is a no-op", async () => {
    const organiser = await approvedOrganiser(api, admin, { featuredVideoUrl: `https://youtu.be/${YT}` });
    const remove = (token: string, body: unknown) =>
      api.call(adminRemoveFeaturedVideo, { token, params: { organiserId: organiser.organiserId }, body });

    expect((await remove(organiser.token, { reason: "x" })).status).toBe(403);
    expect((await remove(admin.token, {})).status).toBe(400);

    const res = await remove(admin.token, { reason: "Not their video" });
    expect(res.status).toBe(200);
    expect(res.body.featuredVideo).toBeUndefined();
    expect(res.body.recentEdits[0]).toEqual({
      kind: "profile_edit",
      at: expect.any(String),
      changes: { featuredVideo: { old: `youtube:${YT}`, new: null } },
      reason: "Not their video",
      byStaff: true,
    });
    expect((await publicProfile(organiser.organiserId)).body.featuredVideo).toBeNull();

    const again = await remove(admin.token, { reason: "Again" });
    expect(again.body.recentEdits).toHaveLength(1);
    expect(
      (await api.call(adminRemoveFeaturedVideo, {
        token: admin.token,
        params: { organiserId: crypto.randomUUID() },
        body: { reason: "x" },
      })).status,
    ).toBe(404);
  });

  it("admins can give a platform-managed organiser one", async () => {
    const res = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, contactEmail: "events@sheltuh.com.au", featuredVideoUrl: "https://vimeo.com/42" },
    });
    expect(res.status).toBe(201);
    expect(res.body.featuredVideo).toEqual({ provider: "vimeo", id: "42" });
  });

  it("the database refuses a malformed video whatever the API does", async () => {
    const organiser = await approvedOrganiser(api, admin);
    for (const [provider, id] of [
      ["youtube", "short"],
      ["youtube", null],
      [null, YT],
      ["vimeo", "12ab"],
      ["dailymotion", "x7tgad0"],
    ]) {
      await expect(
        api.db.query(`update public.organisers set featured_video_provider = $2, featured_video_id = $3 where id = $1`, [
          organiser.organiserId,
          provider,
          id,
        ]),
      ).rejects.toThrow(/check constraint|violates/i);
    }
  });
});
