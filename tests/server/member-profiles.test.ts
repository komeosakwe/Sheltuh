import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_ENCODE_CONCURRENCY,
  encodeAvatar,
  MAX_AVATAR_INPUT_PIXELS,
  MAX_AVATAR_UPLOAD_BYTES,
} from "@/lib/server/avatar";
import { createBlock } from "@/lib/server/handlers/blocks";
import { listGoingAttendees } from "@/lib/server/handlers/going";
import {
  adminGetMemberProfile,
  adminRemoveProfileContent,
  AVATAR_VIEW_RATE_LIMIT,
  getMemberAvatar,
  getMemberProfile,
  PROFILE_VIEW_RATE_LIMIT,
} from "@/lib/server/handlers/member-profiles";
import { startConversation } from "@/lib/server/handlers/messages";
import {
  AVATAR_UPLOAD_RATE_LIMIT,
  deleteMyAvatar,
  deleteMyProfile,
  getMyAvatar,
  getMyProfile,
  patchMyProfile,
  putMyAvatar,
} from "@/lib/server/handlers/profiles";
import { adminGetReportAvatar, adminListReports, createReport } from "@/lib/server/handlers/reports";
import type { Handler } from "@/lib/server/route";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { goingMember, member, optIn, suspend, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";

// Member profiles and photos: docs/architecture.md, "Member profiles";
// supabase/migrations/20261024000100_member_profiles.sql.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

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
  event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 100 }],
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const patch = (token: string | undefined, body: unknown) => api.call(patchMyProfile, { token, body, method: "PATCH" });
const me = (token: string) => api.call(getMyProfile, { token });
const view = (token: string | undefined, profileId: string) =>
  api.call(getMemberProfile, { token, params: { profileId } });

async function profileIdOf(m: { userId: string }): Promise<string> {
  const [row] = await api.db.query<{ public_id: string }>(`select public_id from public.profiles where user_id = $1`, [
    m.userId,
  ]);
  return row.public_id;
}

async function makeVisible(m: { userId: string }, visible = true) {
  await api.db.query(`update public.profiles set profile_visible = $2 where user_id = $1`, [m.userId, visible]);
}

async function block(blocker: { userId: string }, blocked: { userId: string }) {
  await api.db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [
    blocker.userId,
    blocked.userId,
  ]);
}

function rawRequest(method: string, token: string | undefined, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}/api/test`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });
}

function upload(token: string | undefined, body: Uint8Array, headers: Record<string, string> = {}) {
  // A copy into a plain ArrayBuffer-backed array (a Buffer's backing store isn't a BodyInit).
  return api.send(putMyAvatar, rawRequest("PUT", token, new Uint8Array(body), headers));
}

/** Runs a handler and returns the raw Response (for image bodies). */
async function raw<P extends Record<string, string>>(handler: Handler<P>, req: Request, params: P) {
  const { runHandler } = await import("@/lib/server/route");
  return runHandler(handler, req, params, api.deps);
}

function getAvatar(token: string | undefined, profileId: string, query = "", headers: Record<string, string> = {}) {
  return raw(getMemberAvatar, new Request(`${SITE_URL}/api/test${query}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  }), { profileId });
}

// GPS coordinates written into the test photo (Melbourne): 37° 48' 12.34" S, 144° 57' 56.78" E.
const CAMERA_MAKE = "SpyCam-1234";

/**
 * A little-endian TIFF/EXIF block: IFD0 with the camera make and a pointer to
 * a GPS IFD holding latitude and longitude (refs and three rationals each).
 */
function exifWithGps(): Buffer {
  const tiff = Buffer.alloc(152);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number | string) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (typeof value === "string") tiff.write(value.padEnd(4, "\0"), at + 8, "latin1");
    else tiff.writeUInt32LE(value, at + 8);
  };
  // IFD0 at 8: Make (ASCII, 12 bytes at 38), GPSInfo pointer (-> 50).
  tiff.writeUInt16LE(2, 8);
  entry(10, 0x010f, 2, 12, 38);
  entry(22, 0x8825, 4, 1, 50);
  tiff.writeUInt32LE(0, 34);
  tiff.write(`${CAMERA_MAKE}\0`, 38, "latin1");
  // GPS IFD at 50: LatitudeRef "S", Latitude (-> 104), LongitudeRef "E", Longitude (-> 128).
  tiff.writeUInt16LE(4, 50);
  entry(52, 0x0001, 2, 2, "S");
  entry(64, 0x0002, 5, 3, 104);
  entry(76, 0x0003, 2, 2, "E");
  entry(88, 0x0004, 5, 3, 128);
  tiff.writeUInt32LE(0, 100);
  const rationals = (at: number, values: [number, number][]) =>
    values.forEach(([n, d], i) => {
      tiff.writeUInt32LE(n, at + i * 8);
      tiff.writeUInt32LE(d, at + i * 8 + 4);
    });
  rationals(104, [[37, 1], [48, 1], [1234, 100]]);
  rationals(128, [[144, 1], [57, 1], [5678, 100]]);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

