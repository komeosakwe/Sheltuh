import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { adminListEvents, adminListOrganisers, adminSummary } from "@/lib/server/handlers/admin";
import { adminGetEvent } from "@/lib/server/handlers/admin-authoring";
import {
  getAnalyticsOverview,
  getAnalyticsOverviewCsv,
  getEventAnalytics,
  getEventAnalyticsCsv,
} from "@/lib/server/handlers/analytics";
import { listBlocks } from "@/lib/server/handlers/blocks";
import { getCheckInSummary } from "@/lib/server/handlers/check-ins";
import { adminEmailOutboxHealth, adminListEmailJobs, runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { getMyEvent, listMyEvents } from "@/lib/server/handlers/events";
import { listFavouriteIds, listFavourites } from "@/lib/server/handlers/favourites";
import { getFollow, listFollowingEvents, listMyFollowing } from "@/lib/server/handlers/follows";
import { getMyGoing, listGoingAttendees } from "@/lib/server/handlers/going";
import { adminListInvites } from "@/lib/server/handlers/invites";
import { adminGetMemberProfile } from "@/lib/server/handlers/member-profiles";
import { getUnreadCount, listConversations } from "@/lib/server/handlers/messages";
import { getMyOrganiser } from "@/lib/server/handlers/organisers";
import { adminListPaymentExceptions } from "@/lib/server/handlers/payment-exceptions";
import { getMyProfile, putMyProfile } from "@/lib/server/handlers/profiles";
import { adminListReports } from "@/lib/server/handlers/reports";
import { listTrackingLinks } from "@/lib/server/handlers/tracking-links";
import { adminGetEventCuration, runTrendingCron } from "@/lib/server/handlers/trending";
import { getWaitlistStatus } from "@/lib/server/handlers/waitlist";
import { runHandler, type Handler } from "@/lib/server/route";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Every GET about or for its caller (a signed-in member, an organiser, an
 * admin, the cron) answers `private`, so no browser, CDN or proxy cache can
 * hand one caller's data to another (docs/architecture.md, "CDN windows").
 * Errors are always `private, no-store` (errorJson), so each case here is a
 * 200. A guard below makes every GET route in app/ be listed here, as public
 * (shared on purpose), or as covered by its own file's tests.
 */

let api: TestApi;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let member: { token: string; userId: string };
let eventId: string;
let profileId: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  api = new TestApi(testDb.db);
  await testDb.reset();
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  eventId = (await publishedEvent(api, organiser, admin)).eventId;
  member = await api.signUp();
  const profile = await api.call(putMyProfile, {
    token: member.token,
    method: "PUT",
    body: { displayName: "Sam", adultConfirmed: true },
  });
  if (profile.status !== 200 && profile.status !== 201) throw new Error(`putMyProfile failed: ${JSON.stringify(profile.body)}`);
  profileId = profile.body.profileId;
}, 120_000);

type Case = { name: string; handler: Handler<Record<string, string>>; as: () => string; params?: () => Record<string, string> };

const asAdmin = () => admin.token;
const asOrganiser = () => organiser.token;
const asMember = () => member.token;
const asCron = () => CRON_SECRET;
const event = () => ({ eventId });

/** Typed handlers (Handler<{ eventId: string }>, …) in one table. */
const h = <P extends Record<string, string>>(handler: Handler<P>) => handler as unknown as Handler<Record<string, string>>;

