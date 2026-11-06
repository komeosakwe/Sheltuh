import { describe, expect, it } from "vitest";
import { isPathSocialValue, pathSocialValueFromInput } from "@/lib/api/social-profiles";

// lib/api/social-profiles.ts: the reader shared by the API and the profile
// forms. The API's field-by-field behaviour is in tests/server/organiser-socials.test.ts.

const ARTIST = "4Z8W4fKeB5YxbusRsdQVPb";
const CHANNEL = "UCabcdefghijklmnopqrstuv";

describe("pathSocialValueFromInput", () => {
  it("Spotify: artist, show and user links, URIs and stored forms", () => {
    const read = (input: string) => pathSocialValueFromInput("spotifyPath", input);
    expect(read(`https://open.spotify.com/artist/${ARTIST}`)).toBe(`artist/${ARTIST}`);
    expect(read(`HTTPS://OPEN.SPOTIFY.COM/artist/${ARTIST}?si=x#y`)).toBe(`artist/${ARTIST}`);
    expect(read(`open.spotify.com/intl-au/artist/${ARTIST}/discography`)).toBe(`artist/${ARTIST}`);
    expect(read(`https://open.spotify.com/show/${ARTIST}`)).toBe(`show/${ARTIST}`);
    expect(read("https://open.spotify.com/user/kome.o")).toBe("user/kome.o");
    expect(read(`spotify:show:${ARTIST}`)).toBe(`show/${ARTIST}`);
    expect(read(`artist/${ARTIST}`)).toBe(`artist/${ARTIST}`);
    expect(read(`  artist/${ARTIST}  `)).toBe(`artist/${ARTIST}`);
    for (const bad of [
      "",
      "   ",
      ARTIST,
      `https://open.spotify.com/track/${ARTIST}`,
      `https://open.spotify.com/artist/${ARTIST.slice(0, 21)}`,
      `https://spotify.com/artist/${ARTIST}`,
      `https://open.spotify.com.evil.example/artist/${ARTIST}`,
      `https://open.spotify.com@evil.example/artist/${ARTIST}`,
      `https://user:pass@open.spotify.com/artist/${ARTIST}`,
      `https://open.spotify.com:444/artist/${ARTIST}`,
      `javascript:alert(1)//open.spotify.com/artist/${ARTIST}`,
      `data:text/html,open.spotify.com/artist/${ARTIST}`,
      `https://open.spotify.com/artist/${ARTIST}\\evil`,
      `https://open.spotify.com/user/%2E%2E`,
      "spotify:track:abc",
    ]) {
      expect(read(bad), bad).toBeNull();
    }
  });

  it("SoundCloud: a name, with or without @, or a soundcloud.com link", () => {
    const read = (input: string) => pathSocialValueFromInput("soundcloudHandle", input);
    expect(read("static-collective")).toBe("static-collective");
    expect(read("@static_collective")).toBe("static_collective");
    expect(read("https://soundcloud.com/static-collective?ref=x")).toBe("static-collective");
    expect(read("soundcloud.com/static-collective/sets/mixes")).toBe("static-collective");
    expect(read("https://www.soundcloud.com/static-collective")).toBe("static-collective");
    for (const bad of ["", "a b", "a.b", "a".repeat(41), "discover", "Stream", "https://soundcloud.com/", "https://on.soundcloud.com/x", "https://example.com/static", "-", "@"]) {
      expect(read(bad), bad).toBeNull();
    }
  });

  it("YouTube: an @handle (bare or in a link) or a channel id", () => {
    const read = (input: string) => pathSocialValueFromInput("youtubeChannel", input);
    expect(read("@staticcollective")).toBe("@staticcollective");
    expect(read("staticcollective")).toBe("@staticcollective");
    expect(read("https://www.youtube.com/@static.collective")).toBe("@static.collective");
    expect(read("https://youtube.com/%40staticcollective/featured")).toBe("@staticcollective");
    expect(read(`https://www.youtube.com/channel/${CHANNEL}`)).toBe(`channel/${CHANNEL}`);
    expect(read(`channel/${CHANNEL}`)).toBe(`channel/${CHANNEL}`);
    for (const bad of [
      "",
      "ab",
      "a b",
      "https://www.youtube.com/c/static",
      "https://www.youtube.com/user/static",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UC123",
      "https://www.youtube.com/",
      "https://music.youtube.com/@static",
      "https://youtube.com.evil.example/@static",
    ]) {
      expect(read(bad), bad).toBeNull();
    }
  });

  it("LinkedIn: in/ and company/ pages, in any country subdomain", () => {
    const read = (input: string) => pathSocialValueFromInput("linkedinPath", input);
    expect(read("in/kome-osakwe")).toBe("in/kome-osakwe");
    expect(read("Company/Static-Collective")).toBe("company/Static-Collective");
    expect(read("https://www.linkedin.com/in/kome-osakwe/")).toBe("in/kome-osakwe");
    expect(read("https://au.linkedin.com/company/static-collective/posts?x=1")).toBe("company/static-collective");
    expect(read("linkedin.com/in/kome-osakwe")).toBe("in/kome-osakwe");
    for (const bad of [
      "",
      "kome-osakwe",
      "in/ab",
      "in/a_b_c",
      "school/some-school",
      "https://www.linkedin.com/feed/",
      "https://www.linkedin.com/in/",
      "https://lnkd.in/x",
      "https://linkedin.com.evil.example/in/someone",
      "https://evil.example/linkedin.com/in/someone",
      "https://www.linkedin.com/in/%E4%BD%A0%E5%A5%BD",
    ]) {
      expect(read(bad), bad).toBeNull();
    }
  });

  it("rejects whitespace, control and invisible characters inside the value", () => {
    expect(pathSocialValueFromInput("soundcloudHandle", "a\nb")).toBeNull();
    expect(pathSocialValueFromInput("soundcloudHandle", "a​b")).toBeNull();
    expect(pathSocialValueFromInput("soundcloudHandle", "a\u0000b")).toBeNull();
    expect(pathSocialValueFromInput("linkedinPath", "in/abc‮def")).toBeNull();
  });
});

describe("isPathSocialValue", () => {
  it("accepts only the stored forms", () => {
    expect(isPathSocialValue("spotifyPath", `artist/${ARTIST}`)).toBe(true);
    expect(isPathSocialValue("spotifyPath", "user/..")).toBe(false);
    expect(isPathSocialValue("spotifyPath", `https://open.spotify.com/artist/${ARTIST}`)).toBe(false);
    expect(isPathSocialValue("soundcloudHandle", "discover")).toBe(false);
    expect(isPathSocialValue("soundcloudHandle", "___")).toBe(false);
    expect(isPathSocialValue("soundcloudHandle", "_a_")).toBe(true);
    expect(isPathSocialValue("youtubeChannel", "@name")).toBe(true);
    expect(isPathSocialValue("youtubeChannel", "name")).toBe(false);
    expect(isPathSocialValue("linkedinPath", "company/x-y-z")).toBe(true);
  });
});
