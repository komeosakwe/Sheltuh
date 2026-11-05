import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventCardImage, { generateImageMetadata as eventCardImages } from "@/app/events/[slug]/opengraph-image";
import { generateImageMetadata as eventTwitterImages } from "@/app/events/[slug]/twitter-image";
import OrganiserCardImage, { generateImageMetadata as organiserCardImages } from "@/app/organisers/[organiserId]/opengraph-image";
import {
  BRAND_CARD_ID,
  CARD_TITLE_MAX,
  cardText,
  cardTitleSize,
  cardVersion,
  eventCardDetail,
  dottedText,
} from "@/lib/share-card";
import { coverToCardImage, logoToCardImage } from "@/lib/server/share-card-data";
import { CARD_CACHE, FALLBACK_CARD_CACHE } from "@/lib/server/share-card-render";
import { pageShareMetadata } from "@/lib/share-metadata";

// Demo mode: the sample events and organisers, and never the database.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: false,
}));
const getDeps = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/deps", () => ({ getDeps }));

afterEach(() => {
  vi.restoreAllMocks();
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe("card text", () => {
  const event = { startsAt: "2027-03-06T09:00:00.000Z", venueName: "The Tote", suburb: "Collingwood" };

  it("eventCardDetail: 'Sat 6 Mar · 8:00 pm · Venue, Suburb, STATE' in the event's own zone", () => {
    expect(eventCardDetail(event)).toBe("Sat 6 Mar · 8:00 pm · The Tote, Collingwood, VIC");
    // 8:00 pm AEDT is 5:00 pm AWST: named, as every other date line outside Melbourne's zone.
    expect(eventCardDetail({ ...event, venueName: "Mojos", suburb: "Fremantle", timeZone: "Australia/Perth", state: "WA" })).toBe(
      "Sat 6 Mar · 5:00 pm Perth time · Mojos, Fremantle, WA",
    );
  });

  it("eventCardDetail: leaves out what's empty", () => {
    expect(eventCardDetail({ ...event, venueName: " ", suburb: "" })).toBe("Sat 6 Mar · 8:00 pm");
    expect(eventCardDetail({ ...event, suburb: "" })).toBe("Sat 6 Mar · 8:00 pm · The Tote");
  });

  it("cardText: one line of plain text, cut at a word with an ellipsis", () => {
    expect(cardText("  Neon\n Static  ")).toBe("Neon Static");
    const long = cardText("word ".repeat(100));
    expect([...long].length).toBeLessThanOrEqual(CARD_TITLE_MAX);
    expect(long).toMatch(/word…$/);
  });

  it("cardTitleSize: smaller as the title gets longer, never below 52", () => {
    expect(cardTitleSize("Neon Static")).toBe(92);
    expect(cardTitleSize("A".repeat(40))).toBe(76);
    expect(cardTitleSize("A".repeat(70))).toBe(62);
    expect(cardTitleSize("A".repeat(CARD_TITLE_MAX))).toBe(52);
  });

  it("cardVersion: stable for the same content, different when any part changes", () => {
    expect(cardVersion("Neon Static", "Sat 6 Mar", "/photo?v=1")).toBe(cardVersion("Neon Static", "Sat 6 Mar", "/photo?v=1"));
    expect(cardVersion("Neon Static", "Sat 6 Mar", "/photo?v=1")).not.toBe(cardVersion("Neon Static", "Sat 6 Mar", "/photo?v=2"));
    expect(cardVersion("a", "bc")).not.toBe(cardVersion("ab", "c"));
    expect(cardVersion("x", undefined)).toMatch(/^[0-9a-z]+$/);
    expect(cardVersion("x")).not.toBe(BRAND_CARD_ID);
  });
});

describe("pageShareMetadata images", () => {
  const page = { title: "T", description: "D", path: "/x" };

  it("`null` leaves the images keys out entirely, so a segment's opengraph-image file is used", () => {
    const metadata = pageShareMetadata(page, "https://sheltuh.test", null);
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("inherited images are passed on", () => {
    const image = { url: "https://sheltuh.test/opengraph-image" };
    const metadata = pageShareMetadata(page, "https://sheltuh.test", { openGraph: [image], twitter: [image] });
    expect(metadata.openGraph).toMatchObject({ images: [image] });
  });
});

describe("photo and logo preparation (sharp: Satori can't draw WebP)", () => {
  const size = async (dataUrl: string | null) => {
    expect(dataUrl).not.toBeNull();
    const [, type, base64] = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl!)!;
    const metadata = await sharp(Buffer.from(base64, "base64")).metadata();
    return { type, width: metadata.width, height: metadata.height };
  };
  const source = (format: "webp" | "png" | "jpeg", width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 10, g: 80, b: 200 } } })[format]().toBuffer();

  it("coverToCardImage: any format and shape becomes a 1200 x 630 JPEG", async () => {
    for (const [format, width, height] of [
      ["webp", 2000, 1000],
      ["png", 600, 900],
      ["jpeg", 300, 200],
    ] as const) {
      expect(await size(await coverToCardImage(await source(format, width, height), null)), format).toEqual({
        type: "image/jpeg",
        width: 1200,
        height: 630,
      });
    }
  });

  it("coverToCardImage: the focus point decides which part of a tall photo is kept", async () => {
    // Top half red, bottom half blue.
    const tall = await sharp({ create: { width: 600, height: 1200, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .composite([{ input: { create: { width: 600, height: 600, channels: 3, background: { r: 0, g: 0, b: 255 } } }, top: 600, left: 0 }])
      .png()
      .toBuffer();
    const colourAt = async (focus: { x: number; y: number }) => {
      const url = (await coverToCardImage(tall, focus))!;
      const { data } = await sharp(Buffer.from(url.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
      return { r: data[0], b: data[2] };
    };
    expect((await colourAt({ x: 50, y: 0 })).r).toBeGreaterThan(200);
    expect((await colourAt({ x: 50, y: 100 })).b).toBeGreaterThan(200);
  });

  it("coverToCardImage: bytes that aren't an image are null (logged), not an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await coverToCardImage(new Uint8Array([1, 2, 3]), null)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("logoToCardImage: a square PNG; null for bytes that aren't an image", async () => {
    expect(await size(await logoToCardImage(await source("webp", 512, 512)))).toEqual({ type: "image/png", width: 320, height: 320 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await logoToCardImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("the preview cards in demo mode", () => {
  const eventCard = async (slug: string, id?: string) => {
    const [image] = await eventCardImages({ params: { slug } });
    return EventCardImage({ params: Promise.resolve({ slug }), id: Promise.resolve(id ?? image.id) }) as Promise<Response>;
  };

  it("a sample event: an image/png of its own, alt = its title, an id that isn't the brand's", async () => {
    const [image] = await eventCardImages({ params: { slug: "neon-static" } });
    expect(image).toMatchObject({ alt: "Neon Static", contentType: "image/png", size: { width: 1200, height: 630 } });
    expect(image.id).not.toBe(BRAND_CARD_ID);
    expect(await eventTwitterImages({ params: { slug: "neon-static" } })).toEqual([image]);

    const res = await eventCard("neon-static");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(CARD_CACHE);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 4))).toEqual(PNG_SIGNATURE);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1200, height: 630 });
  });

  it("an unknown slug, a malformed one, or a stale id: the plain brand card, briefly cached", async () => {
    for (const slug of ["no-such-event", "NEON'; --", ""]) {
      const [image] = await eventCardImages({ params: { slug } });
      expect(image, slug).toMatchObject({ id: BRAND_CARD_ID, alt: "Sheltüh" });
      const res = await eventCard(slug);
      expect(res.status, slug).toBe(200);
      expect(res.headers.get("content-type"), slug).toBe("image/png");
      expect(res.headers.get("cache-control"), slug).toBe(FALLBACK_CARD_CACHE);
      expect(Array.from(Buffer.from(await res.arrayBuffer()).subarray(0, 4))).toEqual(PNG_SIGNATURE);
    }
    expect((await eventCard("neon-static", "stale")).headers.get("cache-control")).toBe(FALLBACK_CARD_CACHE);
  });

  it("no slug at all (Next's static-params pass): the brand image, no error", async () => {
    expect(await eventCardImages({})).toEqual([expect.objectContaining({ id: BRAND_CARD_ID })]);
    expect(await organiserCardImages({})).toEqual([expect.objectContaining({ id: BRAND_CARD_ID })]);
  });

  it("a sample organiser: a card named for them; an unknown one: the brand card", async () => {
    const [image] = await organiserCardImages({ params: { organiserId: "small-hours-theatre" } });
    expect(image).toMatchObject({ alt: "Small Hours Theatre", contentType: "image/png" });
    const res = (await OrganiserCardImage({
      params: Promise.resolve({ organiserId: "small-hours-theatre" }),
      id: Promise.resolve(image.id),
    })) as Response;
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(CARD_CACHE);
    expect(Array.from(Buffer.from(await res.arrayBuffer()).subarray(0, 4))).toEqual(PNG_SIGNATURE);

    const [unknown] = await organiserCardImages({ params: { organiserId: "nobody" } });
    expect(unknown).toMatchObject({ id: BRAND_CARD_ID, alt: "Sheltüh" });
    const brand = (await OrganiserCardImage({
      params: Promise.resolve({ organiserId: "nobody" }),
      id: Promise.resolve(unknown.id),
    })) as Response;
    expect(brand.headers.get("cache-control")).toBe(FALLBACK_CARD_CACHE);
  });

  it("never reads the database", () => {
    expect(getDeps).not.toHaveBeenCalled();
  });
});

describe("dottedText", () => {
  it("puts the brand's dots over every plain vowel and leaves everything else alone", () => {
    expect(dottedText("Neon Static")).toBe("Nëön Stätïc");
    expect(dottedText("UNDER the Sea 2027")).toBe("ÜNDËR thë Sëä 2027");
    expect(dottedText("Sheltüh · café · Rhythm")).toBe("Shëltüh · cäfé · Rhythm");
  });
});
