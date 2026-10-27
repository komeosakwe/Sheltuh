import type { ResolvingMetadata } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata as eventPageMetadata } from "@/app/events/[slug]/page";
import { generateMetadata as organiserPageMetadata } from "@/app/organisers/[organiserId]/page";
import { generateMetadata as homeMetadata } from "@/app/page";
import { generateMetadata as partnersMetadata } from "@/app/partners/page";
import {
  absoluteUrl,
  EVENT_NOT_FOUND_METADATA,
  eventShareDescription,
  inheritedShareImages,
  ORGANISER_NOT_FOUND_METADATA,
  plainExcerpt,
  siteOrigin,
} from "@/lib/share-metadata";

// Demo mode: no Supabase, so the pages use the sample data and never the database.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: false,
}));
const getDeps = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/deps", () => ({ getDeps }));

const SITE_IMAGE = { url: "https://sheltuh.test/opengraph-image?x", width: 1200, height: 630, alt: "Sheltüh" };
const parent = Promise.resolve({
  title: { absolute: "Sheltüh — Creative events across Australia", template: null },
  description: "Sheltüh is a curated guide.",
  openGraph: { images: [SITE_IMAGE] },
  twitter: { images: [SITE_IMAGE] },
}) as unknown as ResolvingMetadata;

afterEach(() => {
  vi.unstubAllEnvs();
});

const eventMeta = (slug: string) => eventPageMetadata({ params: Promise.resolve({ slug }) }, parent);

describe("demo event metadata", () => {
  it("a sample event gets the same full metadata, its photo as the image", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://demo.sheltuh.test/");
    const metadata = await eventMeta("neon-static");
    expect(metadata.title).toBe("Neon Static — Sheltüh");
    // Fri 25 Sep 2026, 8 pm in Melbourne (AEST); ICU versions spell September "Sep" or "Sept", as everywhere lib/format.ts is used.
    expect(metadata.description).toMatch(/^Fri 25 Sept? 2026, 8:00 pm · Warehouse 9, Collingwood, VIC\. A night of fuzzed-out guitars/);
    expect(metadata.description!.length).toBeLessThanOrEqual(200);
    expect(metadata.alternates).toEqual({ canonical: "https://demo.sheltuh.test/events/neon-static" });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "https://demo.sheltuh.test/events/neon-static",
      siteName: "Sheltüh",
      locale: "en_AU",
      images: [{ url: "https://demo.sheltuh.test/events/record-shop-dj.jpg", alt: "Neon Static" }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: "https://demo.sheltuh.test/events/record-shop-dj.jpg", alt: "Neon Static" }],
    });
    expect(metadata.robots).toBeUndefined();
    expect(getDeps).not.toHaveBeenCalled();
  });

  it("without a site URL, paths stay relative for metadataBase to resolve", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const metadata = await eventMeta("neon-static");
    expect(metadata.alternates).toEqual({ canonical: "/events/neon-static" });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/events/record-shop-dj.jpg" }] });
  });

  it("an unknown slug: noindex 'not found'", async () => {
    expect(await eventMeta("no-such-event")).toEqual(EVENT_NOT_FOUND_METADATA);
  });

  it("a sample organiser, or noindex 'not available'", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://demo.sheltuh.test");
    const meta = (organiserId: string) =>
      organiserPageMetadata({ params: Promise.resolve({ organiserId }), searchParams: Promise.resolve({}) }, parent);
    const found = await meta("small-hours-theatre");
    expect(found.title).toBe("Small Hours Theatre — Sheltüh");
    expect(found.alternates).toEqual({ canonical: "https://demo.sheltuh.test/organisers/small-hours-theatre" });
    expect(found.openGraph).toMatchObject({ images: [SITE_IMAGE] });
    expect(await meta("no-such-organiser")).toEqual(ORGANISER_NOT_FOUND_METADATA);
  });
});

describe("home and partners metadata", () => {
  it("home: the site's own title and description, canonical '/', the site image", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sheltuh.test");
    const metadata = await homeMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }, parent);
    expect(metadata).toMatchObject({
      title: "Sheltüh — Creative events across Australia",
      description: "Sheltüh is a curated guide.",
      alternates: { canonical: "https://sheltuh.test/" },
      openGraph: { url: "https://sheltuh.test/", images: [SITE_IMAGE], locale: "en_AU" },
      twitter: { card: "summary_large_image", images: [SITE_IMAGE] },
    });
  });

  it("partners: its own title, canonical and preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sheltuh.test");
    const metadata = await partnersMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }, parent);
    expect(metadata).toMatchObject({
      title: "Become a partner — Sheltüh",
      alternates: { canonical: "https://sheltuh.test/partners" },
      openGraph: { title: "Become a partner — Sheltüh", images: [SITE_IMAGE] },
    });
  });
});

