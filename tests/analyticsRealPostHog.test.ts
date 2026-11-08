// @vitest-environment jsdom
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The REAL posthog-js (not a stand-in), started by lib/analytics.ts with the production configuration,
 * driven through page views and a capture; what it hands to the network after before_send is checked.
 * The unit tests of the sanitiser use events built by hand, which can't show a property the SDK adds
 * on its own ($prev_pageview_pathname, title, $session_entry_*, $initial_person_info, $fbc…).
 */

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const KEY = "phc_realsdktest123";
const MEMBER = "6f1c2b9e-1111-4222-8333-944455556666";
const CONVERSATION = "9a8b7c6d-1111-4222-8333-944455556666";
const ORIGIN = window.location.origin;

interface SentEvent {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

const sent: SentEvent[] = [];
const requests: { url: string; headers: Record<string, string> }[] = [];

/** Reads what the SDK handed to fetch / sendBeacon: JSON, possibly an array of events. */
async function record(url: string, body: unknown, headers: Record<string, string> = {}) {
  requests.push({ url, headers });
  let text = "";
  if (typeof body === "string") text = body;
  else if (body instanceof Blob) text = await body.text();
  else if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    // The SDK gzips larger bodies: read them as the server would.
    const bytes = Buffer.from(ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : new Uint8Array(body));
    text = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
  }
  const decoded = decodeURIComponent(text.replace(/^data=/, ""));
  try {
    const parsed: unknown = JSON.parse(decoded);
    const batch = parsed && typeof parsed === "object" && "batch" in parsed ? (parsed as { batch: unknown }).batch : parsed;
    const events = Array.isArray(batch) ? batch : [batch];
    for (const item of events) if (item && typeof item === "object" && "event" in item) sent.push(item as SentEvent);
  } catch {
    // Not an event body (compressed, or another request).
  }
}

