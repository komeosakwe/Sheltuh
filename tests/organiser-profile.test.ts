import { describe, expect, it } from "vitest";
import {
  displayHandle,
  formatMemberSince,
  isHttpUrl,
  socialHandleFromUrl,
  socialHandlesForRequest,
  websiteHostname,
} from "@/lib/organiser-profile";

describe("formatMemberSince", () => {
  it("spells out YYYY-MM as month and year", () => {
    expect(formatMemberSince("2026-03")).toBe("March 2026");
    expect(formatMemberSince("2025-12")).toBe("December 2025");
    expect(formatMemberSince("2026-01")).toBe("January 2026");
  });

  it("returns anything else unchanged rather than guessing", () => {
    expect(formatMemberSince("2026-13")).toBe("2026-13");
    expect(formatMemberSince("March 2026")).toBe("March 2026");
  });
});

describe("websiteHostname", () => {
  it("is the hostname only, without www.", () => {
    expect(websiteHostname("https://www.northside.example/about?x=1#y")).toBe("northside.example");
    expect(websiteHostname("http://shop.northside.example")).toBe("shop.northside.example");
  });

  it("is null for anything that isn't an http(s) URL", () => {
    expect(websiteHostname("javascript:alert(1)")).toBeNull();
    expect(websiteHostname("not a url")).toBeNull();
  });
});

describe("isHttpUrl", () => {
  it("needs the scheme as typed", () => {
    expect(isHttpUrl("https://northside.example")).toBe(true);
    expect(isHttpUrl("HTTP://northside.example")).toBe(true);
    expect(isHttpUrl("northside.example")).toBe(false);
    expect(isHttpUrl("ftp://northside.example")).toBe(false);
    expect(isHttpUrl("https://")).toBe(false);
  });
});

describe("socialHandleFromUrl / displayHandle", () => {
  it("reads the handle from each network's profile URL", () => {
    expect(socialHandleFromUrl("https://www.instagram.com/northside.noise/")).toBe("northside.noise");
    expect(socialHandleFromUrl("https://www.tiktok.com/@northside_noise")).toBe("northside_noise");
    expect(socialHandleFromUrl("https://www.facebook.com/northsidenoise")).toBe("northsidenoise");
    expect(socialHandleFromUrl("https://x.com/nsnoise")).toBe("nsnoise");
    expect(socialHandleFromUrl("https://x.com/")).toBeNull();
    expect(socialHandleFromUrl("nope")).toBeNull();
  });

  it("shows @names, except Facebook pages", () => {
    expect(displayHandle("instagram", "a")).toBe("@a");
    expect(displayHandle("x", "a")).toBe("@a");
    expect(displayHandle("facebook", "a")).toBe("a");
  });
});

describe("socialHandlesForRequest", () => {
  it("trims, and sends blank as null (clear)", () => {
    expect(
      socialHandlesForRequest({ instagramHandle: " @a ", tiktokHandle: "", facebookPage: "  ", xHandle: "b" }),
    ).toEqual({ instagramHandle: "@a", tiktokHandle: null, facebookPage: null, xHandle: "b" });
  });
});