describe("share metadata helpers", () => {
  it("siteOrigin: the configured origin only; nothing for an unset or invalid value", () => {
    expect(siteOrigin("https://sheltuh.com.au/")).toBe("https://sheltuh.com.au");
    expect(siteOrigin("https://sheltuh.com.au/some/path?x=1")).toBe("https://sheltuh.com.au");
    expect(siteOrigin("")).toBeUndefined();
    expect(siteOrigin(undefined)).toBeUndefined();
    expect(siteOrigin("not a url")).toBeUndefined();
    expect(siteOrigin("javascript:alert(1)")).toBeUndefined();
  });

  it("absoluteUrl: joins a path to the origin; keeps absolute URLs; relative without an origin", () => {
    expect(absoluteUrl("/events/x", "https://a.test")).toBe("https://a.test/events/x");
    expect(absoluteUrl("events/x", "https://a.test/")).toBe("https://a.test/events/x");
    expect(absoluteUrl("https://cdn.test/i.jpg", "https://a.test")).toBe("https://cdn.test/i.jpg");
    expect(absoluteUrl("/events/x", undefined)).toBe("/events/x");
  });

  it("plainExcerpt: collapses whitespace and control characters, cuts at a word with an ellipsis", () => {
    expect(plainExcerpt("  one\n\ntwo\tthree\u0007 ", 100)).toBe("one two three");
    expect(plainExcerpt("alpha beta gamma delta", 15)).toBe("alpha beta…");
    expect(plainExcerpt("Supercalifragilistic", 10)).toBe("Supercali…");
    expect(plainExcerpt("one, two, three", 10)).toBe("one, two…");
    expect(plainExcerpt("anything", 1)).toBe("");
  });

  it("eventShareDescription: date and place even with an empty description", () => {
    const base = { slug: "x", title: "X", venueName: "The Tote", suburb: "", startsAt: "2027-03-06T09:00:00.000Z" };
    expect(eventShareDescription({ ...base, description: "" })).toBe("Sat 6 Mar 2027, 8:00 pm · The Tote");
  });

  it("eventShareDescription: in the event's zone, naming it outside Melbourne's", () => {
    const base = { slug: "x", title: "X", description: "", venueName: "Mojos", suburb: "", startsAt: "2027-03-06T09:00:00.000Z" };
    // 8:00 pm AEDT is 5:00 pm AWST, 7:30 pm ACDT; Melbourne's unchanged.
    expect(eventShareDescription({ ...base, timeZone: "Australia/Perth", state: "WA" })).toBe(
      "Sat 6 Mar 2027, 5:00 pm Perth time · Mojos",
    );
    expect(eventShareDescription({ ...base, timeZone: "Australia/Adelaide", state: "SA" })).toBe(
      "Sat 6 Mar 2027, 7:30 pm Adelaide time · Mojos",
    );
    expect(eventShareDescription({ ...base, timeZone: "Australia/Melbourne", state: "VIC" })).toBe("Sat 6 Mar 2027, 8:00 pm · Mojos");
    // A late Perth start is on Perth's date: 11:30 pm AWST Sat = 2:30 am AEDT Sun.
    expect(eventShareDescription({ ...base, startsAt: "2027-03-06T15:30:00.000Z", timeZone: "Australia/Perth" })).toBe(
      "Sat 6 Mar 2027, 11:30 pm Perth time · Mojos",
    );
  });

  it("eventShareDescription: the suburb as \"Suburb, STATE\" (owner decision D4), never the state twice", () => {
    const base = { slug: "x", title: "X", description: "", venueName: "Mojos", startsAt: "2027-03-06T09:00:00.000Z" };
    expect(eventShareDescription({ ...base, suburb: "Fremantle", state: "WA", timeZone: "Australia/Perth" })).toBe(
      "Sat 6 Mar 2027, 5:00 pm Perth time · Mojos, Fremantle, WA",
    );
    expect(eventShareDescription({ ...base, suburb: "Richmond NSW", state: "NSW", timeZone: "Australia/Sydney" })).toBe(
      "Sat 6 Mar 2027, 8:00 pm Sydney time · Mojos, Richmond, NSW",
    );
    // No state (an older event): Victoria.
    expect(eventShareDescription({ ...base, suburb: "Fitzroy" })).toBe("Sat 6 Mar 2027, 8:00 pm · Mojos, Fitzroy, VIC");
  });

  it("inheritedShareImages: none without a parent, or if it fails", async () => {
    expect(await inheritedShareImages(undefined)).toEqual({ openGraph: [], twitter: [] });
    const failed = Promise.reject(new Error("x")) as unknown as ResolvingMetadata;
    expect(await inheritedShareImages(failed)).toEqual({ openGraph: [], twitter: [] });
  });
});
