import { describe, expect, it } from "vitest";
import { VIEW_SOURCES } from "@/lib/api/types";
import { viewSourceFrom } from "@/lib/view-source";

const own = "sheltuh.com.au";
const from = (referrer: string, search = "") => viewSourceFrom({ referrer, search, ownHost: own });

describe("viewSourceFrom", () => {
  it("no referrer is direct", () => {
    expect(from("")).toBe("direct");
    expect(from("not a url")).toBe("direct");
  });

  it("this site itself is direct (a reload, say)", () => {
    expect(from("https://sheltuh.com.au/events")).toBe("direct");
    expect(from("https://www.sheltuh.com.au/")).toBe("direct");
  });

  it.each([
    ["https://l.instagram.com/?u=x", "instagram"],
    ["https://www.instagram.com/", "instagram"],
    ["android-app://com.instagram.android/", "instagram"],
    ["https://lm.facebook.com/l.php", "facebook"],
    ["https://m.facebook.com/", "facebook"],
    ["https://t.co/abc", "x"],
    ["https://x.com/home", "x"],
    ["https://www.tiktok.com/", "tiktok"],
    ["https://www.google.com/", "search"],
    ["https://www.google.com.au/", "search"],
    ["https://duckduckgo.com/", "search"],
    ["https://www.bing.com/search", "search"],
    ["https://mail.google.com/mail/u/0/", "email"],
    ["https://outlook.live.com/mail/", "email"],
    ["https://www.eventbrite.com.au/e/123", "eventbrite"],
    ["https://someblog.example/post", "other"],
    ["https://instagram.com.evil.example/", "other"],
  ])("%s → %s", (referrer, expected) => {
    expect(from(referrer)).toBe(expected);
  });

  it("utm tags win over the referrer", () => {
    expect(from("https://www.google.com/", "?utm_source=instagram")).toBe("instagram");
    expect(from("", "?utm_source=IG&utm_medium=social")).toBe("instagram");
    expect(from("", "?utm_source=mailchimp")).toBe("email");
    expect(from("", "?utm_medium=email&utm_source=whatever")).toBe("email");
    expect(from("", "?utm_source=a-zine")).toBe("other");
  });

  it("only ever returns one of the API's buckets, never 'tracking' (the server sets that)", () => {
    const samples = ["", "https://t.co/x", "https://nope.example", "android-app://x.y/"];
    for (const referrer of samples) {
      const source = from(referrer, "?ref=abcdefgh");
      expect(VIEW_SOURCES).toContain(source);
      expect(source).not.toBe("tracking");
    }
  });
});
