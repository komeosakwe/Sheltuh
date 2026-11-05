import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORGANISER_BIO_EXCERPT_LENGTH } from "@/lib/api/public-events";
import type { Db } from "@/lib/server/db";
import { adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { adminListOrganisers, adminRejectOrganiser } from "@/lib/server/handlers/admin";
import { acceptInvite, adminCreateInvite } from "@/lib/server/handlers/invites";
import { applyAsOrganiser, getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { socialLinks } from "@/lib/server/organiser-input";
import { bioExcerpt } from "@/lib/server/records";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Spotify, SoundCloud, YouTube and LinkedIn links on an organiser, and the
// Host card's extras on the single-event route:
// supabase/migrations/20261121000000_organiser_more_socials.sql,
// lib/api/social-profiles.ts, lib/server/organiser-input.ts.

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

const ARTIST = "4Z8W4fKeB5YxbusRsdQVPb";
const SHOW = "5CfCWKI5pZ28U0uOzXkDHe";
const CHANNEL = "UCabcdefghijklmnopqrstuv";

/** Stored values and the links the server builds from them. */
const stored = {
  spotifyPath: `artist/${ARTIST}`,
  soundcloudHandle: "static-collective",
  youtubeChannel: "@staticcollective",
  linkedinPath: "company/static-collective",
};
const links = {
  spotify: `https://open.spotify.com/artist/${ARTIST}`,
  soundcloud: "https://soundcloud.com/static-collective",
  youtube: "https://www.youtube.com/@staticcollective",
  linkedin: "https://www.linkedin.com/company/static-collective",
};

const patchMe = (token: string, body: unknown) => api.call(resubmitOrganiser, { token, body, method: "PATCH" });
const profile = (organiserId: string) => api.call(getPublicOrganiserProfile, { params: { organiserId } });
const bySlug = (slug: string) => api.call(getPublicEventBySlug, { params: { slug } });

describe("what each field accepts (an application)", () => {
  // [field, what was typed or pasted, what is stored]
  it.each([
    ["spotifyPath", `artist/${ARTIST}`, `artist/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com/artist/${ARTIST}?si=abc123`, `artist/${ARTIST}`],
    ["spotifyPath", `  http://open.spotify.com/intl-au/artist/${ARTIST}/  `, `artist/${ARTIST}`],
    ["spotifyPath", `open.spotify.com/show/${SHOW}#top`, `show/${SHOW}`],
    ["spotifyPath", `https://open.spotify.com/user/static.collective_1`, `user/static.collective_1`],
    ["spotifyPath", `spotify:artist:${ARTIST}`, `artist/${ARTIST}`],
    ["spotifyPath", `Artist/${ARTIST}`, `artist/${ARTIST}`],
    ["soundcloudHandle", "static-collective", "static-collective"],
    ["soundcloudHandle", "@static_collective", "static_collective"],
    ["soundcloudHandle", "https://soundcloud.com/static-collective?utm_source=x", "static-collective"],
    ["soundcloudHandle", "https://m.soundcloud.com/static-collective/", "static-collective"],
    ["soundcloudHandle", "soundcloud.com/static-collective/tracks", "static-collective"],
    ["youtubeChannel", "@staticcollective", "@staticcollective"],
    ["youtubeChannel", "staticcollective", "@staticcollective"],
    ["youtubeChannel", "https://www.youtube.com/@static.collective/videos", "@static.collective"],
    ["youtubeChannel", "https://m.youtube.com/@staticcollective?si=1", "@staticcollective"],
    ["youtubeChannel", `https://www.youtube.com/channel/${CHANNEL}`, `channel/${CHANNEL}`],
    ["youtubeChannel", `channel/${CHANNEL}`, `channel/${CHANNEL}`],
    ["linkedinPath", "company/static-collective", "company/static-collective"],
    ["linkedinPath", "https://www.linkedin.com/company/static-collective/about/", "company/static-collective"],
    ["linkedinPath", "https://au.linkedin.com/in/kome-osakwe-1a2b3c?trk=public", "in/kome-osakwe-1a2b3c"],
    ["linkedinPath", "linkedin.com/in/kome-osakwe", "in/kome-osakwe"],
  ])("%s: %j is stored as %j", async (field, input, expected) => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, [field]: input } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body[field]).toBe(expected);
    const mine = await api.call(getMyOrganiser, { token: user.token });
    expect(mine.body[field]).toBe(expected);
  });

  it.each([
    // Not the right site, or not a profile on it.
    ["spotifyPath", `https://evil.example/artist/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com.evil.example/artist/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com@evil.example/artist/${ARTIST}`],
    ["spotifyPath", `https://user:pw@open.spotify.com/artist/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com:8443/artist/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com/track/${ARTIST}`],
    ["spotifyPath", `https://open.spotify.com/playlist/${ARTIST}`],
    ["spotifyPath", "https://open.spotify.com/"],
    ["spotifyPath", "https://spotify.link/abc123"],
    ["spotifyPath", `javascript:alert(1)//open.spotify.com/artist/${ARTIST}`],
    ["spotifyPath", `ftp://open.spotify.com/artist/${ARTIST}`],
    // Bad ids.
    ["spotifyPath", `artist/${ARTIST}x`],
    ["spotifyPath", `artist/${ARTIST.slice(1)}`],
    ["spotifyPath", `artist/${"!".repeat(22)}`],
    ["spotifyPath", "artist/"],
    ["spotifyPath", ARTIST],
    ["spotifyPath", "user/.."],
    ["spotifyPath", "user/."],
    ["spotifyPath", `user/${"a".repeat(65)}`],
    ["spotifyPath", `https://open.spotify.com/user/%2e%2e`],
    ["spotifyPath", `artist/${ARTIST}\nartist/${ARTIST}`],
    ["spotifyPath", `artist/${ARTIST} extra`],
    ["spotifyPath", 42],
    ["soundcloudHandle", "has space"],
    ["soundcloudHandle", "dots.not.allowed"],
    ["soundcloudHandle", "a".repeat(41)],
    ["soundcloudHandle", "---"],
    ["soundcloudHandle", "@@name"],
    ["soundcloudHandle", "discover"],
    ["soundcloudHandle", "https://soundcloud.com/discover"],
    ["soundcloudHandle", "https://soundcloud.com/"],
    ["soundcloudHandle", "https://on.soundcloud.com/abc"],
    ["soundcloudHandle", "https://evil.example/static"],
    ["soundcloudHandle", "https://soundcloud.com@evil.example/static"],
    ["soundcloudHandle", "<script>"],
    ["youtubeChannel", "ab"],
    ["youtubeChannel", "a".repeat(31)],
    ["youtubeChannel", "has space"],
    ["youtubeChannel", "@@staticcollective"],
    ["youtubeChannel", "https://www.youtube.com/c/staticcollective"],
    ["youtubeChannel", "https://www.youtube.com/user/staticcollective"],
    ["youtubeChannel", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["youtubeChannel", "https://youtu.be/dQw4w9WgXcQ"],
    ["youtubeChannel", "https://www.youtube.com/channel/UCshort"],
    ["youtubeChannel", `https://www.youtube.com/channel/XX${CHANNEL.slice(2)}`],
    ["youtubeChannel", "https://www.youtube.com.evil.example/@staticcollective"],
    ["youtubeChannel", "https://evil.example/@staticcollective"],
    ["youtubeChannel", "@static/../x"],
    ["linkedinPath", "static-collective"],
    ["linkedinPath", "company/ab"],
    ["linkedinPath", `company/${"a".repeat(101)}`],
    ["linkedinPath", "pub/someone/1/2/3"],
    ["linkedinPath", "school/some-school"],
    ["linkedinPath", "company/static_collective"],
    ["linkedinPath", "company/%E2%80%AEstatic"],
    ["linkedinPath", "https://www.linkedin.com/feed/"],
    ["linkedinPath", "https://www.linkedin.com/company/"],
    ["linkedinPath", "https://www.linkedin.com.evil.example/company/static-collective"],
    ["linkedinPath", "https://evil.example/company/static-collective"],
    ["linkedinPath", "https://lnkd.in/abc"],
    ["linkedinPath", ["company/static-collective"]],
    ["linkedinPath", "in/---"],
    ["youtubeChannel", "@..."],
    ["spotifyPath", "user/.hidden"],
  ])("rejects %s %j with a field error on that field only", async (field, value) => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, [field]: value } });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    // Nothing was saved.
    expect((await api.call(getMyOrganiser, { token: user.token })).status).toBe(404);
  });

  it("leaves a field unset when it is blank, null or absent", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, spotifyPath: "  ", soundcloudHandle: null },
    });
    expect(res.status).toBe(201);
    for (const key of Object.keys(stored)) expect(res.body[key]).toBeUndefined();
  });

  it("accepts the longest values each rule allows", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: {
        ...application,
        spotifyPath: `user/${"a".repeat(64)}`,
        soundcloudHandle: "a".repeat(40),
        youtubeChannel: `@${"a".repeat(30)}`,
        linkedinPath: `in/${"a".repeat(100)}`,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("keeps the existing networks handle-only: a pasted URL is still a field error there", async () => {
    const user = await api.signUp();
    const res = await api.call(applyAsOrganiser, {
      token: user.token,
      body: { ...application, instagramHandle: "https://www.instagram.com/static/" },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["instagramHandle"]);
  });
});

describe("socialLinks (the server-built URLs)", () => {
  it("builds each https URL from a valid stored value", () => {
    expect(
      socialLinks({
        ...stored,
        instagramHandle: "static.collective",
        tiktokHandle: "static_collective",
        facebookPage: "StaticCollective",
        xHandle: "static_mel",
      }),
    ).toEqual({
      instagram: "https://www.instagram.com/static.collective/",
      tiktok: "https://www.tiktok.com/@static_collective",
      spotify: links.spotify,
      soundcloud: links.soundcloud,
      youtube: links.youtube,
      facebook: "https://www.facebook.com/StaticCollective",
      x: "https://x.com/static_mel",
      linkedin: links.linkedin,
    });
  });

  it("builds a YouTube channel-id link, and a Spotify podcast and user", () => {
    expect(socialLinks({ youtubeChannel: `channel/${CHANNEL}` }).youtube).toBe(`https://www.youtube.com/channel/${CHANNEL}`);
    expect(socialLinks({ spotifyPath: `show/${SHOW}` }).spotify).toBe(`https://open.spotify.com/show/${SHOW}`);
    expect(socialLinks({ spotifyPath: "user/someone" }).spotify).toBe("https://open.spotify.com/user/someone");
  });

  it("builds nothing from a stored value that doesn't match its pattern (never a link off the network)", () => {
    expect(
      socialLinks({
        spotifyPath: "../../evil",
        soundcloudHandle: "a/b",
        youtubeChannel: "//evil.example",
        linkedinPath: "in/a b",
      }),
    ).toEqual({});
    expect(socialLinks({ soundcloudHandle: "discover" })).toEqual({});
    expect(socialLinks({ spotifyPath: "user/.." })).toEqual({});
  });
});

describe("database constraints on the new columns", () => {
  async function insertOrganiser(db: Db, column: string, value: string) {
    return db.query(
      `insert into public.organisers (display_name, contact_email, description, categories, ${column})
       values ('X', 'x@example.com', 'd', '{art}', $1)`,
      [value],
    );
  }

  it.each([
    ["spotify_path", `https://open.spotify.com/artist/${ARTIST}`],
    ["spotify_path", ARTIST],
    ["spotify_path", `artist/${ARTIST.slice(1)}`],
    ["spotify_path", `artist/${ARTIST}0`],
    ["spotify_path", `track/${ARTIST}`],
    ["spotify_path", "user/.."],
    ["spotify_path", "user/."],
    ["spotify_path", "user/a b"],
    ["spotify_path", `artist/${ARTIST}\n`],
    ["spotify_path", ""],
    ["soundcloud_handle", "a/b"],
    ["soundcloud_handle", "a.b"],
    ["soundcloud_handle", "a".repeat(41)],
    ["soundcloud_handle", "---"],
    ["soundcloud_handle", "a\nb"],
    ["youtube_channel", "staticcollective"],
    ["youtube_channel", "@ab"],
    ["youtube_channel", `@${"a".repeat(31)}`],
    ["youtube_channel", "@a/b"],
    ["youtube_channel", "channel/UCshort"],
    ["youtube_channel", `channel/XX${CHANNEL.slice(2)}`],
    ["youtube_channel", `https://www.youtube.com/@staticcollective`],
    ["linkedin_path", "static-collective"],
    ["linkedin_path", "company/ab"],
    ["linkedin_path", "company/a_b_c"],
    ["linkedin_path", "school/abc"],
    ["linkedin_path", "in/abc/def"],
    ["linkedin_path", "https://www.linkedin.com/in/abc"],
    ["linkedin_path", "in/---"],
    ["youtube_channel", "@..."],
    ["spotify_path", "user/.a"],
  ])("refuses %s = %j whatever the API does", async (column, value) => {
    await expect(insertOrganiser(api.db, column, value)).rejects.toThrow(/check constraint|violates/i);
  });

  it.each([
    ["spotify_path", `artist/${ARTIST}`],
    ["spotify_path", `show/${SHOW}`],
    ["spotify_path", "user/some.one_1-x"],
    ["soundcloud_handle", "static-collective_1"],
    ["youtube_channel", "@static.collective"],
    ["youtube_channel", `channel/${CHANNEL}`],
    ["linkedin_path", "company/static-collective"],
    ["linkedin_path", "in/kome-osakwe-1a2b3c"],
  ])("accepts %s = %j", async (column, value) => {
    await insertOrganiser(api.db, column, value);
  });

  it("leaves the columns null by default and grants nothing to clients", async () => {
    await insertOrganiser(api.db, "instagram_handle", "x");
    const [row] = await api.db.query<Record<string, unknown>>(
      `select spotify_path, soundcloud_handle, youtube_channel, linkedin_path from public.organisers`,
    );
    expect(row).toEqual({ spotify_path: null, soundcloud_handle: null, youtube_channel: null, linkedin_path: null });
    const [grants] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'organisers'
          and column_name in ('spotify_path', 'soundcloud_handle', 'youtube_channel', 'linkedin_path')
          and grantee in ('anon', 'authenticated')`,
    );
    expect(grants.n).toBe(0);
  });
});

describe("PATCH /organisers/me by an approved organiser", () => {
  it("sets the new links (pasted or stored form), and returns them on the owner's record and the public profile", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const res = await patchMe(organiser.token, {
      spotifyPath: ` https://open.spotify.com/artist/${ARTIST}?si=x `,
      soundcloudHandle: "@static-collective",
      youtubeChannel: "https://www.youtube.com/@staticcollective/videos",
      linkedinPath: "https://www.linkedin.com/company/static-collective/",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject(stored);
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body).toMatchObject(stored);

    const pub = await profile(organiser.organiserId);
    expect(pub.body.socialLinks).toEqual(links);
  });

  it("changes only the fields sent: absent keeps the stored value, null or blank clears it", async () => {
    const organiser = await approvedOrganiser(api, admin, { ...stored });
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body).toMatchObject(stored);

    // Sending something else leaves the new links alone.
    const other = await patchMe(organiser.token, { xHandle: "static_mel", description: "New bio." });
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject(stored);

    const partial = await patchMe(organiser.token, { youtubeChannel: `channel/${CHANNEL}` });
    expect(partial.body).toMatchObject({ ...stored, youtubeChannel: `channel/${CHANNEL}` });

    const cleared = await patchMe(organiser.token, { spotifyPath: null, soundcloudHandle: "", linkedinPath: "   " });
    expect(cleared.status).toBe(200);
    expect(cleared.body.spotifyPath).toBeUndefined();
    expect(cleared.body.soundcloudHandle).toBeUndefined();
    expect(cleared.body.linkedinPath).toBeUndefined();
    expect(cleared.body.youtubeChannel).toBe(`channel/${CHANNEL}`);
    expect((await profile(organiser.organiserId)).body.socialLinks).toEqual({
      youtube: `https://www.youtube.com/channel/${CHANNEL}`,
      x: "https://x.com/static_mel",
    });
  });

  it("rejects an invalid new link without changing anything", async () => {
    const organiser = await approvedOrganiser(api, admin, { soundcloudHandle: "keepme" });
    const res = await patchMe(organiser.token, {
      soundcloudHandle: "also bad",
      spotifyPath: "https://example.com/artist/x",
      xHandle: "fine",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["soundcloudHandle", "spotifyPath"]);
    const mine = (await api.call(getMyOrganiser, { token: organiser.token })).body;
    expect(mine.soundcloudHandle).toBe("keepme");
    expect(mine.xHandle).toBeUndefined();
  });

  it("logs each change with old and new values for the admins, and a no-op edit logs nothing", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await patchMe(organiser.token, { spotifyPath: `artist/${ARTIST}`, linkedinPath: "in/kome-osakwe" });
    await patchMe(organiser.token, { spotifyPath: `https://open.spotify.com/artist/${ARTIST}` });
    await patchMe(organiser.token, { spotifyPath: null });

    const queue = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    const listed = queue.body.items.find((o: { organiserId: string }) => o.organiserId === organiser.organiserId);
    expect(listed.recentEdits.map((e: { changes: unknown }) => e.changes)).toEqual([
      { spotifyPath: { old: `artist/${ARTIST}`, new: null } },
      { spotifyPath: { old: null, new: `artist/${ARTIST}` }, linkedinPath: { old: null, new: "in/kome-osakwe" } },
    ]);
    expect(listed.linkedinPath).toBe("in/kome-osakwe");
    expect(listed.spotifyPath).toBeUndefined();
  });

  it("only edits the caller's own organiser", async () => {
    const mine = await approvedOrganiser(api, admin);
    const other = await approvedOrganiser(api, admin, { displayName: "Someone Else" });
    await patchMe(mine.token, { linkedinPath: "in/mine-only" });
    expect((await api.call(getMyOrganiser, { token: other.token })).body.linkedinPath).toBeUndefined();
  });
});

