import { describe, expect, it } from "vitest";
import {
  browserOptsOut,
  isExcludedPath,
  isExcludedUrl,
  sanitizePathname,
  sanitizePostHogEvent,
  sanitizeUrl,
  sanitizeVercelEvent,
} from "@/lib/analytics-privacy";

const ORIGIN = "https://sheltuh.com.au";

describe("sanitizeUrl", () => {
  it("drops the fragment on every page (the emailed-link tokens live there)", () => {
    for (const path of ["/waitlist/confirm", "/waitlist/leave", "/following/unsubscribe", "/holder-messages/stop", "/invite", "/organisers/join", "/checkout/confirm"]) {
      expect(sanitizeUrl(`${ORIGIN}${path}#token=abc123secret`)).toBe(`${ORIGIN}${path}`);
    }
    expect(sanitizeUrl(`${ORIGIN}/events/night-market#tickets`)).toBe(`${ORIGIN}/events/night-market`);
  });

  it("drops every query parameter but utm_* on the sensitive pages", () => {
    expect(sanitizeUrl(`${ORIGIN}/checkout/success?session_id=ord_123abc&utm_source=instagram`)).toBe(
      `${ORIGIN}/checkout/success?utm_source=instagram`,
    );
    expect(sanitizeUrl(`${ORIGIN}/auth/callback?code=one-time-code&next=%2Faccount`)).toBe(`${ORIGIN}/auth/callback`);
    expect(sanitizeUrl(`${ORIGIN}/checkout/pay?order=ord_9&client_secret=pi_1_secret_x`)).toBe(`${ORIGIN}/checkout/pay`);
    expect(sanitizeUrl(`${ORIGIN}/invite?token=abc`)).toBe(`${ORIGIN}/invite`);
  });

  it("keeps utm_* (and only those) on all routes", () => {
    const url = `${ORIGIN}/events/night-market?utm_source=tiktok&utm_medium=bio&utm_campaign=spring&utm_content=reel-1&utm_term=jazz&ref=ab3def7h&gclid=zzz&fbclid=yyy&q=secret`;
    expect(sanitizeUrl(url)).toBe(
      `${ORIGIN}/events/night-market?utm_source=tiktok&utm_medium=bio&utm_campaign=spring&utm_term=jazz&utm_content=reel-1`,
    );
    expect(sanitizeUrl(`${ORIGIN}/search?q=jazz&near=Fitzroy`)).toBe(`${ORIGIN}/search`);
    expect(sanitizeUrl(`${ORIGIN}/?utm_source=email&utm_medium=newsletter&utm_campaign=launch`)).toBe(
      `${ORIGIN}/?utm_source=email&utm_medium=newsletter&utm_campaign=launch`,
    );
  });

  it("never lets an order reference through, in the path or a campaign value", () => {
    expect(sanitizeUrl(`${ORIGIN}/checkout/ord_abc123`)).not.toContain("ord_");
    expect(sanitizeUrl(`${ORIGIN}/x?utm_campaign=ord_abc123`)).not.toContain("ord_");
    expect(sanitizePathname("/anything/ord_zz9/more")).not.toContain("ord_");
  });

  it("replaces ticket codes and people's ids in the path", () => {
    expect(sanitizeUrl(`${ORIGIN}/tickets/7KQM-2HXD`)).toBe(`${ORIGIN}/tickets/[code]`);
    expect(sanitizePathname("/anything/7KQM-2HXD/print")).toBe("/anything/[code]/print");
    expect(sanitizePathname("/members/9f3c")).toBe("/members/[profileId]");
    expect(sanitizePathname("/messages/c0ffee")).toBe("/messages/[conversationId]");
    expect(sanitizePathname("/messages/blocked")).toBe("/messages/blocked");
    expect(sanitizePathname("/messages")).toBe("/messages");
    expect(sanitizePathname("/events/night-market")).toBe("/events/night-market");
  });

  it("keeps a path a path and strips a referrer's query whatever it is", () => {
    expect(sanitizeUrl("/events/x?utm_source=a&token=b#frag")).toBe("/events/x?utm_source=a");
    expect(sanitizeUrl("https://www.google.com/search?q=sheltuh+tickets&utm_source=a", { campaign: false })).toBe("https://www.google.com/search");
  });

  it("returns nothing for what isn't an http(s) address", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("http://[")).toBe("");
  });
});