function setUrl(path: string, referrer = "") {
  window.history.replaceState(null, "", path);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

beforeEach(async () => {
  sent.length = 0;
  requests.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    configurable: true,
  });
  Object.defineProperty(window.navigator, "doNotTrack", { value: null, configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: unknown; headers?: Record<string, string> }) => {
      await record(String(url), init?.body, init?.headers);
      return new Response('{"status":1}', { status: 200 });
    }),
  );
  class FakeXhr {
    private url = "";
    private headers: Record<string, string> = {};
    readyState = 4;
    status = 200;
    responseText = '{"status":1}';
    onreadystatechange: (() => void) | null = null;
    onload: (() => void) | null = null;
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      void record(this.url, body, this.headers).then(() => {
        this.onreadystatechange?.();
        this.onload?.();
      });
    }
    abort() {}
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  Object.defineProperty(window.navigator, "sendBeacon", {
    value: (url: string, data: unknown) => {
      void record(String(url), data);
      return true;
    },
    configurable: true,
  });
  // posthog-js is one instance for the whole file (vi.resetModules doesn't reload dependencies): start each test
  // from a new visitor, with no identity, device id or session left by the one before.
  const { default: sdk } = await import("posthog-js");
  if (sdk.__loaded) {
    sdk.reset(true);
    sdk.sessionManager?.resetSessionId();
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the real posthog-js through page views and a capture", () => {
  it("sends nothing private: no member id, query, fragment, click id, title, admin page or order reference", async () => {
    document.title = "Alice Nguyen — Messages — Sheltüh";
    setUrl(`/members/${MEMBER}?near=Fitzroy&q=jazz&fbclid=IwAR0secret&gclid=Cj0secret&mc_eid=mailchimpsecret#token=hashsecret`, "https://l.instagram.com/?u=x&fbclid=refsecret");
    vi.resetModules();
    const analytics = await import("@/lib/analytics");
    analytics.initAnalytics();
    const { default: posthog } = await import("posthog-js");
    await vi.waitFor(() => expect(posthog.__loaded).toBe(true));
    // jsdom never fires these, and PostHog holds its queue until it has seen them.
    document.dispatchEvent(new Event("DOMContentLoaded"));
    window.dispatchEvent(new Event("load"));

    // The page views are made once the SDK is up (a promise later), as the route has changed by then: one
    // navigation at a time, as the App Router does.
    analytics.trackPageview(`/members/${MEMBER}`);
    await settle();
    setUrl("/admin/events/9f3c/edit?x=ord_0123456789abcdef0123456789abcdef");
    analytics.trackPageview("/admin/events/9f3c/edit");
    await settle();
    setUrl(`/messages/${CONVERSATION}?near=Fitzroy#hashsecret`);
    analytics.trackPageview(`/messages/${CONVERSATION}`);
    await settle();
    setUrl("/?utm_source=instagram&utm_medium=bio&utm_campaign=spring&fbclid=IwAR0secret2");
    analytics.trackPageview("/");
    await settle();
    analytics.track("search_performed", { has_query: true, has_location: false });
    // The SDK sends its queue every 3 seconds.
    await new Promise((resolve) => setTimeout(resolve, 3600));

    // The admin page was never sent.
    expect(sent.length).toBeGreaterThanOrEqual(4);
    const pageviews = sent.filter((e) => e.event === "$pageview");
    expect(pageviews.map((e) => e.properties.$pathname)).toEqual(["/members/[profileId]", "/messages/[conversationId]", "/"]);
    expect(sent.some((e) => e.event === "search_performed")).toBe(true);

    const payload = JSON.stringify(sent);
    for (const secret of [MEMBER, CONVERSATION, "Fitzroy", "jazz", "IwAR0secret", "Cj0secret", "mailchimpsecret", "hashsecret", "refsecret", "Alice", "Nguyen", "admin", "ord_", "9f3c"]) {
      expect(payload, `payload contains ${secret}`).not.toContain(secret);
    }
    for (const event of sent) {
      expect(Object.keys(event.properties)).not.toContain("title");
      for (const bag of [event.properties, event.$set ?? {}, event.$set_once ?? {}]) {
        for (const name of Object.keys(bag)) expect(name, `property ${name}`).not.toMatch(/fbclid|gclid|mc_eid|^\$fbc$|^\$fbp$|ph_keyword/);
      }
    }
    // What marketing needs is still there.
    const home = pageviews[2].properties;
    expect(home.$current_url).toBe(`${ORIGIN}/`);
    expect(home.utm_source).toBe("instagram");
    expect(home.utm_medium).toBe("bio");
    expect(home.utm_campaign).toBe("spring");
    // The page before the messages page was /admin: what the SDK remembers of it is gone. The one before the
    // home page was an ordinary page, so its path is kept (cleaned).
    expect(pageviews[1].properties.$prev_pageview_pathname).toBeUndefined();
    expect(pageviews[1].properties.$prev_pageview_duration).toBeUndefined();
    expect(pageviews[2].properties.$prev_pageview_pathname).toBe("/messages/[conversationId]");
    // The person is still anonymous: no profile, no identity.
    expect(sent.some((e) => e.event === "$identify")).toBe(false);
  });

  it("a visit that begins on /admin and moves to a public page sends no trace of /admin, even once identified", async () => {
    document.title = "Reports — Sheltüh admin";
    setUrl("/admin/reports?x=1", `${ORIGIN}/admin/events/9f3c/edit`);
    vi.resetModules();
    const analytics = await import("@/lib/analytics");
    analytics.initAnalytics();
    const { default: posthog } = await import("posthog-js");
    await vi.waitFor(() => expect(posthog.__loaded).toBe(true));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    window.dispatchEvent(new Event("load"));

    analytics.trackPageview("/admin/reports");
    await settle();
    setUrl("/events/night-market?utm_source=instagram");
    analytics.trackPageview("/events/night-market");
    await settle();
    // Identifying sends the visit's first-touch properties ($initial_*) as person properties.
    analytics.identifyUser("7f1c2d9e-3b4a-4c5d-8e6f-0a1b2c3d4e5f");
    await settle();
    setUrl("/");
    analytics.trackPageview("/");
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 3600));

    const pageviews = sent.filter((e) => e.event === "$pageview");
    expect(pageviews.map((e) => e.properties.$pathname)).toEqual(["/events/night-market", "/"]);
    expect(sent.some((e) => e.event === "$identify")).toBe(true);
    const payload = JSON.stringify(sent);
    expect(payload).not.toMatch(/admin/i);
    expect(payload).not.toContain("9f3c");
    // The campaign tag of the public page is still there.
    expect(pageviews[0].properties.utm_source).toBe("instagram");
  });

  it("a crafted campaign value (an email address in utm_campaign) never reaches the payload, the genuine one does", async () => {
    setUrl("/?utm_source=instagram&utm_campaign=someone%40example.com&utm_medium=bio");
    vi.resetModules();
    const analytics = await import("@/lib/analytics");
    analytics.initAnalytics();
    const { default: posthog } = await import("posthog-js");
    await vi.waitFor(() => expect(posthog.__loaded).toBe(true));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    window.dispatchEvent(new Event("load"));

    analytics.trackPageview("/");
    await settle();
    // A user id of its own: posthog-js is one instance for the whole file, and the test before this identified another.
    analytics.identifyUser("22222222-3333-4444-8555-666666666666");
    await settle();
    setUrl("/events/night-market");
    analytics.trackPageview("/events/night-market");
    await new Promise((resolve) => setTimeout(resolve, 3600));

    const payload = JSON.stringify(sent);
    expect(sent.map((e) => e.event).sort()).toEqual(["$identify", "$pageview", "$pageview"]);
    expect(payload).not.toContain("example.com");
    expect(payload).not.toContain("@");
    expect(payload).not.toContain("someone");
    // The genuine parameters are on the page views and on PostHog's first-touch copies of them.
    const first = sent.find((e) => e.event === "$pageview");
    expect(first?.properties.utm_source).toBe("instagram");
    expect(first?.properties.utm_medium).toBe("bio");
    expect(first?.properties).not.toHaveProperty("utm_campaign");
    expect(first?.properties.$session_entry_utm_source).toBe("instagram");
    expect(first?.properties).not.toHaveProperty("$session_entry_utm_campaign");
    const identify = sent.find((e) => e.event === "$identify");
    expect(identify?.$set_once?.$initial_utm_source).toBe("instagram");
    expect(identify?.$set_once).not.toHaveProperty("$initial_utm_campaign");
  });

  it("keeps click ids out of what PostHog keeps in the browser's storage as well", async () => {
    setUrl(`/?utm_source=ig&fbclid=IwAR0storage&gclid=Cj0storage&session_id=ord_0123456789abcdef0123456789abcdef&email=mia%40example.com`);
    vi.resetModules();
    const analytics = await import("@/lib/analytics");
    analytics.initAnalytics();
    const { default: posthog } = await import("posthog-js");
    await vi.waitFor(() => expect(posthog.__loaded).toBe(true));
    analytics.trackPageview("/");
    await settle();
    const stored = JSON.stringify({ ...localStorage });
    for (const secret of ["IwAR0storage", "Cj0storage", "ord_0123", "mia%40example.com", "mia@example.com"]) {
      expect(stored, `storage contains ${secret}`).not.toContain(secret);
    }
    expect(document.cookie).toBe("");
  });
});
