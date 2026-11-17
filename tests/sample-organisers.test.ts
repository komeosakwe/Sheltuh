import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTagLabel, parseCustomTag } from "@/lib/api/organiser-tags";
import { sampleEvents } from "@/lib/sample-events";
import {
  getSampleOrganiser,
  isSampleOrganiserId,
  organiserProfileHref,
  sampleOrganiserId,
} from "@/lib/sample-organisers";

// Demo by default; the live test flips it.
let apiConfigured = false;
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return apiConfigured;
  },
}));

beforeEach(() => {
  apiConfigured = false;
});

describe("sampleOrganiserId", () => {
  it("slugs the organiser's name", () => {
    expect(sampleOrganiserId("Small Hours Theatre")).toBe("small-hours-theatre");
    expect(sampleOrganiserId("Off-Kilter Theatre Co.")).toBe("off-kilter-theatre-co");
    expect(sampleOrganiserId("Table & Tongue")).toBe("table-tongue");
    expect(sampleOrganiserId("Café Ümlaut")).toBe("cafe-umlaut");
  });

  it("gives every sample organiser its own id (no two names share one)", () => {
    const names = new Set(sampleEvents.map((event) => event.organiserName));
    const ids = new Set([...names].map(sampleOrganiserId));
    expect(ids.size).toBe(names.size);
    for (const id of ids) expect(isSampleOrganiserId(id)).toBe(true);
  });
});

describe("getSampleOrganiser", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");

  it("builds the profile from the organiser's sample events, split at now", () => {
    const upcoming = getSampleOrganiser("small-hours-theatre", now);
    expect(upcoming?.profile).toMatchObject({
      organiserId: "small-hours-theatre",
      displayName: "Small Hours Theatre",
      categories: ["theatre"],
      memberSince: "2026-10",
      eventCount: 1,
      profileTags: ["theatre"],
      customTags: [],
      followerCount: null,
      featuredVideo: null,
      socialLinks: {},
    });
    expect(upcoming?.upcoming.map((e) => e.slug)).toEqual(["dead-letter-office"]);
    expect(upcoming?.past).toEqual([]);

    const ended = getSampleOrganiser("static-collective", now);
    expect(ended?.profile.memberSince).toBe("2026-09");
    expect(ended?.profile.eventCount).toBe(1);
    expect(ended?.profile).not.toHaveProperty("eventsHosted");
    expect(ended?.upcoming).toEqual([]);
    expect(ended?.past.map((e) => e.slug)).toEqual(["neon-static"]);
  });

  it("never says an organiser joined in a month still to come", () => {
    const later = sampleEvents.find((e) => e.slug === "summer-solstice-warehouse");
    if (!later) throw new Error("no sample summer-solstice-warehouse");
    expect(getSampleOrganiser(sampleOrganiserId(later.organiserName), now)?.profile.memberSince).toBe("2026-10");
  });

  it("only links websites on the reserved .example domain", () => {
    const names = new Set(sampleEvents.map((event) => event.organiserName));
    for (const name of names) {
      const website = getSampleOrganiser(sampleOrganiserId(name), now)?.profile.websiteUrl;
      if (website) expect(new URL(website).hostname).toMatch(/\.example$/);
    }
  });

  it("gives a few organisers a cover from the demo's own photos, and the rest none", () => {
    const names = [...new Set(sampleEvents.map((event) => event.organiserName))];
    const covers = names.flatMap((name) => getSampleOrganiser(sampleOrganiserId(name), now)?.profile.coverUrl ?? []);
    expect(covers.length).toBeGreaterThanOrEqual(2);
    expect(covers.length).toBeLessThan(names.length);
    for (const url of covers) expect(url).toMatch(/^\/events\/[a-z-]+\.(jpg|webp)$/);
    // No small variant (it's a static photo), so the profile offers no srcset.
    expect(getSampleOrganiser("static-collective", now)?.profile.coverSmallUrl).toBeUndefined();
  });

  it("chips: the events' categories mapped to the list, then own words that pass the API's own check", () => {
    const names = new Set(sampleEvents.map((event) => event.organiserName));
    let ownWords = 0;
    for (const name of names) {
      const profile = getSampleOrganiser(sampleOrganiserId(name), now)?.profile;
      const tags = [...(profile?.profileTags ?? []), ...(profile?.customTags ?? [])];
      expect(tags.length).toBeLessThanOrEqual(5);
      for (const word of profile?.customTags ?? []) {
        ownWords += 1;
        expect(parseCustomTag(word)).toEqual({ ok: true, value: word });
        expect(isTagLabel(word)).toBe(false);
      }
    }
    expect(ownWords).toBeGreaterThan(0);
    expect(getSampleOrganiser("static-collective", now)?.profile).toMatchObject({
      profileTags: ["live-music"],
      customTags: ["Late-night", "Analogue synths"],
    });
  });

  it("lists at most 12 past events, while counting them all", () => {
    const far = new Date("2099-01-01T00:00:00.000Z");
    for (const name of new Set(sampleEvents.map((event) => event.organiserName))) {
      const sample = getSampleOrganiser(sampleOrganiserId(name), far);
      expect(sample?.past.length).toBeLessThanOrEqual(12);
      expect(sample?.profile.eventCount).toBe(sampleEvents.filter((e) => e.organiserName === name).length);
    }
  });

  it("is null for an id that isn't a sample organiser", () => {
    expect(getSampleOrganiser("no-such-organiser", now)).toBeNull();
  });
});

describe("organiserProfileHref", () => {
  it("links a live event's organiser by its id, in either mode", () => {
    expect(organiserProfileHref({ organiserId: "org 1", organiserName: "Northside Noise" })).toBe("/organisers/org%201");
    apiConfigured = true;
    expect(organiserProfileHref({ organiserId: "org 1", organiserName: "Northside Noise" })).toBe("/organisers/org%201");
  });

  it("demo: links a sample organiser's name to their sample profile; any other name to nothing", () => {
    expect(organiserProfileHref({ organiserName: "Small Hours Theatre" })).toBe("/organisers/small-hours-theatre");
    expect(organiserProfileHref({ organiserName: "Nobody In The Samples" })).toBeNull();
  });

  it("live: an event without an organiserId links nowhere, even with a sample organiser's name", () => {
    apiConfigured = true;
    expect(organiserProfileHref({ organiserName: "Small Hours Theatre" })).toBeNull();
  });
});

describe("sample social links", () => {
  it("gives a few organisers social links in the API's shape (https URLs on the networks they name)", () => {
    const profile = getSampleOrganiser("static-collective")?.profile;
    expect(Object.keys(profile?.socialLinks ?? {}).sort()).toEqual(
      ["facebook", "instagram", "linkedin", "soundcloud", "spotify", "tiktok", "x", "youtube"],
    );
    for (const url of Object.values(profile?.socialLinks ?? {})) expect(url).toMatch(/^https:\/\//);
    expect(getSampleOrganiser("low-end-theory-sound")?.profile.socialLinks.spotify).toMatch(
      /^https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]{22}$/,
    );
    // The rest stay without, and the shared map is never handed out to be changed.
    expect(getSampleOrganiser("small-hours-theatre")?.profile.socialLinks).toEqual({});
  });
});