describe("a rejected application resubmitted", () => {
  it("keeps the new links it doesn't send, and replaces the ones it does", async () => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, ...stored } });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      body: { reason: "Needs more detail" },
    });
    const res = await patchMe(user.token, { ...application, spotifyPath: `show/${SHOW}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ...stored, spotifyPath: `show/${SHOW}`, status: "pending" });
  });
});

describe("other ways an organiser is created", () => {
  it("an admin's platform-managed organiser stores the new links", async () => {
    const res = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, instagramHandle: "static", ...stored },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ instagramHandle: "static", ...stored, status: "approved" });
    expect((await profile(res.body.organiserId)).body.socialLinks).toMatchObject(links);
  });

  it("an admin's platform-managed organiser refuses a bad new link", async () => {
    const res = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, linkedinPath: "https://evil.example/in/x" },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["linkedinPath"]);
  });

  it("an organiser invite carries the new links to the organiser created on accepting", async () => {
    const created = await api.call(adminCreateInvite, {
      token: admin.token,
      body: {
        kind: "organiser",
        email: "invitee@example.com",
        consent: true,
        organiser: { ...application, ...stored, spotifyPath: `https://open.spotify.com/artist/${ARTIST}` },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const [invite] = await api.db.query<{ organiser_profile: Record<string, unknown> }>(
      `select organiser_profile from private.account_invites`,
    );
    expect(invite.organiser_profile).toMatchObject({
      spotify_path: stored.spotifyPath,
      soundcloud_handle: stored.soundcloudHandle,
      youtube_channel: stored.youtubeChannel,
      linkedin_path: stored.linkedinPath,
    });

    const invitee = await api.signUp({ email: "invitee@example.com" });
    const accepted = await api.call(acceptInvite, {
      token: invitee.token,
      body: { inviteId: created.body.invite.inviteId },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await api.call(getMyOrganiser, { token: invitee.token })).body).toMatchObject(stored);
  });

  it("an invite with a bad new link is a field error and saves nothing", async () => {
    const res = await api.call(adminCreateInvite, {
      token: admin.token,
      body: {
        kind: "organiser",
        email: "invitee@example.com",
        consent: true,
        organiser: { ...application, youtubeChannel: "https://evil.example/@x" },
      },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["organiser.youtubeChannel"]);
  });
});

