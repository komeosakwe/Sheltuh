import { describe, expect, it } from "vitest";
import { deepLinkPath, isExcludedAppLink } from "@/lib/mobile/deep-link";
import { isNativeApp } from "@/lib/mobile/native";

const ORIGIN = "https://sheltuh.com.au";

describe("deepLinkPath (links that open the phone app)", () => {
  it.each([
    ["https://sheltuh.com.au/events/rooftop-jazz", "/events/rooftop-jazz"],
    ["https://sheltuh.com.au/events", "/events"],
    ["https://sheltuh.com.au/checkout/success?session_id=ord_123", "/checkout/success?session_id=ord_123"],
    ["https://sheltuh.com.au/events/x?ref=abc#tickets", "/events/x?ref=abc#tickets"],
    ["https://sheltuh.com.au:443/events/x", "/events/x"],
    ["https://SHELTUH.com.au/events/x", "/events/x"],
    ["https://sheltuh.com.au", "/"],
  ])("opens %s at %s", (url, path) => {
    expect(deepLinkPath(url, ORIGIN)).toBe(path);
  });

  it.each([
    ["another site", "https://evil.example/events/x"],
    ["a look-alike host", "https://sheltuh.com.au.evil.example/events/x"],
    ["a subdomain", "https://www.sheltuh.com.au/events/x"],
    ["plain http", "http://sheltuh.com.au/events/x"],
    ["another port", "https://sheltuh.com.au:8443/events/x"],
    ["credentials in the URL", "https://user:pass@sheltuh.com.au/events/x"],
    ["the app's custom scheme", "au.com.sheltuh.app://events/x"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "/events/x"],
    ["a protocol-relative path", "//evil.example/events"],
    ["dot segments that end up protocol-relative", "https://sheltuh.com.au/.//evil.example"],
    ["encoded dot segments", "https://sheltuh.com.au/%2e//evil.example"],
    ["an empty string", ""],
    ["not a URL", "not a url"],
    ["an event's calendar file (excluded from the app)", "https://sheltuh.com.au/events/rooftop-jazz/calendar.ics"],
  ])("ignores %s", (_label, url) => {
    expect(deepLinkPath(url, ORIGIN)).toBeNull();
  });

  it.each([[undefined], [null], [42], [{ url: "https://sheltuh.com.au/" }]])("ignores a non-string (%j)", (value) => {
    expect(deepLinkPath(value, ORIGIN)).toBeNull();
  });

  it("only accepts the origin the app loaded (a preview build's links don't open production pages)", () => {
    expect(deepLinkPath("https://sheltuh.com.au/events/x", "https://preview.sheltuh.com.au")).toBeNull();
    expect(deepLinkPath("https://preview.sheltuh.com.au/events/x", "https://preview.sheltuh.com.au")).toBe("/events/x");
  });
});

describe("isExcludedAppLink", () => {
  it.each([
    ["/events/rooftop-jazz/calendar.ics", true],
    ["/events/a/b/calendar.ics", true],
    ["/events/rooftop-jazz", false],
    ["/events/rooftop-jazz/calendarxics", false],
    ["/events/calendar.ics", false],
    ["/checkout/success", false],
  ])("%s → %s", (path, excluded) => {
    expect(isExcludedAppLink(path)).toBe(excluded);
  });
});

describe("isNativeApp", () => {
  const win = (capacitor: unknown) => ({ Capacitor: capacitor }) as unknown as Window;

  it("is true only when Capacitor's native bridge says so", () => {
    expect(isNativeApp(win({ isNativePlatform: () => true }))).toBe(true);
  });

  it.each([
    ["no Capacitor (a browser)", undefined],
    ["Capacitor's web build", { isNativePlatform: () => false }],
    ["a truthy non-boolean", { isNativePlatform: () => "yes" }],
    ["no isNativePlatform", {}],
    ["a non-function", { isNativePlatform: true }],
    ["one that throws", { isNativePlatform: () => { throw new Error("boom"); } }],
  ])("is false with %s", (_label, capacitor) => {
    expect(isNativeApp(win(capacitor))).toBe(false);
  });

  it("is false with no window (server rendering)", () => {
    expect(isNativeApp(undefined)).toBe(false);
  });
});
