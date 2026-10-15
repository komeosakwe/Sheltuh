import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { melbourneDateOf } from "@/lib/server/analytics-range";
import { getAnalyticsOverview, getEventAnalytics, getEventAnalyticsCsv } from "@/lib/server/handlers/analytics";
import { recordEventView, VIEW_RATE_LIMIT } from "@/lib/server/handlers/event-views";
import { createTrackingLink } from "@/lib/server/handlers/tracking-links";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Security-review follow-ups for analytics: a flood that fills an event's
 * view cap is flagged in reports (F1), refused views past the cap write
 * nothing (F2), and only the app's own same-origin JSON beacon counts (D1).
 */

let api: TestApi;
let reset: () => Promise<void>;
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let other: EventRecord;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const today = () => melbourneDateOf();

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  const admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin);
  other = await publishedEvent(api, organiser, admin, { title: "Other" });
});

function view(eventId: string = event.eventId, headers: Record<string, string> = {}, body: string = "{}") {
  return api.send(
    recordEventView,
    new Request(`${SITE_URL}/api/events/${eventId}/view`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_UA, ...headers },
      body,
    }),
    { eventId },
  );
}

async function counted(eventId: string = event.eventId): Promise<number> {
  const [{ n }] = await api.db.query<{ n: number }>(
    `select coalesce(sum(views), 0)::int as n from public.event_view_counts where event_id = $1`,
    [eventId],
  );
  return n;
}

/** Puts the event at its cap for the current window, as if a flood had just used it up. */
async function fillCap(eventId: string = event.eventId) {
  await api.db.query(
    `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'views', now(), $2)
     on conflict (event_id, bucket) do update set window_started_at = now(), hits = excluded.hits`,
    [eventId, VIEW_RATE_LIMIT.hits],
  );
}

async function markers() {
  return api.db.query<{ event_id: string; day: string }>(
    `select event_id, day::text as day from private.event_view_cap_days order by event_id, day`,
  );
}

describe("F1: a full view cap is flagged, not silent", () => {
  it("records one marker per event per day when the cap is first reached", async () => {
    await fillCap();
    for (let i = 0; i < 3; i++) expect((await view()).status).toBe(204);
    expect(await counted()).toBe(0);
    expect(await markers()).toEqual([{ event_id: event.eventId, day: today() }]);
    // Under the cap: no marker.
    await view(other.eventId);
    expect(await markers()).toHaveLength(1);
    const columns = await api.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'private' and table_name = 'event_view_cap_days' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["event_id", "day"]);
  });

  it("event reports flag the day and the range, with no conversion rate (links included)", async () => {
    await api.call(createTrackingLink, { token: organiser.token, params: { eventId: event.eventId }, body: { label: "Bio" } });
    await view();
    let res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.body.totals).toMatchObject({ views: 1, viewsUnreliable: false, conversionRate: 0 });
    expect(res.body.trackingLinks[0].conversionRate).toBeNull(); // no views on the link itself

    await api.db.query(`update public.event_view_counts set views = 10, source = 'tracking', link_code = (select code from public.event_tracking_links)`);
    res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.body.trackingLinks[0].conversionRate).toBe(0);

    await fillCap();
    await view();
    res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.body.totals).toMatchObject({ views: 10, viewsUnreliable: true, conversionRate: null });
    expect(res.body.byDay.at(-1)).toMatchObject({ date: today(), viewsUnreliable: true });
    expect(res.body.trackingLinks[0].conversionRate).toBeNull();

    // A range without the day is reliable again.
    await api.db.query(`update private.event_view_cap_days set day = day - 3`);
    res = await api.call(getEventAnalytics, {
      token: organiser.token,
      params: { eventId: event.eventId },
      query: { from: today(), to: today() },
    });
    expect(res.body.totals).toMatchObject({ viewsUnreliable: false, conversionRate: 0 });
    expect(res.body.byDay).toEqual([expect.objectContaining({ viewsUnreliable: false })]);
  });

  it("the overview flags the day, the organiser's totals and that event only", async () => {
    await view(other.eventId);
    await fillCap();
    await view();
    // Today only: the default 30 days reach back before view counting started (no rate either way).
    const res = await api.call(getAnalyticsOverview, { token: organiser.token, query: { from: today(), to: today() } });
    expect(res.body.totals).toMatchObject({ viewsUnreliable: true, conversionRate: null });
    expect(res.body.byDay).toEqual([expect.objectContaining({ date: today(), viewsUnreliable: true })]);
    const wider = await api.call(getAnalyticsOverview, { token: organiser.token });
    expect(wider.body.byDay.at(0)).toMatchObject({ viewsUnreliable: false });
    expect(wider.body.byDay.at(-1)).toMatchObject({ viewsUnreliable: true });
    const byId = Object.fromEntries(res.body.events.map((e: { eventId: string }) => [e.eventId, e]));
    expect(byId[event.eventId].totals).toMatchObject({ viewsUnreliable: true, conversionRate: null });
    expect(byId[other.eventId].totals).toMatchObject({ viewsUnreliable: false, conversionRate: 0 });
  });

  it("the CSV names the incomplete days", async () => {
    const text = async () => {
      const res = await getEventAnalyticsCsv(
        new Request(`${SITE_URL}/api/test.csv`, { headers: { authorization: `Bearer ${organiser.token}` } }),
        { eventId: event.eventId },
        api.deps,
      );
      return res.text();
    };
    expect(await text()).not.toContain("Views incomplete");
    await fillCap();
    await view();
    expect(await text()).toContain(`"Views incomplete (view cap reached) on","${today()}"`);
  });

  it("markers go with the event, and with purge_analytics after 25 months", async () => {
    await fillCap(other.eventId);
    await view(other.eventId);
    await fillCap();
    await view();
    await api.db.query(
      `insert into private.event_view_cap_days (event_id, day)
       values ($1, ((now() at time zone 'Australia/Melbourne')::date - interval '26 months')::date)`,
      [event.eventId],
    );
    await api.db.query(`select * from private.purge_analytics()`);
    expect((await markers()).map((m) => m.day)).toEqual([today(), today()]);
    await api.db.query(`delete from public.events where id = $1`, [other.eventId]);
    expect(await markers()).toEqual([{ event_id: event.eventId, day: today() }]);
  });
});

