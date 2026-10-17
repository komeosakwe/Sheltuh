import { describe, expect, it } from "vitest";
import {
  displayHandle,
  formatMemberSince,
  handleFromProfileUrl,
  isHttpUrl,
  socialHandleFromUrl,
  socialHandlesForRequest,
  websiteHostname,
  websiteUrlError,
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

describe("handleFromProfileUrl", () => {
  it("reduces each network's own profile URL to the handle", () => {
    expect(handleFromProfileUrl("instagramHandle", "https://www.instagram.com/northside.noise/")).toBe("northside.noise");
    expect(handleFromProfileUrl("instagramHandle", "instagram.com/northside.noise?igsh=abc")).toBe("northside.noise");
    expect(handleFromProfileUrl("tiktokHandle", " https://www.tiktok.com/@northside_noise ")).toBe("northside_noise");
    expect(handleFromProfileUrl("facebookPage", "https://m.facebook.com/northsidenoise")).toBe("northsidenoise");
    expect(handleFromProfileUrl("facebookPage", "fb.com/northsidenoise")).toBe("northsidenoise");
    expect(handleFromProfileUrl("xHandle", "https://twitter.com/nsnoise")).toBe("nsnoise");
    expect(handleFromProfileUrl("xHandle", "https://x.com/nsnoise#top")).toBe("nsnoise");
  });

  it("leaves anything ambiguous alone", () => {
    // Plain handles, with or without '@'.
    expect(handleFromProfileUrl("instagramHandle", "northside.noise")).toBeNull();
    expect(handleFromProfileUrl("xHandle", "@nsnoise")).toBeNull();
    // Another network's URL, or a look-alike host.
    expect(handleFromProfileUrl("xHandle", "https://www.instagram.com/northside.noise/")).toBeNull();
    expect(handleFromProfileUrl("instagramHandle", "https://instagram.com.evil.example/northside")).toBeNull();
    expect(handleFromProfileUrl("instagramHandle", "https://instagram.com@evil.example/northside")).toBeNull();
    // Not a profile: a post, a site page, a deeper path, no path.
    expect(handleFromProfileUrl("instagramHandle", "https://www.instagram.com/p/C1234/")).toBeNull();
    expect(handleFromProfileUrl("instagramHandle", "https://www.instagram.com/explore")).toBeNull();
    expect(handleFromProfileUrl("facebookPage", "https://www.facebook.com/profile.php?id=123")).toBeNull();
    expect(handleFromProfileUrl("xHandle", "https://x.com/")).toBeNull();
    // TikTok profiles are always /@name.
    expect(handleFromProfileUrl("tiktokHandle", "https://www.tiktok.com/northside_noise")).toBeNull();
    expect(handleFromProfileUrl("instagramHandle", "javascript:alert(1)//instagram.com/x")).toBeNull();
  });
});

describe("socialHandlesForRequest", () => {
  it("trims, and sends blank as null (clear)", () => {
    expect(
      socialHandlesForRequest({ instagramHandle: " @a ", tiktokHandle: "", facebookPage: "  ", xHandle: "b" }),
    ).toEqual({ instagramHandle: "@a", tiktokHandle: null, facebookPage: null, xHandle: "b" });
  });
});

describe("websiteUrlError (the API's website rule, client side)", () => {
  const SECURE = "Use your site's secure address, starting with https://";
  const INVALID = "Enter a valid URL, including https://";
  const CREDENTIALS = "Enter the address without a username or password.";

  it("accepts blank and plain https:// addresses", () => {
    expect(websiteUrlError("")).toBeNull();
    expect(websiteUrlError("   ")).toBeNull();
    expect(websiteUrlError("https://northside.example")).toBeNull();
    expect(websiteUrlError(" HTTPS://northside.example/a/@b?c=d@e#f@g ")).toBeNull();
  });

  it("asks for https:// instead of http://", () => {
    expect(websiteUrlError("http://northside.example")).toBe(SECURE);
    expect(websiteUrlError("HTTP://northside.example")).toBe(SECURE);
  });

  it("refuses anything that isn't a plain https:// URL as typed", () => {
    for (const value of [
      "northside.example",
      "//northside.example",
      "javascript:alert(1)",
      "ftp://northside.example",
      "https://",
      "https://north side.example",
      "https://a.example\\@b.example",
      `https://a.example${String.fromCodePoint(0x200b)}`,
    ]) {
      expect(websiteUrlError(value), value).toBe(INVALID);
    }
  });

  it("refuses a username or password in the address", () => {
    expect(websiteUrlError("https://bank.example@evil.example")).toBe(CREDENTIALS);
    expect(websiteUrlError("https://user:pass@northside.example/")).toBe(CREDENTIALS);
    expect(websiteUrlError("https://@northside.example")).toBe(CREDENTIALS);
  });

  it("refuses an address over 2,048 characters", () => {
    expect(websiteUrlError(`https://n.example/${"a".repeat(2048)}`)).toBe("Must be 2048 characters or fewer.");
  });

  it("keeps the stored value when it's left exactly as it is, even http://", () => {
    expect(websiteUrlError("http://old.example", "http://old.example")).toBeNull();
    expect(websiteUrlError(" http://old.example ", "http://old.example")).toBeNull();
    expect(websiteUrlError("http://old.example/x", "http://old.example")).toBe(SECURE);
    expect(websiteUrlError("http://old.example", undefined)).toBe(SECURE);
  });
});