describe("the Host card on GET /events/slug/{slug}", () => {
  const profileFields = { websiteUrl: "https://static.example/about", instagramHandle: "static.collective", ...stored };

  it("carries the organiser's website, social links and a bio excerpt, and the logo it already had", async () => {
    const organiser = await approvedOrganiser(api, admin, profileFields);
    const live = await publishedEvent(api, organiser, admin);
    const res = await bySlug(live.slug);
    expect(res.status).toBe(200);
    expect(res.body.organiserWebsiteUrl).toBe("https://static.example/about");
    expect(res.body.organiserSocialLinks).toEqual({
      instagram: "https://www.instagram.com/static.collective/",
      ...links,
    });
    expect(res.body.organiserBio).toBe(application.description);
    // Same social links as the public profile, from the same rules.
    expect(res.body.organiserSocialLinks).toEqual((await profile(organiser.organiserId)).body.socialLinks);
    // Nothing private came with it.
    const text = JSON.stringify(res.body);
    for (const secret of [application.contactEmail, organiser.userId, admin.userId]) expect(text).not.toContain(secret);
  });

  it("leaves out whatever the organiser hasn't set", async () => {
    const organiser = await approvedOrganiser(api, admin, { websiteUrl: undefined });
    const live = await publishedEvent(api, organiser, admin);
    const res = await bySlug(live.slug);
    expect(res.body.organiserWebsiteUrl).toBeUndefined();
    expect(res.body.organiserSocialLinks).toBeUndefined();
    // The bio is required, so an excerpt is always there.
    expect(res.body.organiserBio).toBe(application.description);
  });

  it("is absent for an organiser who isn't approved, though the event is still readable", async () => {
    const organiser = await approvedOrganiser(api, admin, profileFields);
    const live = await publishedEvent(api, organiser, admin);
    for (const status of ["pending", "rejected"]) {
      await api.db.query(`update public.organisers set status = $2::public.organiser_status where id = $1`, [
        organiser.organiserId,
        status,
      ]);
      const res = await bySlug(live.slug);
      expect(res.status).toBe(200);
      expect(res.body.organiserName).toBe(application.displayName);
      for (const key of ["organiserWebsiteUrl", "organiserSocialLinks", "organiserBio", "organiserLogoThumbUrl"]) {
        expect(res.body[key], `${status}: ${key}`).toBeUndefined();
      }
      // The same rule as the public profile, which is a 404.
      expect((await profile(organiser.organiserId)).status).toBe(404);
    }
  });

  it("is only on the single-event route, not in the feed or the organiser profile's lists", async () => {
    const organiser = await approvedOrganiser(api, admin, profileFields);
    const live = await publishedEvent(api, organiser, admin);
    const detail = await bySlug(live.slug);
    const HOST_KEYS = ["organiserWebsiteUrl", "organiserSocialLinks", "organiserBio"];
    for (const key of HOST_KEYS) expect(detail.body[key], key).toBeDefined();

    const feed = await api.call(listPublicEvents, {});
    expect(feed.body.items).toHaveLength(1);
    for (const key of HOST_KEYS) expect(feed.body.items[0][key], key).toBeUndefined();

    const [listed] = (await profile(organiser.organiserId)).body.upcomingEvents;
    for (const key of HOST_KEYS) expect(listed[key], key).toBeUndefined();

    // Apart from the Host card, it's the list's event, field for field.
    const rest = Object.fromEntries(Object.entries(detail.body).filter(([key]) => !HOST_KEYS.includes(key)));
    expect(rest).toEqual(feed.body.items[0]);
  });

  it("reads the event with the same single query as before (no extra round trip)", async () => {
    const organiser = await approvedOrganiser(api, admin, profileFields);
    const live = await publishedEvent(api, organiser, admin);
    const real = api.db.query.bind(api.db);
    const queries: string[] = [];
    api.db.query = (async (text: string, params?: unknown[]) => {
      queries.push(text);
      return real(text, params);
    }) as typeof api.db.query;
    try {
      expect((await bySlug(live.slug)).status).toBe(200);
    } finally {
      api.db.query = real;
    }
    expect(queries).toHaveLength(1);
  });

  it("cuts a long bio to an excerpt, keeping it readable", async () => {
    const long = `${"Warehouse gigs in Collingwood. ".repeat(40)}`.trim();
    const organiser = await approvedOrganiser(api, admin, { description: long });
    const live = await publishedEvent(api, organiser, admin);
    const { organiserBio } = (await bySlug(live.slug)).body;
    expect(Array.from(organiserBio as string).length).toBeLessThanOrEqual(ORGANISER_BIO_EXCERPT_LENGTH);
    expect(organiserBio.endsWith("…")).toBe(true);
    expect(long.startsWith(organiserBio.slice(0, -1))).toBe(true);
  });
});

