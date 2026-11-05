import { describe, expect, it } from "vitest";
import {
  displayHandle,
  formatMemberSince,
  handleFromProfileUrl,
  isHttpUrl,
  SOCIAL_HANDLE_FIELDS,
  SOCIAL_NETWORKS,
  socialHandleFromUrl,
  socialHandleValuesOf,
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

  it("reads the new networks' server-built URLs", () => {
    expect(socialHandleFromUrl("https://soundcloud.com/static-collective")).toBe("static-collective");
    expect(socialHandleFromUrl("https://www.youtube.com/@staticcollective")).toBe("staticcollective");
    expect(socialHandleFromUrl("https://www.linkedin.com/company/static-collective")).toBe("company/static-collective");
    expect(socialHandleFromUrl("https://www.linkedin.com/in/kome-osakwe")).toBe("in/kome-osakwe");
    // Nothing readable to show: Spotify's ids are opaque, and a channel id isn't a name.
    expect(socialHandleFromUrl("https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb")).toBeNull();
    expect(socialHandleFromUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBeNull();
    expect(socialHandleFromUrl("https://www.linkedin.com/")).toBeNull();
  });

  it("shows @names, except Facebook pages, SoundCloud and LinkedIn, which read as their address", () => {
    expect(displayHandle("instagram", "a")).toBe("@a");
    expect(displayHandle("tiktok", "a")).toBe("@a");
    expect(displayHandle("youtube", "a")).toBe("@a");
    expect(displayHandle("x", "a")).toBe("@a");
    expect(displayHandle("facebook", "a")).toBe("facebook.com/a");
    expect(displayHandle("soundcloud", "a")).toBe("soundcloud.com/a");
    expect(displayHandle("linkedin", "company/a")).toBe("linkedin.com/company/a");
  });
});

describe("SOCIAL_NETWORKS / SOCIAL_HANDLE_FIELDS", () => {
  it("list the networks in the same order, with these labels", () => {
    expect(SOCIAL_NETWORKS.map((n) => n.label)).toEqual([
      "Instagram",
      "TikTok",
      "Spotify",
      "SoundCloud",
      "YouTube",
      "Facebook",
      "X",
      "LinkedIn",
    ]);
    expect(SOCIAL_NETWORKS.map((n) => n.network)).toEqual([
      "instagram",
      "tiktok",
      "spotify",
      "soundcloud",
      "youtube",
      "facebook",
      "x",
      "linkedin",
    ]);
    expect(SOCIAL_HANDLE_FIELDS.map((f) => f.field)).toEqual([
      "instagramHandle",
      "tiktokHandle",
      "spotifyPath",
      "soundcloudHandle",
      "youtubeChannel",
      "facebookPage",
      "xHandle",
      "linkedinPath",
    ]);
  });
});

describe("socialHandleValuesOf", () => {
  it("fills every field, with an empty string for what's unset", () => {
    expect(socialHandleValuesOf(undefined)).toEqual({
      instagramHandle: "",
      tiktokHandle: "",
      spotifyPath: "",
      soundcloudHandle: "",
      youtubeChannel: "",
      facebookPage: "",
      xHandle: "",
      linkedinPath: "",
    });
    expect(socialHandleValuesOf({ spotifyPath: "artist/x", xHandle: "b" })).toMatchObject({
      spotifyPath: "artist/x",
      xHandle: "b",
      linkedinPath: "",
    });
  });
});

describe("handleFromProfileUrl for Spotify, SoundCloud, YouTube and LinkedIn", () => {
  const ARTIST = "4Z8W4fKeB5YxbusRsdQVPb";

  it("reduces a pasted link to the stored value", () => {
    expect(handleFromProfileUrl("spotifyPath", `https://open.spotify.com/artist/${ARTIST}?si=abc`)).toBe(`artist/${ARTIST}`);
    expect(handleFromProfileUrl("spotifyPath", `https://open.spotify.com/intl-au/show/${ARTIST}`)).toBe(`show/${ARTIST}`);
    expect(handleFromProfileUrl("spotifyPath", `spotify:artist:${ARTIST}`)).toBe(`artist/${ARTIST}`);
    expect(handleFromProfileUrl("soundcloudHandle", "https://soundcloud.com/static-collective/")).toBe("static-collective");
    expect(handleFromProfileUrl("youtubeChannel", "https://www.youtube.com/@staticcollective/videos")).toBe("@staticcollective");
    expect(handleFromProfileUrl("youtubeChannel", "youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBe(
      "channel/UCabcdefghijklmnopqrstuv",
    );
    expect(handleFromProfileUrl("linkedinPath", "https://www.linkedin.com/company/static-collective/about/")).toBe(
      "company/static-collective",
    );
    expect(handleFromProfileUrl("linkedinPath", "https://au.linkedin.com/in/kome-osakwe?trk=x")).toBe("in/kome-osakwe");
  });

  it("leaves typed names alone, and anything it can't read for the server to judge", () => {
    expect(handleFromProfileUrl("soundcloudHandle", "static-collective")).toBeNull();
    expect(handleFromProfileUrl("youtubeChannel", "@staticcollective")).toBeNull();
    expect(handleFromProfileUrl("youtubeChannel", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(handleFromProfileUrl("spotifyPath", `https://open.spotify.com/track/${ARTIST}`)).toBeNull();
    expect(handleFromProfileUrl("spotifyPath", `https://evil.example/artist/${ARTIST}`)).toBeNull();
    expect(handleFromProfileUrl("linkedinPath", "https://www.linkedin.com.evil.example/in/someone")).toBeNull();
    expect(handleFromProfileUrl("soundcloudHandle", "https://www.instagram.com/static")).toBeNull();
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
      socialHandlesForRequest({
        ...socialHandleValuesOf(undefined),
        instagramHandle: " @a ",
        facebookPage: "  ",
        xHandle: "b",
        spotifyPath: " artist/x ",
      }),
    ).toEqual({
      instagramHandle: "@a",
      tiktokHandle: null,
      spotifyPath: "artist/x",
      soundcloudHandle: null,
      youtubeChannel: null,
      facebookPage: null,
      xHandle: "b",
      linkedinPath: null,
    });
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