const PRIVATE_GETS: Case[] = [
  // Admin
  { name: "adminListEmailJobs", handler: h(adminListEmailJobs), as: asAdmin },
  { name: "adminEmailOutboxHealth", handler: h(adminEmailOutboxHealth), as: asAdmin },
  { name: "adminListEvents", handler: h(adminListEvents), as: asAdmin },
  { name: "adminGetEvent", handler: h(adminGetEvent), as: asAdmin, params: event },
  { name: "adminGetEventCuration", handler: h(adminGetEventCuration), as: asAdmin, params: event },
  { name: "adminListInvites", handler: h(adminListInvites), as: asAdmin },
  { name: "adminListOrganisers", handler: h(adminListOrganisers), as: asAdmin },
  { name: "adminListPaymentExceptions", handler: h(adminListPaymentExceptions), as: asAdmin },
  { name: "adminGetMemberProfile", handler: h(adminGetMemberProfile), as: asAdmin, params: () => ({ profileId }) },
  { name: "adminListReports", handler: h(adminListReports), as: asAdmin },
  { name: "adminSummary", handler: h(adminSummary), as: asAdmin },
  // Cron
  { name: "runEmailOutboxCron", handler: h(runEmailOutboxCron), as: asCron },
  { name: "runTrendingCron", handler: h(runTrendingCron), as: asCron },
  // A member's own things
  { name: "listBlocks", handler: h(listBlocks), as: asMember },
  { name: "listConversations", handler: h(listConversations), as: asMember },
  { name: "getUnreadCount", handler: h(getUnreadCount), as: asMember },
  { name: "listFavourites", handler: h(listFavourites), as: asMember },
  { name: "listFavouriteIds", handler: h(listFavouriteIds), as: asMember },
  { name: "listMyFollowing", handler: h(listMyFollowing), as: asMember },
  { name: "listFollowingEvents", handler: h(listFollowingEvents), as: asMember },
  { name: "getFollow", handler: h(getFollow), as: asMember, params: () => ({ organiserId: organiser.organiserId }) },
  { name: "getMyProfile", handler: h(getMyProfile), as: asMember },
  { name: "getMyGoing", handler: h(getMyGoing), as: asMember, params: event },
  { name: "listGoingAttendees", handler: h(listGoingAttendees), as: asMember, params: event },
  { name: "getWaitlistStatus", handler: h(getWaitlistStatus), as: asMember, params: event },
  // An organiser's own records
  { name: "getMyOrganiser", handler: h(getMyOrganiser), as: asOrganiser },
  { name: "listMyEvents", handler: h(listMyEvents), as: asOrganiser },
  { name: "getMyEvent", handler: h(getMyEvent), as: asOrganiser, params: event },
  { name: "getAnalyticsOverview", handler: h(getAnalyticsOverview), as: asOrganiser },
  { name: "getAnalyticsOverviewCsv", handler: h(getAnalyticsOverviewCsv), as: asOrganiser },
  { name: "getEventAnalytics", handler: h(getEventAnalytics), as: asOrganiser, params: event },
  { name: "getEventAnalyticsCsv", handler: h(getEventAnalyticsCsv), as: asOrganiser, params: event },
  { name: "listTrackingLinks", handler: h(listTrackingLinks), as: asOrganiser, params: event },
  { name: "getCheckInSummary", handler: h(getCheckInSummary), as: asOrganiser, params: event },
];

/** GETs shared at the CDN on purpose: the same for every caller (their own tests pin the header). */
const PUBLIC_GETS = new Set([
  "listPublicEvents",
  "getPublicEventBySlug",
  "getPublicOrganiserProfile",
  "getTrendingEvents",
  "getGoingSummary",
  "getEventImage",
  "getOrganiserLogo",
  "getSeatMap",
  "getSeatAvailability",
  "getEventClip",
  "eventCalendarRoute",
]);

/** Private GETs that need more state than a table row; each file named asserts the header. */
const COVERED_ELSEWHERE: Record<string, string> = {
  getMessages: "messages.test.ts (a conversation between two members)",
  getMemberProfile: "member-profiles.test.ts (another member visible through a shared event)",
  getMemberAvatar: "member-profiles.test.ts (`private, no-cache` with an ETag)",
  getMyAvatar: "member-profiles.test.ts (`private, no-cache` with an ETag)",
  adminGetReportAvatar: "member-profiles.test.ts (a report with a photo)",
  getMyInvite: "invites.test.ts (a pending invite)",
  getEventClipPreview: "event-clips.test.ts (an uploaded clip)",
  getOrderBySession: "orders.test.ts (a checkout session; no token: the session id is the capability)",
  getOrderPayment: "order-payment.test.ts (an open checkout session)",
  getAppleWalletPass: "wallet-passes.test.ts (a paid order and wallet keys)",
  getGoogleWalletPass: "wallet-passes.test.ts (a paid order and wallet keys)",
};

describe("authenticated GETs are private", () => {
  for (const c of PRIVATE_GETS) {
    it(c.name, async () => {
      // The raw response: some are CSV, not JSON.
      const req = new Request(`${SITE_URL}/api/test`, { headers: { authorization: `Bearer ${c.as()}` } });
      const res = await runHandler(c.handler, req, c.params?.() ?? {}, api.deps);
      expect([c.name, res.status]).toEqual([c.name, 200]);
      expect(res.headers.get("cache-control") ?? "").toMatch(/(^|,\s*)private(\s*,|$)/);
    });
  }
});

/** Every `export const GET = …(handler)` under app/: the handler's name. */
function getRouteHandlers(): string[] {
  const root = path.resolve(import.meta.dirname, "../../app");
  const names: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const source = readFileSync(full, "utf8");
        const match = /export const GET = (?:route\((\w+)\)|(\w+));/.exec(source);
        if (source.includes("export const GET") || source.includes("export async function GET")) {
          expect(match, `${full}: GET export not recognised`).not.toBeNull();
          names.push(match![1] ?? match![2]);
        }
      }
    }
  };
  walk(root);
  return names;
}

describe("every GET route is classified", () => {
  it("as private (tested above), public on purpose, or covered by its own tests", () => {
    const listed = new Set([...PRIVATE_GETS.map((c) => c.name), ...PUBLIC_GETS, ...Object.keys(COVERED_ELSEWHERE)]);
    const routes = getRouteHandlers();
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((name) => !listed.has(name))).toEqual([]);
  });
});