describe("bioExcerpt", () => {
  it("returns a short bio as it is, with whitespace and line breaks collapsed", () => {
    expect(bioExcerpt("Warehouse gigs.\n\n  In Collingwood.\r\n")).toBe("Warehouse gigs. In Collingwood.");
    expect(bioExcerpt("   ")).toBeUndefined();
    expect(bioExcerpt("")).toBeUndefined();
  });

  it("keeps a bio of exactly the limit whole", () => {
    const exact = "a".repeat(ORGANISER_BIO_EXCERPT_LENGTH);
    expect(bioExcerpt(exact)).toBe(exact);
  });

  it("cuts at a word and adds an ellipsis, within the limit", () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const excerpt = bioExcerpt(words, 50) as string;
    expect(excerpt.endsWith("…")).toBe(true);
    expect(Array.from(excerpt).length).toBeLessThanOrEqual(50);
    // Whole words only.
    expect(words.startsWith(excerpt.slice(0, -1))).toBe(true);
    expect(words.charAt(excerpt.length - 1)).toBe(" ");
  });

  it("hard-cuts a bio with no spaces, and doesn't split an emoji or an accented letter", () => {
    const flag = "👩🏽‍🎤";
    const excerpt = bioExcerpt(flag.repeat(20), 5) as string;
    expect(excerpt).toBe(`${flag.repeat(4)}…`);
    expect(bioExcerpt("é".repeat(30), 10)).toBe(`${"é".repeat(9)}…`);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(bioExcerpt("Gigs, gigs, gigs... and more gigs after that", 20)).toBe("Gigs, gigs, gigs…");
  });
});