describe("F2: no writes once over the cap", () => {
  async function rowVersion() {
    const [row] = await api.db.query<{ v: string; hits: number }>(
      `select xmin::text as v, hits from private.event_rate_limits where event_id = $1`,
      [event.eventId],
    );
    return row;
  }

  it("the view that goes over writes once; later ones in the window only read", async () => {
    await fillCap();
    const atCap = await rowVersion();
    await view(); // takes it over the cap: one write
    const over = await rowVersion();
    expect(over.hits).toBe(VIEW_RATE_LIMIT.hits + 1);
    expect(over.v).not.toBe(atCap.v);
    const [marker] = await api.db.query<{ v: string }>(`select xmin::text as v from private.event_view_cap_days`);

    for (let i = 0; i < 3; i++) await view();
    expect(await rowVersion()).toEqual(over);
    expect((await api.db.query<{ v: string }>(`select xmin::text as v from private.event_view_cap_days`))[0]).toEqual(marker);

    // A new window counts (and writes) again.
    await api.db.query(`update private.event_rate_limits set window_started_at = now() - interval '61 seconds'`);
    await view();
    expect((await rowVersion()).hits).toBe(1);
    expect(await counted()).toBe(1);
  });

  it("take_event_rate_limit still refuses exactly past the limit", async () => {
    const take = async () =>
      (
        await api.db.query<{ ok: boolean }>(`select private.take_event_rate_limit($1, 'test', 2, '1 minute') as ok`, [
          event.eventId,
        ])
      )[0].ok;
    expect([await take(), await take(), await take(), await take()]).toEqual([true, true, false, false]);
  });
});

describe("D1: only the app's own same-origin JSON beacon counts", () => {
  it.each([
    ["text/plain (sendBeacon, a form)", { "content-type": "text/plain;charset=UTF-8" }],
    ["form-encoded", { "content-type": "application/x-www-form-urlencoded" }],
    ["JSON-ish lookalike", { "content-type": "application/jsonp" }],
    ["cross-site", { "sec-fetch-site": "cross-site" }],
    ["same-site (another subdomain)", { "sec-fetch-site": "same-site" }],
    ["typed in the address bar", { "sec-fetch-site": "none" }],
  ])("ignores %s (204, nothing counted)", async (_label, headers) => {
    const res = await view(event.eventId, headers);
    expect(res.status).toBe(204);
    expect(await counted()).toBe(0);
    // ...without even looking the event up.
    expect((await view(crypto.randomUUID(), headers)).status).toBe(204);
  });

  it("counts a same-origin JSON fetch, with or without a charset, and one without Sec-Fetch-Site", async () => {
    await view(event.eventId, { "sec-fetch-site": "same-origin" });
    await view(event.eventId, { "sec-fetch-site": "same-origin", "content-type": "application/json; charset=utf-8" });
    await view(event.eventId);
    expect(await counted()).toBe(3);
  });

  it("a request with no content type isn't counted", async () => {
    const res = await api.send(
      recordEventView,
      new Request(`${SITE_URL}/api/events/${event.eventId}/view`, { method: "POST", headers: { "user-agent": BROWSER_UA } }),
      { eventId: event.eventId },
    );
    expect(res.status).toBe(204);
    expect(await counted()).toBe(0);
  });
});