/** The rational 1234/100 as stored: proof the GPS seconds are in a file. */
const GPS_SECONDS = Buffer.from([0xd2, 0x04, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);

/** A 900 × 600 JPEG with an ICC profile and, spliced in after SOI, an APP1 EXIF segment with GPS. */
async function jpegWithGps(): Promise<Buffer> {
  const base = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 220, g: 72, b: 0 } } })
    .withIccProfile("p3")
    .jpeg()
    .toBuffer();
  const exif = exifWithGps();
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([base.subarray(0, 2), app1, exif, base.subarray(2)]);
}

/** The four-character codes of a WebP file's RIFF chunks. */
function webpChunks(bytes: Buffer): string[] {
  expect(bytes.toString("latin1", 0, 4)).toBe("RIFF");
  expect(bytes.toString("latin1", 8, 12)).toBe("WEBP");
  const chunks: string[] = [];
  for (let i = 12; i + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(i + 4);
    chunks.push(bytes.toString("latin1", i, i + 4));
    i += 8 + size + (size & 1);
  }
  return chunks;
}

async function storedAvatar(m: { userId: string }) {
  const [row] = await api.db.query<{ image: Uint8Array; thumb: Uint8Array }>(
    `select image, thumb from private.profile_avatars where user_id = $1`,
    [m.userId],
  );
  return row ? { image: Buffer.from(row.image), thumb: Buffer.from(row.thumb) } : undefined;
}

