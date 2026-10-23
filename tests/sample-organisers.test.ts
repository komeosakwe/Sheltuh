import { beforeEach, describe, expect, it, vi } from "vitest";
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
      eventsHosted: 0,
      followerCount: null,
      featuredVideo: null,
      socialLinks: {},
    });
    expect(upcoming?.upcoming.map((e) => e.slug)).toEqual(["dead-letter-office"]);
    expect(upcoming?.past).toEqual([]);

    const ended = getSampleOrganiser("static-collective", now);
    expect(ended?.profile.memberSince).toBe("2026-09");
    expect(ended?.profile.eventsHosted).toBe(1);
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
