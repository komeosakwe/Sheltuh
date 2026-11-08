// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  register_for_session: vi.fn(),
  get_distinct_id: vi.fn(() => "anon-id"),
  _isIdentified: vi.fn(() => true),
};
vi.mock("posthog-js", () => ({ default: posthog }));

let supabaseConfigured = true;
vi.mock("@/lib/supabase/config", () => ({
  get isSupabaseConfigured() {
    return supabaseConfigured;
  },
}));

const KEY = "phc_testprojectkey123";
const USER_ID = "7f1c2d9e-3b4a-4c5d-8e6f-0a1b2c3d4e5f";
const OTHER_USER_ID = "11111111-2222-4333-8444-555555555555";
const ORDER_PROPERTIES = { event_slug: "night-market", value_aud: 32.3, ticket_count: 2, has_support: false, free: false };

type Analytics = typeof import("@/lib/analytics");
async function load(): Promise<Analytics> {
  vi.resetModules();
  return import("@/lib/analytics");
}
/** Lets the dynamic import and the queued calls settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setNavigator(values: { doNotTrack?: string | null; globalPrivacyControl?: boolean; userAgent?: string }) {
  for (const [name, value] of Object.entries(values)) Object.defineProperty(window.navigator, name, { value, configurable: true });
}

beforeEach(() => {
  supabaseConfigured = true;
  for (const fn of Object.values(posthog)) fn.mockClear();
  posthog._isIdentified.mockReturnValue(true);
  posthog.get_distinct_id.mockReturnValue("anon-id");
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  setNavigator({ doNotTrack: null, globalPrivacyControl: false, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics is off", () => {
  it("does nothing, and never loads PostHog, without NEXT_PUBLIC_POSTHOG_KEY", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const a = await load();
    a.initAnalytics();
    a.track("map_near_me_used", {});
    a.trackPageview("/events");
    a.identifyUser(USER_ID);
    a.resetIdentity();
    a.rememberCheckoutStarted({ url: "/checkout/pay?order=ord_1" });
    a.trackOrderCompleted("ord_1", ORDER_PROPERTIES);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("sheltuh:analytics-checkout:v1")).toBeNull();
  });

  it("is off in demo mode even with a key", async () => {
    supabaseConfigured = false;
    const a = await load();
    expect(a.analyticsConfig()).toBeNull();
    a.initAnalytics();
    a.track("map_near_me_used", {});
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("is off for a key that is not a project key", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phx_personal");
    const a = await load();
    expect(a.analyticsConfig()).toBeNull();
  });

  it.each([
    ["Do Not Track", { doNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }],
  ])("is off for a browser sending %s: PostHog is never started", async (_name, signals) => {
    setNavigator(signals);
    const a = await load();
    expect(a.browserOptedOut()).toBe(true);
    a.initAnalytics();
    a.track("map_near_me_used", {});
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe("analytics is on", () => {
  it("starts PostHog once, through the first-party proxy, with nothing automatic and no recording", async () => {
    const a = await load();
    a.initAnalytics();
    a.initAnalytics();
    await settle();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [key, config] = posthog.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe(KEY);
    expect(config).toMatchObject({
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      persistence: "localStorage",
      respect_dnt: true,
    });
    expect(config.property_denylist).toEqual(expect.arrayContaining(["gclid", "fbclid", "mc_eid"]));
  });

  it("hands PostHog a before_send that drops /admin and cleans addresses", async () => {
    const a = await load();
    a.initAnalytics();
    await settle();
    const config = posthog.init.mock.calls[0][1] as { before_send: (e: unknown) => { properties: Record<string, string> } | null };
    expect(config.before_send({ event: "x", properties: { $pathname: "/admin/payouts" } })).toBeNull();
    const cleaned = config.before_send({ event: "$pageview", properties: { $current_url: "https://sheltuh.com.au/invite?t=1#token=2", $pathname: "/invite" } });
    expect(cleaned?.properties.$current_url).toBe("https://sheltuh.com.au/invite");
  });

  it("sends a typed event with exactly the properties given", async () => {
    const a = await load();
    a.initAnalytics();
    a.track("search_performed", { has_query: true, has_location: false });
    await settle();
    expect(posthog.capture).toHaveBeenCalledWith("search_performed", { has_query: true, has_location: false });
  });

  it("sends a page view with the path only, never the query string or fragment", async () => {
    window.history.replaceState(null, "", "/checkout/success?session_id=ord_1#token=x");
    const a = await load();
    a.initAnalytics();
    a.trackPageview("/checkout/success");
    await settle();
    expect(posthog.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/checkout/success`,
      $pathname: "/checkout/success",
    });
    expect(JSON.stringify(posthog.capture.mock.calls)).not.toMatch(/ord_|token|session_id/);
  });

  it("keeps an organiser tracking link's ref for the visit, as tracking_ref", async () => {
    window.history.replaceState(null, "", "/events/night-market?ref=ab3def7h&utm_source=instagram");
    const a = await load();
    a.initAnalytics();
    a.trackPageview("/events/night-market");
    await settle();
    expect(posthog.register_for_session).toHaveBeenCalledWith({ tracking_ref: "ab3def7h" });
  });

  it("ignores a ref that is not a tracking code", async () => {
    window.history.replaceState(null, "", "/events/night-market?ref=ord_123");
    const a = await load();
    a.initAnalytics();
    a.trackPageview("/events/night-market");
    await settle();
    expect(posthog.register_for_session).not.toHaveBeenCalled();
  });

  it("marks the visit when it is in Instagram's, TikTok's or Facebook's in-app browser", async () => {
    setNavigator({ userAgent: "Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 300.0" });
    const a = await load();
    a.initAnalytics();
    await settle();
    expect(posthog.register).toHaveBeenCalledWith({ in_app_browser: "Instagram" });
  });

  it("registers nothing for an ordinary browser", async () => {
    const a = await load();
    a.initAnalytics();
    await settle();
    expect(posthog.register).not.toHaveBeenCalled();
  });
});

describe("who is identified", () => {
  it("identifies by the Supabase user id and passes no properties", async () => {
    const a = await load();
    a.initAnalytics();
    a.identifyUser(USER_ID);
    await settle();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith(USER_ID);
  });

  it("never identifies by anything but a uuid: an email, a name or a phone number is refused", async () => {
    const a = await load();
    a.initAnalytics();
    for (const value of ["mia@example.com", "Mia Jones", "+61412345678", "", "ord_123"]) a.identifyUser(value);
    await settle();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("forgets a different account that was identified here before identifying the new one", async () => {
    posthog.get_distinct_id.mockReturnValue(OTHER_USER_ID);
    posthog._isIdentified.mockReturnValue(true);
    const order: string[] = [];
    posthog.reset.mockImplementation(() => void order.push("reset"));
    posthog.identify.mockImplementation(() => void order.push("identify"));
    const a = await load();
    a.initAnalytics();
    a.identifyUser(USER_ID);
    await settle();
    expect(order).toEqual(["reset", "identify"]);
    expect(posthog.reset).toHaveBeenCalledWith(true);
    expect(posthog.identify).toHaveBeenCalledWith(USER_ID);
    posthog.reset.mockReset();
    posthog.identify.mockReset();
  });

  it("does not reset when the browser was only anonymous before", async () => {
    posthog._isIdentified.mockReturnValue(false);
    const a = await load();
    a.initAnalytics();
    a.identifyUser(USER_ID);
    await settle();
    expect(posthog.reset).not.toHaveBeenCalled();
    expect(posthog.identify).toHaveBeenCalledWith(USER_ID);
  });

  it("does not identify again when already identified as that user", async () => {
    posthog.get_distinct_id.mockReturnValue(USER_ID);
    const a = await load();
    a.initAnalytics();
    a.identifyUser(USER_ID);
    await settle();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("resets on sign-out, but only if someone was identified", async () => {
    const a = await load();
    a.initAnalytics();
    a.resetIdentity();
    await settle();
    // true: the device id goes too, so the next person on this browser isn't linked to this one.
    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.reset).toHaveBeenCalledWith(true);
    posthog.reset.mockClear();
    posthog._isIdentified.mockReturnValue(false);
    a.resetIdentity();
    await settle();
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe("order_completed is for the visit that checked out", () => {
  const STARTED = "sheltuh:analytics-checkout:v1";

  it("is sent once, only after this tab started that order's checkout, and the note is cleared", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/checkout/pay?order=ord_abc", orderId: "ord_abc" });
    expect(sessionStorage.getItem(STARTED)).not.toContain("ord_abc");
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith("order_completed", ORDER_PROPERTIES);
    expect(JSON.parse(sessionStorage.getItem(STARTED) ?? "[]")).toEqual([]);
  });

  it("is not sent for an order this tab didn't start (the ticket page opened from an email, on another device or days later)", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/checkout/pay?order=ord_one", orderId: "ord_one" });
    a.trackOrderCompleted("ord_two", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("is never sent twice for an order from this browser, even if the note is armed again (a confirm link pressed again)", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/checkout/success?session_id=ord_again", orderId: "ord_again" });
    a.trackOrderCompleted("ord_again", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("sheltuh:analytics-completed:v1")).not.toContain("ord_again");
    // Armed again (the same order, a second press): nothing is remembered and nothing is sent.
    a.rememberCheckoutStarted({ url: "/checkout/success?session_id=ord_again" });
    expect(JSON.parse(sessionStorage.getItem(STARTED) ?? "[]")).toEqual([]);
    a.trackOrderCompleted("ord_again", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("does not send for an order already reported, even when its note is in place (another tab armed it)", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/x", orderId: "ord_two_tabs" });
    // Another tab reported it meanwhile.
    const note = sessionStorage.getItem(STARTED);
    a.trackOrderCompleted("ord_two_tabs", ORDER_PROPERTIES);
    await settle();
    sessionStorage.setItem(STARTED, note ?? "[]");
    a.trackOrderCompleted("ord_two_tabs", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(STARTED) ?? "[]")).toEqual([]);
  });

  it("is not sent after a reload of the success page", async () => {
    let a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/checkout/pay?order=ord_abc", orderId: "ord_abc" });
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    await settle();
    a = await load();
    a.initAnalytics();
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("finds the order in the address a free or paid checkout leads to when it has no orderId", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "https://sheltuh.com.au/checkout/success?session_id=ord_free1" });
    a.trackOrderCompleted("ord_free1", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("keeps the note until the event has been handed to PostHog (a failed load can be tried again)", async () => {
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/x", orderId: "ord_abc" });
    posthog.capture.mockImplementationOnce(() => {
      throw new Error("capture failed");
    });
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    await settle();
    expect(JSON.parse(sessionStorage.getItem(STARTED) ?? "[]")).toHaveLength(1);
    a.trackOrderCompleted("ord_abc", ORDER_PROPERTIES);
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sessionStorage.getItem(STARTED) ?? "[]")).toEqual([]);
  });

  it("does nothing, and remembers nothing, while analytics is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const a = await load();
    a.initAnalytics();
    a.rememberCheckoutStarted({ url: "/x", orderId: "ord_abc" });
    expect(sessionStorage.getItem(STARTED)).toBeNull();
  });
});

describe("orderCompletedProperties", () => {
  it("carries the revenue, ticket count and flags, and no order reference or id", async () => {
    const { orderCompletedProperties } = await load();
    const properties = orderCompletedProperties({
      eventSlug: "night-market",
      totalCents: 3230,
      supportCents: 200,
      tickets: [
        { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" },
        { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission" },
      ],
    });
    expect(properties).toEqual({ event_slug: "night-market", value_aud: 32.3, ticket_count: 2, has_support: true, free: false });
    expect(JSON.stringify(properties)).not.toMatch(/7KQM|ord_|#/);
  });

  it("marks a free order, and leaves out an event that is gone", async () => {
    const { orderCompletedProperties } = await load();
    expect(orderCompletedProperties({ totalCents: 0, tickets: [{ ticketCode: "A", ticketTypeName: "Free" }] })).toEqual({
      value_aud: 0,
      ticket_count: 1,
      has_support: false,
      free: true,
    });
  });
});