const smallPng = () =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("PATCH /profiles/me", () => {
  it("is off by default and returns the new fields on GET /me", async () => {
    const m = await member(api);
    const res = await me(m.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profileVisible: false, hasAvatar: false, profileId: await profileIdOf(m) });
    expect(res.body.bio).toBeUndefined();
    expect(res.body.instagramHandle).toBeUndefined();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sets visibility, bio and Instagram handle (one leading @ dropped), and clears them", async () => {
    const m = await member(api);
    const res = await patch(m.token, { profileVisible: true, bio: "  Synth nerd.\r\nSays hi.  ", instagramHandle: "@ada.l" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profileVisible: true, bio: "Synth nerd.\nSays hi.", instagramHandle: "ada.l" });

    // Absent fields are unchanged.
    expect((await patch(m.token, { displayName: "Ada L." })).body).toMatchObject({
      displayName: "Ada L.",
      profileVisible: true,
      bio: "Synth nerd.\nSays hi.",
    });

    const cleared = await patch(m.token, { bio: null, instagramHandle: "", profileVisible: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.bio).toBeUndefined();
    expect(cleared.body.instagramHandle).toBeUndefined();
    expect(cleared.body.profileVisible).toBe(false);
  });

  it.each([
    ["a bio over 200 characters", { bio: "a".repeat(201) }, "bio"],
    ["a bio with a control character", { bio: "hi\u0007there" }, "bio"],
    ["a bio with a text-direction override", { bio: "hi ‮there" }, "bio"],
    ["an Instagram URL", { instagramHandle: "https://instagram.com/ada" }, "instagramHandle"],
    ["an Instagram handle that's too long", { instagramHandle: "a".repeat(31) }, "instagramHandle"],
    ["a non-boolean visibility", { profileVisible: "yes" }, "profileVisible"],
    ["a reserved display name", { displayName: "Sheltüh Support" }, "displayName"],
  ])("refuses %s (400)", async (_name, body, field) => {
    const m = await member(api);
    const res = await patch(m.token, body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
  });

  it("accepts a 200-character bio", async () => {
    const m = await member(api);
    expect((await patch(m.token, { bio: "é".repeat(200) })).status).toBe(200);
  });

  it("needs sign-in (401), a verified email (403), a profile (404) and no suspension (403)", async () => {
    expect((await patch(undefined, { profileVisible: true })).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await patch(unverified.token, { profileVisible: true })).status).toBe(403);
    const none = await member(api, { profile: false });
    expect((await patch(none.token, { profileVisible: true })).status).toBe(404);
    const suspended = await member(api);
    await suspend(api, suspended);
    expect((await patch(suspended.token, { profileVisible: true })).status).toBe(403);
    const [row] = await api.db.query<{ profile_visible: boolean }>(
      `select profile_visible from public.profiles where user_id = $1`,
      [suspended.userId],
    );
    expect(row.profile_visible).toBe(false);
  });

  it("the database refuses what the API would (bio length, handle pattern)", async () => {
    const m = await member(api);
    await expect(
      api.db.query(`update public.profiles set bio = $2 where user_id = $1`, [m.userId, "a".repeat(201)]),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      api.db.query(`update public.profiles set instagram_handle = 'not a handle' where user_id = $1`, [m.userId]),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

// ---------------------------------------------------------------------------
// Viewing a profile
// ---------------------------------------------------------------------------

describe("GET /profiles/{profileId}", () => {
  it("shows a visible profile's public fields to a verified member with a profile, and nothing private", async () => {
    const target = await goingMember(api, event, { displayName: "Ada" });
    await patch(target.token, { profileVisible: true, bio: "Hi", instagramHandle: "ada_l" });
    const viewer = await member(api);
    const profileId = await profileIdOf(target);

    const res = await view(viewer.token, profileId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual([
      "bio",
      "canMessage",
      "displayName",
      "hasAvatar",
      "instagramHandle",
      "instagramUrl",
      "isYou",
      "profileId",
      "upcomingEvents",
    ]);
    expect(res.body).toMatchObject({
      profileId,
      displayName: "Ada",
      bio: "Hi",
      instagramHandle: "ada_l",
      instagramUrl: "https://www.instagram.com/ada_l/",
      hasAvatar: false,
      isYou: false,
      canMessage: false,
    });
    expect(res.body.upcomingEvents.map((e: { eventId: string }) => e.eventId)).toEqual([event.eventId]);
    const text = JSON.stringify(res.body);
    for (const secret of [target.userId, target.email, target.attendeeId, viewer.userId]) {
      expect(text).not.toContain(secret);
    }
  });

  it("is a 404 while the profile isn't visible (the default), except to its owner", async () => {
    const target = await member(api);
    const viewer = await member(api);
    const profileId = await profileIdOf(target);
    expect((await view(viewer.token, profileId)).status).toBe(404);
    const own = await view(target.token, profileId);
    expect(own.status).toBe(200);
    expect(own.body.isYou).toBe(true);
    expect(own.body.canMessage).toBe(false);
    await makeVisible(target);
    expect((await view(viewer.token, profileId)).status).toBe(200);
    await patch(target.token, { profileVisible: false });
    expect((await view(viewer.token, profileId)).status).toBe(404);
  });

  it("is a 404 when either blocks the other", async () => {
    const target = await member(api);
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    const a = await member(api);
    const b = await member(api);
    await block(a, target);
    await block(target, b);
    expect((await view(a.token, profileId)).status).toBe(404);
    expect((await view(b.token, profileId)).status).toBe(404);
  });

  it("is a 404 for a suspended member's profile, and for a suspended viewer or one without a profile", async () => {
    const target = await member(api);
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    const suspendedViewer = await member(api);
    await suspend(api, suspendedViewer);
    expect((await view(suspendedViewer.token, profileId)).status).toBe(404);
    const noProfile = await member(api, { profile: false });
    expect((await view(noProfile.token, profileId)).status).toBe(404);

    const viewer = await member(api);
    expect((await view(viewer.token, profileId)).status).toBe(200);
    await suspend(api, target);
    expect((await view(viewer.token, profileId)).status).toBe(404);
  });

  it("needs sign-in (401) and a verified email (403); unknown and malformed ids are 404", async () => {
    const target = await member(api);
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    expect((await view(undefined, profileId)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await view(unverified.token, profileId)).status).toBe(403);
    const viewer = await member(api);
    expect((await view(viewer.token, crypto.randomUUID())).status).toBe(404);
    expect((await view(viewer.token, "not-a-uuid")).status).toBe(404);
    // Neither the user id nor an attendeeId is a profile id.
    expect((await view(viewer.token, target.userId)).status).toBe(404);
  });

  it("lists only open events the member opted in to: published, not ended, Who's Going on", async () => {
    const target = await goingMember(api, event);
    await makeVisible(target);
    const later = await publishedEvent(api, organiser, admin, {
      title: "Later",
      start: { date: "2027-05-01", time: "20:00" },
      end: { date: "2027-05-01", time: "23:00" },
    });
    await optIn(api, target, later);
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended" });
    await optIn(api, target, ended);
    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`,
      [ended.eventId],
    );
    const switchedOff = await publishedEvent(api, organiser, admin, { title: "Off" });
    await optIn(api, target, switchedOff);
    await api.db.query(`update public.events set whos_going_enabled = false where id = $1`, [switchedOff.eventId]);
    const unpublished = await publishedEvent(api, organiser, admin, { title: "Gone" });
    await optIn(api, target, unpublished);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [unpublished.eventId]);
    // An event they hold a ticket for but didn't opt in to isn't listed.
    await publishedEvent(api, organiser, admin, { title: "Not opted in" });

    const viewer = await member(api);
    const res = await view(viewer.token, await profileIdOf(target));
    expect(res.body.upcomingEvents.map((e: { title: string }) => e.title)).toEqual(["Neon Static", "Later"]);
  });

  it("is rate-limited like the attendee list (429)", async () => {
    const target = await member(api);
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    const viewer = await member(api);
    for (let i = 0; i < PROFILE_VIEW_RATE_LIMIT.hits; i++) expect((await view(viewer.token, profileId)).status).toBe(200);
    expect((await view(viewer.token, profileId)).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Messaging, blocking and reporting by profile
// ---------------------------------------------------------------------------

describe("messaging by profile", () => {
  it("canMessage follows the messaging rules; a request by profileId starts the conversation", async () => {
    const target = await goingMember(api, event, { displayName: "Ada" });
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    const stranger = await member(api);
    // Not going to the same event: can't message.
    expect((await view(stranger.token, profileId)).body.canMessage).toBe(false);
    const refused = await api.call(startConversation, { token: stranger.token, body: { profileId, body: "Hi!" } });
    expect(refused.status).toBe(403);

    const sender = await goingMember(api, event);
    const before = await view(sender.token, profileId);
    expect(before.body.canMessage).toBe(true);
    expect(before.body.conversationId).toBeUndefined();

    const sent = await api.call(startConversation, { token: sender.token, body: { profileId, body: "See you there" } });
    expect(sent.status).toBe(201);
    expect(sent.body.otherDisplayName).toBe("Ada");
    expect(sent.body.event).toEqual({ title: event.title, slug: event.slug });

    const after = await view(sender.token, profileId);
    expect(after.body.canMessage).toBe(false);
    expect(after.body.conversationId).toBe(sent.body.conversationId);
    // One conversation per pair, whichever way it's addressed.
    expect(
      (await api.call(startConversation, { token: sender.token, body: { attendeeId: target.attendeeId, body: "Again" } }))
        .status,
    ).toBe(409);
  });

  it("a hidden profile is a 404, yourself a 400, and both ids at once a 400", async () => {
    const target = await goingMember(api, event);
    const sender = await goingMember(api, event);
    const profileId = await profileIdOf(target);
    expect((await api.call(startConversation, { token: sender.token, body: { profileId, body: "Hi" } })).status).toBe(404);
    await makeVisible(sender);
    const self = await api.call(startConversation, {
      token: sender.token,
      body: { profileId: await profileIdOf(sender), body: "Hi" },
    });
    expect(self.status).toBe(400);
    const both = await api.call(startConversation, {
      token: sender.token,
      body: { profileId, attendeeId: target.attendeeId, body: "Hi" },
    });
    expect(both.status).toBe(400);
  });
});

describe("blocking by profile", () => {
  it("blocks a member whose profile the caller can see; the profile then disappears both ways", async () => {
    const target = await goingMember(api, event, { displayName: "Ada" });
    await makeVisible(target);
    const blocker = await goingMember(api, event);
    await makeVisible(blocker);
    const profileId = await profileIdOf(target);

    const res = await api.call(createBlock, { token: blocker.token, body: { profileId } });
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe("Ada");
    expect((await view(blocker.token, profileId)).status).toBe(404);
    expect((await view(target.token, await profileIdOf(blocker))).status).toBe(404);
    // Already blocked: nothing visible to block (404), like an attendeeId.
    expect((await api.call(createBlock, { token: blocker.token, body: { profileId } })).status).toBe(404);
    // And they're out of each other's Who's Going list.
    const list = await api.call(listGoingAttendees, { token: target.token, params: { eventId: event.eventId } });
    expect(list.body.items.map((a: { isYou: boolean }) => a.isYou)).toEqual([true]);
  });

  it("refuses a hidden profile (404), yourself (400) and an unverified caller (404)", async () => {
    const target = await member(api);
    const blocker = await member(api);
    const profileId = await profileIdOf(target);
    expect((await api.call(createBlock, { token: blocker.token, body: { profileId } })).status).toBe(404);
    await makeVisible(blocker);
    expect(
      (await api.call(createBlock, { token: blocker.token, body: { profileId: await profileIdOf(blocker) } })).status,
    ).toBe(400);
    await makeVisible(target);
    const unverified = await member(api, { emailVerified: false });
    expect((await api.call(createBlock, { token: unverified.token, body: { profileId } })).status).toBe(404);
  });
});

describe("reporting a profile", () => {
  it("files a report that keeps copies of the bio, handle and photo, and admins see them", async () => {
    const target = await member(api, { displayName: "Troll" });
    await patch(target.token, { profileVisible: true, bio: "Rude bio", instagramHandle: "troll_1" });
    expect((await upload(target.token, await smallPng())).status).toBe(200);
    const reporter = await member(api);
    const profileId = await profileIdOf(target);

    const res = await api.call(createReport, {
      token: reporter.token,
      body: { profileId, reason: "inappropriate", details: "The photo." },
    });
    expect(res.status).toBe(201);

    // The member deletes their profile: the report keeps its copies.
    await api.call(deleteMyProfile, { token: target.token, method: "DELETE" });

    const list = await api.call(adminListReports, { token: admin.token });
    expect(list.body.items).toHaveLength(1);
    const report = list.body.items[0];
    expect(report).toMatchObject({
      targetType: "profile",
      reportedDisplayName: "Troll",
      reportedBio: "Rude bio",
      reportedInstagramHandle: "troll_1",
      reportedAvatarUrl: `/api/admin/reports/${res.body.reportId}/avatar`,
    });
    expect(report.reportedProfileId).toBeUndefined();

    const photo = await raw(adminGetReportAvatar, rawRequest("GET", admin.token), { reportId: res.body.reportId });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/webp");
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    expect((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width).toBe(512);
    // Admins only.
    expect((await raw(adminGetReportAvatar, rawRequest("GET", reporter.token), { reportId: res.body.reportId })).status).toBe(403);
  });

  it("existing report kinds are labelled, and attendee reports point admins at a current profile", async () => {
    const target = await goingMember(api, event);
    const reporter = await goingMember(api, event);
    const res = await api.call(createReport, {
      token: reporter.token,
      body: { attendeeId: target.attendeeId, reason: "spam" },
    });
    expect(res.status).toBe(201);
    const [report] = (await api.call(adminListReports, { token: admin.token })).body.items;
    expect(report.targetType).toBe("attendee");
    expect(report.reportedProfileId).toBe(await profileIdOf(target));
    expect(report.reportedAvatarUrl).toBeUndefined();
  });

  it("refuses yourself (400), an unknown profile (404), an unverified caller (404) and two targets (400)", async () => {
    const reporter = await member(api);
    const own = await profileIdOf(reporter);
    expect((await api.call(createReport, { token: reporter.token, body: { profileId: own, reason: "spam" } })).status).toBe(400);
    expect(
      (await api.call(createReport, { token: reporter.token, body: { profileId: crypto.randomUUID(), reason: "spam" } }))
        .status,
    ).toBe(404);
    const target = await member(api);
    const unverified = await member(api, { emailVerified: false });
    expect(
      (await api.call(createReport, { token: unverified.token, body: { profileId: await profileIdOf(target), reason: "spam" } }))
        .status,
    ).toBe(404);
    const both = await api.call(createReport, {
      token: reporter.token,
      body: { profileId: await profileIdOf(target), attendeeId: crypto.randomUUID(), reason: "spam" },
    });
    expect(both.status).toBe(400);
  });
});

describe("reporting a profile: who may, and how often", () => {
  const report = (token: string, profileId: string, reason = "spam") =>
    api.call(createReport, { token, body: { profileId, reason } });

  it("only a profile the reporter can see now, or a member they've blocked; anything else is the unknown-id 404", async () => {
    const reporter = await member(api);
    const hidden = await member(api);
    expect((await report(reporter.token, await profileIdOf(hidden))).status).toBe(404);
    await makeVisible(hidden);
    expect((await report(reporter.token, await profileIdOf(hidden))).status).toBe(201);

    // Blocked by the reporter: hidden from them now, still reportable (they may block first, then report).
    const blockedByReporter = await member(api);
    await block(reporter, blockedByReporter);
    expect((await report(reporter.token, await profileIdOf(blockedByReporter))).status).toBe(201);

    // The target blocked the reporter: the same 404 as an unknown id (no hint that the profile exists).
    const blocksReporter = await member(api);
    await makeVisible(blocksReporter);
    await block(blocksReporter, reporter);
    const refused = await report(reporter.token, await profileIdOf(blocksReporter));
    const unknown = await report(reporter.token, crypto.randomUUID());
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual(unknown.body);
    // A suspended reporter can't see profiles either.
    const visible = await member(api);
    await makeVisible(visible);
    const suspendedReporter = await member(api);
    await suspend(api, suspendedReporter);
    expect((await report(suspendedReporter.token, await profileIdOf(visible))).status).toBe(404);
  });

  it("one open report per reporter and member: another is a 200 with the open one, using no allowance; after resolution, a new one", async () => {
    const reporter = await member(api);
    const target = await member(api);
    await makeVisible(target);
    const profileId = await profileIdOf(target);
    const first = await report(reporter.token, profileId);
    expect(first.status).toBe(201);
    const again = await report(reporter.token, profileId, "harassment");
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const [{ hits }] = await api.db.query<{ hits: number }>(
      `select hits from private.rate_limits where user_id = $1 and bucket = 'user_reports'`,
      [reporter.userId],
    );
    expect(hits).toBe(1);
    // Someone else's report about the same member is their own.
    const other = await member(api);
    expect((await report(other.token, profileId)).status).toBe(201);
    await api.db.query(
      `update private.user_reports set status = 'dismissed', resolved_at = now() where id = $1`,
      [first.body.reportId],
    );
    const later = await report(reporter.token, profileId);
    expect(later.status).toBe(201);
    expect(later.body.reportId).not.toBe(first.body.reportId);
    // The database holds the rule too.
    await expect(
      api.db.query(
        `insert into private.user_reports (reporter_id, reported_user_id, target_type, reason) values ($1, $2, 'profile', 'spam')`,
        [reporter.userId, target.userId],
      ),
    ).rejects.toThrow(/user_reports_open_profile_key|duplicate key/);
  });

  it("a photo is copied once however many reports take it; purged once no report needs it", async () => {
    const target = await member(api);
    await makeVisible(target);
    expect((await upload(target.token, await smallPng())).status).toBe(200);
    const profileId = await profileIdOf(target);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const reporter = await member(api);
      const res = await report(reporter.token, profileId);
      expect(res.status).toBe(201);
      ids.push(res.body.reportId);
    }
    const photos = async () =>
      (await api.db.query<{ n: number }>(`select count(*)::int as n from private.report_photos`))[0].n;
    expect(await photos()).toBe(1);
    for (const reportId of ids) {
      const photo = await raw(adminGetReportAvatar, rawRequest("GET", admin.token), { reportId });
      expect(photo.status).toBe(200);
      expect((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width).toBe(512);
    }
    const items = (await api.call(adminListReports, { token: admin.token })).body.items;
    expect(items.every((r: { reportedAvatarUrl?: string }) => r.reportedAvatarUrl)).toBe(true);

    // Still referenced: kept. Every report resolved and past retention: the photo goes too.
    await api.db.query(`update private.report_photos set last_used_at = now() - interval '2 days'`);
    expect((await api.db.query<{ report_photos_deleted: number }>(`select * from private.purge_social_data()`))[0].report_photos_deleted).toBe(0);
    await api.db.query(
      `update private.user_reports set status = 'dismissed', resolved_at = now() - interval '25 months', created_at = now() - interval '25 months'`,
    );
    const [purged] = await api.db.query<{ user_reports_deleted: number; report_photos_deleted: number }>(
      `select * from private.purge_social_data()`,
    );
    expect(purged).toMatchObject({ user_reports_deleted: 3, report_photos_deleted: 1 });
    expect(await photos()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

describe("profile photos", () => {
  it(`refuses an image over ${MAX_AVATAR_INPUT_PIXELS / 1_000_000} megapixels from its header (400), however small the file`, async () => {
    const m = await member(api);
    // 5000 × 5000 = 25 megapixels of one colour: a tiny file claiming a big canvas.
    const big = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(big.length).toBeLessThan(MAX_AVATAR_UPLOAD_BYTES);
    const res = await upload(m.token, big);
    expect(res.status).toBe(400);
    expect(await storedAvatar(m)).toBeUndefined();
    // Just under the limit decodes.
    const fits = await sharp({ create: { width: 4000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    expect((await upload(m.token, fits)).status).toBe(200);
  });

  it(`decodes at most ${AVATAR_ENCODE_CONCURRENCY.running} at once per instance, queues ${AVATAR_ENCODE_CONCURRENCY.waiting}, then 503`, async () => {
    const png = await smallPng();
    const total = AVATAR_ENCODE_CONCURRENCY.running + AVATAR_ENCODE_CONCURRENCY.waiting + 1;
    const results = await Promise.allSettled(Array.from({ length: total }, () => encodeAvatar(png)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(total - 1);
    const [refused] = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(refused.reason).toMatchObject({ statusCode: 503 });
    // The slots are all free again.
    expect((await encodeAvatar(png)).thumb.length).toBeGreaterThan(0);
  });

  it("re-encodes to square WebP (512 and 96 px) and strips EXIF, GPS, ICC and XMP", async () => {
    const m = await member(api);
    const input = await jpegWithGps();
    // The upload really carries them.
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined();
    expect(inputMeta.icc).toBeDefined();
    expect(input.includes(Buffer.from(CAMERA_MAKE))).toBe(true);
    expect(input.includes(GPS_SECONDS)).toBe(true);

    const res = await upload(m.token, input, { "content-type": "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.hasAvatar).toBe(true);
    const profileId = await profileIdOf(m);
    expect(res.body.avatarUrl).toMatch(new RegExp(`^/api/profiles/${profileId}/avatar\\?v=\\d+$`));
    expect(res.body.avatarThumbUrl).toMatch(new RegExp(`^/api/profiles/${profileId}/avatar\\?size=thumb&v=\\d+$`));

    const stored = (await storedAvatar(m))!;
    for (const [bytes, size] of [
      [stored.image, 512],
      [stored.thumb, 96],
    ] as const) {
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([size, size]);
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      // Only image data chunks: no EXIF, ICCP or XMP chunk at all.
      for (const chunk of webpChunks(bytes)) expect(["VP8 ", "VP8L", "VP8X", "ALPH"]).toContain(chunk);
      expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
      expect(bytes.includes(Buffer.from(CAMERA_MAKE))).toBe(false);
      expect(bytes.includes(GPS_SECONDS)).toBe(false);
    }
  });

  it.each([
    ["PNG", () => smallPng()],
    ["WebP", () => sharp({ create: { width: 40, height: 80, channels: 3, background: "#ff4800" } }).webp().toBuffer()],
  ])("accepts %s", async (_name, make) => {
    const m = await member(api);
    expect((await upload(m.token, await make())).status).toBe(200);
    expect((await sharp((await storedAvatar(m))!.image).metadata()).width).toBe(512);
  });

  it("refuses other formats, whatever the declared type, and files that don't decode (400)", async () => {
    const m = await member(api);
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    for (const body of [gif, svg, corrupt, Buffer.alloc(0)]) {
      const res = await upload(m.token, body, { "content-type": "image/jpeg" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["avatar"]);
    }
    expect(await storedAvatar(m)).toBeUndefined();
  });

  it("refuses over 5 MB (413), by declared length or as the stream runs past it", async () => {
    const m = await member(api);
    const big = new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    // No Content-Length (as a chunked upload): cut off while reading.
    const streamed = await upload(m.token, big);
    expect(streamed.status).toBe(413);
    const declared = await upload(m.token, new Uint8Array([0xff, 0xd8, 0xff]), {
      "content-length": String(MAX_AVATAR_UPLOAD_BYTES + 1),
    });
    expect(declared.status).toBe(413);
    expect(await storedAvatar(m)).toBeUndefined();
  });

  it("needs a verified email (403), a profile (404), no suspension (403), and 20 uploads a day (429)", async () => {
    const png = await smallPng();
    expect((await upload(undefined, png)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await upload(unverified.token, png)).status).toBe(403);
    const none = await member(api, { profile: false });
    expect((await upload(none.token, png)).status).toBe(404);
    const suspended = await member(api);
    await suspend(api, suspended);
    expect((await upload(suspended.token, png)).status).toBe(403);

    const m = await member(api);
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'avatar_uploads', now(), $2)`,
      [m.userId, AVATAR_UPLOAD_RATE_LIMIT.hits],
    );
    expect((await upload(m.token, png)).status).toBe(429);
  });

  it("the owner reads and deletes their own photo (DELETE is idempotent)", async () => {
    const m = await member(api);
    await upload(m.token, await smallPng());
    const own = await raw(getMyAvatar, rawRequest("GET", m.token), {});
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/webp");

    expect((await api.call(deleteMyAvatar, { token: m.token, method: "DELETE" })).status).toBe(204);
    expect((await api.call(deleteMyAvatar, { token: m.token, method: "DELETE" })).status).toBe(204);
    expect(await storedAvatar(m)).toBeUndefined();
    expect((await me(m.token)).body.hasAvatar).toBe(false);
    expect((await raw(getMyAvatar, rawRequest("GET", m.token), {})).status).toBe(404);
  });

  it("deleting the profile deletes the photo and bio; a new profile starts hidden with a new id", async () => {
    const m = await member(api);
    await patch(m.token, { profileVisible: true, bio: "Bio" });
    await upload(m.token, await smallPng());
    const before = await profileIdOf(m);
    await api.call(deleteMyProfile, { token: m.token, method: "DELETE" });
    expect(await storedAvatar(m)).toBeUndefined();

    await api.db.query(`insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'Again', now())`, [
      m.userId,
    ]);
    const after = (await me(m.token)).body;
    expect(after.profileId).not.toBe(before);
    expect(after).toMatchObject({ profileVisible: false, hasAvatar: false });
    expect(after.bio).toBeUndefined();
  });
});

describe("serving photos", () => {
  async function withPhoto(options: { visible?: boolean } = {}) {
    const m = await member(api);
    await upload(m.token, await smallPng());
    if (options.visible !== false) await makeVisible(m);
    return { ...m, profileId: await profileIdOf(m) };
  }

  it("serves a visible profile's photo to verified members with a profile: private, revalidated, never public", async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    const res = await getAvatar(viewer.token, target.profileId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(512);

    const thumb = await getAvatar(viewer.token, target.profileId, "?size=thumb");
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(96);

    // Revalidation: same ETag, a 304 (after the same checks).
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"\d+-f"$/);
    expect((await getAvatar(viewer.token, target.profileId, "", { "if-none-match": etag })).status).toBe(304);
  });

  it("is a 404 when hidden, blocked either way, suspended, or the viewer has no profile; 401/403 for the caller", async () => {
    const hidden = await withPhoto({ visible: false });
    const viewer = await member(api);
    expect((await getAvatar(viewer.token, hidden.profileId)).status).toBe(404);
    // The owner still sees their own through this route.
    expect((await getAvatar(hidden.token, hidden.profileId)).status).toBe(200);

    const target = await withPhoto();
    const blocker = await member(api);
    await block(blocker, target);
    expect((await getAvatar(blocker.token, target.profileId)).status).toBe(404);
    const blocked = await member(api);
    await block(target, blocked);
    expect((await getAvatar(blocked.token, target.profileId)).status).toBe(404);

    const noProfile = await member(api, { profile: false });
    expect((await getAvatar(noProfile.token, target.profileId)).status).toBe(404);
    expect((await getAvatar(undefined, target.profileId)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await getAvatar(unverified.token, target.profileId)).status).toBe(403);

    expect((await getAvatar(viewer.token, target.profileId)).status).toBe(200);
    await suspend(api, target);
    expect((await getAvatar(viewer.token, target.profileId)).status).toBe(404);
  });

  it("admins can see any photo (moderation), whatever its visibility; every admin read is logged by ids only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const hidden = await withPhoto({ visible: false });
    expect((await getAvatar(admin.token, hidden.profileId)).status).toBe(200);
    expect((await api.call(adminGetMemberProfile, { token: admin.token, params: { profileId: hidden.profileId } })).status).toBe(200);
    const logged = info.mock.calls.flat().map(String);
    expect(logged).toEqual([
      `Admin ${admin.userId} read the photo of member profile ${hidden.profileId}.`,
      `Admin ${admin.userId} read member profile ${hidden.profileId}.`,
    ]);
    expect(logged.join("\n")).not.toContain(hidden.userId);
  });

  it("If-None-Match never gets a 304 past the visibility check: hidden or blocked since, it's a 404", async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    const ok = await getAvatar(viewer.token, target.profileId);
    const etag = ok.headers.get("etag")!;
    await makeVisible(target, false);
    const hidden = await getAvatar(viewer.token, target.profileId, "", { "if-none-match": etag });
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("etag")).toBeNull();
    await makeVisible(target);
    await block(target, viewer);
    expect((await getAvatar(viewer.token, target.profileId, "", { "if-none-match": etag })).status).toBe(404);
  });

  it(`is rate-limited per member (${AVATAR_VIEW_RATE_LIMIT.hits} per ${AVATAR_VIEW_RATE_LIMIT.window}, 304s included); admins aren't`, async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    expect((await getAvatar(viewer.token, target.profileId)).status).toBe(200);
    await api.db.query(`update private.rate_limits set hits = $2 where user_id = $1 and bucket = 'avatar_views'`, [
      viewer.userId,
      AVATAR_VIEW_RATE_LIMIT.hits,
    ]);
    expect((await getAvatar(viewer.token, target.profileId)).status).toBe(429);
    expect((await getAvatar(viewer.token, target.profileId, "", { "if-none-match": '"x"' })).status).toBe(429);
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await getAvatar(admin.token, target.profileId)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Who's Going list
// ---------------------------------------------------------------------------

describe("attendee list", () => {
  it("carries profileId and the photo only for members whose profile is visible", async () => {
    const visible = await goingMember(api, event, { displayName: "Visible" });
    await patch(visible.token, { profileVisible: true });
    await upload(visible.token, await smallPng());
    const hidden = await goingMember(api, event, { displayName: "Hidden" });
    await upload(hidden.token, await smallPng());
    const viewer = await goingMember(api, event, { displayName: "Viewer" });

    const res = await api.call(listGoingAttendees, { token: viewer.token, params: { eventId: event.eventId } });
    const byName = Object.fromEntries(
      res.body.items.map((a: { displayName: string }) => [a.displayName, a]),
    ) as Record<string, Record<string, unknown>>;
    const visibleId = await profileIdOf(visible);
    expect(byName.Visible).toMatchObject({ profileId: visibleId, hasAvatar: true });
    expect(byName.Visible.avatarThumbUrl).toMatch(new RegExp(`^/api/profiles/${visibleId}/avatar\\?size=thumb&v=\\d+$`));
    expect(byName.Hidden).toEqual({ attendeeId: hidden.attendeeId, displayName: "Hidden", isYou: false, hasAvatar: false });
    // The caller's own entry follows the same rule (their profile is hidden).
    expect(byName.Viewer.profileId).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(await profileIdOf(hidden));
  });
});

// ---------------------------------------------------------------------------
// Admin removal
// ---------------------------------------------------------------------------

describe("admin removal of profile content", () => {
  const remove = (token: string, profileId: string, body: unknown) =>
    api.call(adminRemoveProfileContent, { token, params: { profileId }, body });

  it("removes the photo and bio, logs which fields with the admin and reason, never the content", async () => {
    const m: Member = await member(api);
    await patch(m.token, { profileVisible: true, bio: "Offensive", instagramHandle: "keep_me" });
    await upload(m.token, await smallPng());
    const profileId = await profileIdOf(m);

    const res = await remove(admin.token, profileId, { fields: ["avatar", "bio"], reason: "Report 12: offensive photo" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profileId, hasAvatar: false, instagramHandle: "keep_me", removed: ["avatar", "bio"] });
    expect(res.body.bio).toBeUndefined();
    expect(res.body.moderationLog).toEqual([
      { removed: ["avatar", "bio"], reason: "Report 12: offensive photo", at: expect.any(String), by: admin.userId },
    ]);
    expect(JSON.stringify(res.body.moderationLog)).not.toContain("Offensive");
    expect(await storedAvatar(m)).toBeUndefined();

    // Nothing left to remove: unchanged, nothing logged.
    const again = await remove(admin.token, profileId, { fields: ["avatar", "bio"], reason: "Again" });
    expect(again.body.removed).toEqual([]);
    expect((await api.call(adminGetMemberProfile, { token: admin.token, params: { profileId } })).body.moderationLog).toHaveLength(1);
  });

  it("is admin only (403), validates fields and reason (400), and 404s an unknown profile", async () => {
    const m = await member(api);
    const profileId = await profileIdOf(m);
    expect((await remove(m.token, profileId, { fields: ["bio"], reason: "x" })).status).toBe(403);
    expect((await remove(admin.token, profileId, { fields: ["email"], reason: "x" })).status).toBe(400);
    expect((await remove(admin.token, profileId, { fields: [], reason: "x" })).status).toBe(400);
    expect((await remove(admin.token, profileId, { fields: ["bio"] })).status).toBe(400);
    expect((await remove(admin.token, crypto.randomUUID(), { fields: ["bio"], reason: "x" })).status).toBe(404);
    expect((await api.call(adminGetMemberProfile, { token: m.token, params: { profileId } })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe("retention", () => {
  it("purge_social_data deletes moderation log entries after 2 years; the account's deletion takes the rest", async () => {
    const m = await member(api);
    await patch(m.token, { bio: "x" });
    const profileId = await profileIdOf(m);
    await remove(profileId);
    await api.db.query(`update private.profile_moderation_log set created_at = now() - interval '2 years 1 day'`);
    await patch(m.token, { bio: "y" });
    await remove(profileId);

    const [purged] = await api.db.query<{ profile_moderation_deleted: number }>(`select * from private.purge_social_data()`);
    expect(purged.profile_moderation_deleted).toBe(1);
    await api.db.query(`delete from auth.users where id = $1`, [m.userId]);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.profile_moderation_log`);
    expect(n).toBe(0);

    async function remove(id: string) {
      await api.call(adminRemoveProfileContent, {
        token: admin.token,
        params: { profileId: id },
        body: { fields: ["bio"], reason: "test" },
      });
    }
  });
});