describe("/admin is never reported", () => {
  it("excludes /admin and everything beneath it, not look-alikes", () => {
    expect(isExcludedPath("/admin")).toBe(true);
    expect(isExcludedPath("/admin/events/123/edit")).toBe(true);
    expect(isExcludedPath("/administrators")).toBe(false);
    expect(isExcludedPath("/dashboard")).toBe(false);
    expect(isExcludedUrl(`${ORIGIN}/admin/reports?x=1`)).toBe(true);
  });
});

describe("sanitizePostHogEvent", () => {
  const base = {
    event: "$pageview",
    uuid: "u",
    properties: {
      $current_url: `${ORIGIN}/checkout/success?session_id=ord_123&utm_source=instagram#x`,
      $pathname: "/checkout/success",
      $referrer: "https://l.instagram.com/?u=https%3A%2F%2Fsheltuh.com.au%2Fwaitlist%2Fconfirm%23token%3Dsecret",
      $initial_referrer: `${ORIGIN}/invite#token=abc`,
      $initial_current_url: `${ORIGIN}/auth/callback?code=abc`,
      title: "Order ord_999 confirmed",
      utm_source: "instagram",
    },
    $set: { $current_url: `${ORIGIN}/following/unsubscribe#token=t` },
    $set_once: { $initial_referrer: `${ORIGIN}/holder-messages/stop?x=1#token=t`, $initial_utm_source: "instagram" },
  };

  it("cleans every address property and removes order references, leaving the rest", () => {
    const cleaned = sanitizePostHogEvent(base);
    expect(cleaned?.properties).toMatchObject({
      $current_url: `${ORIGIN}/checkout/success?utm_source=instagram`,
      $pathname: "/checkout/success",
      $referrer: "https://l.instagram.com/",
      $initial_referrer: `${ORIGIN}/invite`,
      $initial_current_url: `${ORIGIN}/auth/callback`,
      utm_source: "instagram",
    });
    expect(cleaned?.$set).toEqual({ $current_url: `${ORIGIN}/following/unsubscribe` });
    expect(cleaned?.$set_once).toEqual({ $initial_referrer: `${ORIGIN}/holder-messages/stop`, $initial_utm_source: "instagram" });
    const text = JSON.stringify(cleaned);
    expect(text).not.toContain("ord_");
    expect(text).not.toContain("token");
    expect(text).not.toContain("session_id");
    expect(text).not.toContain("code=");
  });

  it("leaves PostHog's no-referrer marker alone", () => {
    const cleaned = sanitizePostHogEvent({ event: "$pageview", properties: { $referrer: "$direct", $initial_referrer: "$direct", $pathname: "/" } });
    expect(cleaned?.properties).toMatchObject({ $referrer: "$direct", $initial_referrer: "$direct" });
  });

  it("does not change the event it is given", () => {
    const copy = JSON.parse(JSON.stringify(base));
    sanitizePostHogEvent(base);
    expect(base).toEqual(copy);
  });

  it("drops an event from /admin, by its path or its address", () => {
    expect(sanitizePostHogEvent({ event: "x", properties: { $pathname: "/admin/payouts" } })).toBeNull();
    expect(sanitizePostHogEvent({ event: "x", properties: { $current_url: `${ORIGIN}/admin` } })).toBeNull();
    expect(sanitizePostHogEvent(null)).toBeNull();
  });

  it("removes the page title (a member's name can be in it), whatever it is called", () => {
    const cleaned = sanitizePostHogEvent({
      event: "$pageview",
      properties: { title: "Alice Nguyen — Messages — Sheltüh", $title: "Alice", $pathname: "/messages/6f1c2b9e-1111-4222-8333-944455556666" },
    });
    expect(cleaned?.properties).toEqual({ $pathname: "/messages/[conversationId]" });
  });

  it("cleans every address property PostHog adds, by name, including the previous page's", () => {
    const member = "6f1c2b9e-1111-4222-8333-944455556666";
    const cleaned = sanitizePostHogEvent({
      event: "$pageview",
      properties: {
        $pathname: "/",
        $prev_pageview_pathname: `/members/${member}`,
        $prev_pageview_last_pathname: `/messages/${member}`,
        $prev_pageview_url: `${ORIGIN}/members/${member}?x=1#y`,
        $session_entry_pathname: `/members/${member}`,
        $session_entry_url: `${ORIGIN}/members/${member}?near=Fitzroy`,
        $initial_pathname: `/messages/${member}`,
        $some_future_referrer: `${ORIGIN}/members/${member}?x=1`,
        $some_future_url: `${ORIGIN}/checkout/success?session_id=ord_1#t`,
      },
    });
    const text = JSON.stringify(cleaned);
    expect(text).not.toContain(member);
    expect(text).not.toMatch(/ord_|Fitzroy|[?#]x/);
    expect(cleaned?.properties).toMatchObject({
      $prev_pageview_pathname: "/members/[profileId]",
      $prev_pageview_last_pathname: "/messages/[conversationId]",
      $session_entry_pathname: "/members/[profileId]",
      $some_future_url: `${ORIGIN}/checkout/success`,
    });
  });

  it("drops what is known of an /admin page that came before (PostHog remembers it even when the view was dropped)", () => {
    const cleaned = sanitizePostHogEvent({
      event: "$pageview",
      properties: {
        $pathname: "/",
        $prev_pageview_pathname: "/admin/events/9f3c/edit",
        $prev_pageview_duration: 42,
        $prev_pageview_last_scroll: 100,
        $prev_pageview_id: "abc",
        $referrer: "$direct",
      },
    });
    expect(cleaned?.properties).toEqual({ $pathname: "/", $referrer: "$direct" });
  });

  it("leaves out every address property of a visit that began on /admin: entry page, first page and referrer", () => {
    const admin = `${ORIGIN}/admin/events/9f3c/edit?x=1`;
    const props = {
      $pathname: "/events/night-market",
      $current_url: `${ORIGIN}/events/night-market`,
      $session_entry_url: admin,
      $session_entry_pathname: "/admin/events/9f3c/edit",
      $initial_current_url: admin,
      $initial_pathname: "/admin/events/9f3c/edit",
      $initial_referrer: `${ORIGIN}/admin/reports`,
      $referrer: `${ORIGIN}/admin/reports`,
      $session_entry_referrer: `${ORIGIN}/admin`,
      $referring_domain: "sheltuh.com.au",
      $initial_person_info: { r: `${ORIGIN}/admin/reports`, u: admin },
      urls: [admin, `${ORIGIN}/events/x`],
    };
    const cleaned = sanitizePostHogEvent({ event: "$identify", properties: props, $set: { ...props }, $set_once: { ...props } });
    expect(JSON.stringify(cleaned)).not.toMatch(/admin/i);
    expect(cleaned?.properties).toMatchObject({
      $pathname: "/events/night-market",
      $current_url: `${ORIGIN}/events/night-market`,
      // No referrer, as PostHog says when it has none.
      $referrer: "$direct",
      $initial_referrer: "$direct",
      $session_entry_referrer: "$direct",
      $referring_domain: "sheltuh.com.au",
    });
    expect(cleaned?.properties).not.toHaveProperty("$session_entry_url");
    expect(cleaned?.properties).not.toHaveProperty("$initial_pathname");
    expect(cleaned?.properties?.$initial_person_info).toEqual({});
    expect(cleaned?.properties?.urls).toEqual([`${ORIGIN}/events/x`]);
  });

  it("keeps the previous page's duration when it was an ordinary page", () => {
    const cleaned = sanitizePostHogEvent({
      event: "$pageview",
      properties: { $pathname: "/", $prev_pageview_pathname: "/events/night-market", $prev_pageview_duration: 42 },
    });
    expect(cleaned?.properties).toMatchObject({ $prev_pageview_pathname: "/events/night-market", $prev_pageview_duration: 42 });
  });

  it("drops click ids and PostHog's copies of them, in properties, $set and $set_once", () => {
    const cleaned = sanitizePostHogEvent({
      event: "$pageview",
      properties: {
        $pathname: "/",
        gclid: "a",
        fbclid: "b",
        ttclid: "c",
        msclkid: "d",
        mc_cid: "e",
        _kx: "f",
        $session_entry_fbclid: "g",
        $session_entry__kx: "h",
        $initial_gclid: "i",
        $fbc: "fb.1.1.x",
        $fbp: "fb.1.2.y",
        ph_keyword: "alice nguyen tickets",
        utm_source: "instagram",
        $initial_utm_source: "instagram",
      },
      $set: { $fbc: "fb.1.1.x", $initial_fbclid: "j" },
      $set_once: { $initial_gclid: "k", $initial_utm_campaign: "spring", $initial_msclkid: "l" },
    });
    expect(cleaned?.properties).toEqual({ $pathname: "/", utm_source: "instagram", $initial_utm_source: "instagram" });
    expect(cleaned?.$set).toEqual({});
    expect(cleaned?.$set_once).toEqual({ $initial_utm_campaign: "spring" });
  });

  it("still reports organiser dashboard pages", () => {
    const cleaned = sanitizePostHogEvent({ event: "$pageview", properties: { $pathname: "/dashboard/analytics", $current_url: `${ORIGIN}/dashboard/analytics?x=1` } });
    expect(cleaned?.properties?.$current_url).toBe(`${ORIGIN}/dashboard/analytics`);
  });
});

describe("sanitizeVercelEvent", () => {
  it("drops /admin entirely and cleans every other address", () => {
    expect(sanitizeVercelEvent({ type: "pageview", url: `${ORIGIN}/admin/events` })).toBeNull();
    expect(sanitizeVercelEvent({ type: "vital", url: `${ORIGIN}/dashboard`, route: "/admin/[x]" })).toBeNull();
    expect(sanitizeVercelEvent({ type: "pageview", url: `${ORIGIN}/checkout/success?session_id=ord_1&utm_source=x#t` })).toEqual({
      type: "pageview",
      url: `${ORIGIN}/checkout/success?utm_source=x`,
    });
    expect(sanitizeVercelEvent({ type: "vital", url: `${ORIGIN}/events/a?q=1`, route: "/events/[slug]" })).toEqual({
      type: "vital",
      url: `${ORIGIN}/events/a`,
      route: "/events/[slug]",
    });
  });

  it("sends nothing for a visitor who opted out", () => {
    expect(sanitizeVercelEvent({ type: "pageview", url: `${ORIGIN}/` }, true)).toBeNull();
  });
});

describe("browserOptsOut", () => {
  it("is on for Do Not Track (1 or yes) and Global Privacy Control", () => {
    expect(browserOptsOut({ doNotTrack: "1" })).toBe(true);
    expect(browserOptsOut({ doNotTrack: "yes" })).toBe(true);
    expect(browserOptsOut({ msDoNotTrack: "1" })).toBe(true);
    expect(browserOptsOut({ doNotTrack: null }, "1")).toBe(true);
    expect(browserOptsOut({ globalPrivacyControl: true })).toBe(true);
  });

  it("is off otherwise", () => {
    expect(browserOptsOut({ doNotTrack: "0", globalPrivacyControl: false })).toBe(false);
    expect(browserOptsOut({ doNotTrack: null })).toBe(false);
    expect(browserOptsOut(undefined)).toBe(false);
  });
});
