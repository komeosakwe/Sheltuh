import type { Metadata } from "next";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMetadata as eventPageMetadata } from "@/app/events/[slug]/page";
import EventCardImage, { generateImageMetadata as eventCardImages } from "@/app/events/[slug]/opengraph-image";
import { generateMetadata as organiserPageMetadata } from "@/app/organisers/[organiserId]/page";
import OrganiserCardImage, { generateImageMetadata as organiserCardImages } from "@/app/organisers/[organiserId]/opengraph-image";
import { BRAND_CARD_ID } from "@/lib/share-card";
import { eventCardId, organiserCardId } from "@/lib/server/share-card-data";
import { CARD_CACHE, FALLBACK_CARD_CACHE } from "@/lib/server/share-card-render";
import type { Db } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import { adminRejectEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { putEventImage } from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { putMyOrganiserLogo } from "@/lib/server/handlers/organiser-logos";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import {
  findPublicEventCover,
  findPublicEventShare,
  findPublicOrganiserLogo,
  findPublicOrganiserShare,
  liveEventMetadata,
  liveOrganiserMetadata,
} from "@/lib/server/share-metadata";
import {
  EVENT_METADATA_UNAVAILABLE,
  EVENT_NOT_FOUND_METADATA,
  ORGANISER_METADATA_UNAVAILABLE,
  ORGANISER_NOT_FOUND_METADATA,
} from "@/lib/share-metadata";
import { SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/** Demo or live, as the pages decide it (lib/api/client's isApiConfigured), and the live pages' deps. */
const mode = vi.hoisted(() => ({ configured: true, deps: undefined as Deps | undefined }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return mode.configured;
  },
}));
vi.mock("@/lib/server/deps", () => ({
  getDeps: () => {
    if (!mode.deps) throw new Error("Missing required environment variable: DATABASE_URL");
    return mode.deps;
  },
}));

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  mode.configured = true;
  mode.deps = api.deps;
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

const deps = () => api.deps;
const eventMeta = (slug: string, d: () => Pick<Deps, "db" | "siteUrl"> = deps) => liveEventMetadata(slug, d);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function withImage(eventId: string) {
  const res = await api.send(
    putEventImage,
    new Request(`${SITE_URL}/api/events/${eventId}/image`, {
      method: "PUT",
      headers: { authorization: `Bearer ${organiser.token}` },
      body: PNG,
    }),
    { eventId },
  );
  expect(res.status).toBe(200);
}

/** A Db whose every query fails, as during a database outage. */
const failingDb: Db = {
  async query() {
    throw new Error("connect ECONNREFUSED to db.example for someone@example.com");
  },
};

describe("live event metadata (generateMetadata on /events/[slug])", () => {
  it("a published event: title, description, canonical, Open Graph and a large Twitter card", async () => {
    const event = await publishedEvent(api, organiser, admin, {
      description: "Four bands,\n\none warehouse.   Bring earplugs.",
    });
    const url = `${SITE_URL}/events/${event.slug}`;
    // Sat 6 Mar 2027, 8 pm in Melbourne (AEDT).
    const description = "Sat 6 Mar 2027, 8:00 pm · The Tote, Collingwood, VIC. Four bands, one warehouse. Bring earplugs.";

    expect(await eventMeta(event.slug)).toEqual({
      title: "Neon Static — Sheltüh",
      description,
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        url,
        title: "Neon Static — Sheltüh",
        description,
        siteName: "Sheltüh",
        locale: "en_AU",
        // No `images` key at all: the segment's opengraph-image supplies the card.
      },
      twitter: { card: "summary_large_image", title: "Neon Static — Sheltüh", description },
    });
  });

  it("no images of its own, so Next uses the segment's card; the card's cover is the published photo, readable by a crawler", async () => {
    const draft = await draftEvent(api, organiser);
    await withImage(draft.eventId);
    // Its tickets are paid (eventInput), which needs payouts to be submitted.
    await setUpPayouts(api, organiser.organiserId);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });

    // In review: no cover is readable yet, and the metadata is the generic one.
    expect(await findPublicEventCover(api.db, draft.slug)).toBeNull();
    expect(await eventMeta(draft.slug)).toEqual(EVENT_NOT_FOUND_METADATA);

    const { adminApproveEvent } = await import("@/lib/server/handlers/admin");
    await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });

    const metadata = await eventMeta(draft.slug);
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");

    const cover = await findPublicEventCover(api.db, draft.slug);
    expect(Array.from(cover!.bytes)).toEqual(Array.from(PNG));
    expect(cover!.focus).toBeNull();

    // The share fields carry the photo's versioned address (the card's cache key), the same one the public event shape gives the page.
    const { getPublicEventBySlug } = await import("@/lib/server/handlers/public-events");
    const shown = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect((await findPublicEventShare(api.db, draft.slug))?.imageUrl).toBe(shown.body.imageUrl);
  });

  it("holds nothing about tickets, buyers or the organiser's account", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const text = JSON.stringify(await eventMeta(event.slug));
    for (const secret of [organiser.organiserId, organiser.userId, "General admission", "3000", "A$30", "@example.com", application.contactEmail]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("a long description is cut at a word, with the whole description at most 200 characters", async () => {
    const long = `${"Loud guitars and analog synths. ".repeat(20)}The end.`;
    const event = await publishedEvent(api, organiser, admin, { description: long });
    const { description } = await eventMeta(event.slug);
    expect(description!.length).toBeLessThanOrEqual(200);
    expect(description).toMatch(/^Sat 6 Mar 2027, 8:00 pm · The Tote, Collingwood, VIC\. Loud guitars/);
    expect(description).toMatch(/[a-z]…$/);
  });

  it("draft, in review, rejected, unpublished, unknown and malformed slugs: one noindex 'not found', no details", async () => {
    const draft = await draftEvent(api, organiser, { title: "Secret Draft" });
    const pending = await draftEvent(api, organiser, { title: "Secret Pending" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const rejected = await draftEvent(api, organiser, { title: "Secret Rejected" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: rejected.eventId }, body: { reason: "x" } });
    const unpublished = await publishedEvent(api, organiser, admin, { title: "Taken Down" });
    expect((await eventMeta(unpublished.slug)).title).toBe("Taken Down — Sheltüh");
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: unpublished.eventId }, method: "POST" });

    const slugs = [draft.slug, pending.slug, rejected.slug, unpublished.slug, "never-existed", "NEON'; --", "a".repeat(500)];
    for (const slug of slugs) {
      const metadata = await eventMeta(slug);
      expect(metadata, slug).toEqual(EVENT_NOT_FOUND_METADATA);
    }
    expect(EVENT_NOT_FOUND_METADATA).toEqual({ title: "Event not found — Sheltüh", robots: { index: false, follow: false } });
  });

  it("a database error: generic metadata (no 500, not noindex), logged without details", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await eventMeta(event.slug, () => ({ db: failingDb, siteUrl: () => SITE_URL }))).toEqual(
        EVENT_METADATA_UNAVAILABLE,
      );
      expect(EVENT_METADATA_UNAVAILABLE).toEqual({ title: "Sheltüh" });
      // An unconfigured server (getDeps throws) is the same.
      expect(
        await eventMeta(event.slug, () => {
          throw new Error("Missing required environment variable: DATABASE_URL");
        }),
      ).toEqual(EVENT_METADATA_UNAVAILABLE);
      expect(error).toHaveBeenCalledTimes(2);
      expect(error.mock.calls[0][1]).not.toContain("someone@example.com");
    } finally {
      error.mockRestore();
    }
  });

  it("reads the share fields under the page's visibility rule only", async () => {
    const event = await publishedEvent(api, organiser, admin);
    expect(await findPublicEventShare(api.db, event.slug)).toEqual({
      slug: event.slug,
      title: "Neon Static",
      description: "Four bands, one warehouse.",
      venueName: "The Tote",
      suburb: "Collingwood",
      timeZone: "Australia/Melbourne",
      state: "VIC",
      startsAt: "2027-03-06T09:00:00.000Z",
    });
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    expect(await findPublicEventShare(api.db, event.slug)).toBeNull();
  });
});

describe("the event page's generateMetadata", () => {
  const pageMeta = (slug: string): Promise<Metadata> => eventPageMetadata({ params: Promise.resolve({ slug }) });

  it("live: the database's published event, without images (the segment's card supplies them)", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const metadata = await pageMeta(event.slug);
    expect(metadata.title).toBe("Neon Static — Sheltüh");
    expect(metadata.alternates).toEqual({ canonical: `${SITE_URL}/events/${event.slug}` });
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}/events/${event.slug}` });
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(await pageMeta("never-existed")).toEqual(EVENT_NOT_FOUND_METADATA);
  });

  it("live, server misconfigured: generic metadata, no error thrown", async () => {
    mode.deps = undefined;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await pageMeta("neon-static")).toEqual(EVENT_METADATA_UNAVAILABLE);
    } finally {
      error.mockRestore();
    }
  });
});

describe("live organiser metadata (generateMetadata on /organisers/[organiserId])", () => {
  const orgMeta = (id: string, d: () => Pick<Deps, "db" | "siteUrl"> = deps) => liveOrganiserMetadata(id, d);

  it("an approved organiser: name, bio excerpt and canonical, no images (the segment's card supplies them)", async () => {
    const url = `${SITE_URL}/organisers/${organiser.organiserId}`;
    const description = "Warehouse gigs in Collingwood.";
    expect(await orgMeta(organiser.organiserId)).toEqual({
      title: "Static Collective — Sheltüh",
      description,
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        url,
        title: "Static Collective — Sheltüh",
        description,
        siteName: "Sheltüh",
        locale: "en_AU",
      },
      twitter: { card: "summary_large_image", title: "Static Collective — Sheltüh", description },
    });
    const viaPage = await organiserPageMetadata(
      { params: Promise.resolve({ organiserId: organiser.organiserId }), searchParams: Promise.resolve({}) },
    );
    expect(viaPage.alternates).toEqual({ canonical: url });
  });

  it("pending, unknown or not a uuid: one noindex 'not available'", async () => {
    const applicant = await api.signUp();
    const applied = await api.call(applyAsOrganiser, {
      token: applicant.token,
      body: { ...application, displayName: "Pending Secret" },
    });
    for (const id of [applied.body.organiserId as string, crypto.randomUUID(), "not-a-uuid"]) {
      expect(await orgMeta(id), id).toEqual(ORGANISER_NOT_FOUND_METADATA);
    }
    expect(ORGANISER_NOT_FOUND_METADATA.robots).toEqual({ index: false, follow: false });
  });

  it("a database error: the plain title", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await orgMeta(organiser.organiserId, () => ({ db: failingDb, siteUrl: () => SITE_URL }))).toEqual(
        ORGANISER_METADATA_UNAVAILABLE,
      );
    } finally {
      error.mockRestore();
    }
  });
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const isPng = async (res: Response) => Array.from(new Uint8Array(await res.arrayBuffer()).slice(0, 4));

/** A real, small image: sharp decodes the cards' photo and logo. */
const photo = (format: "png" | "webp" | "jpeg", width = 400, height = 300) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    [format]()
    .toBuffer();

describe("the event's preview card (app/events/[slug]/opengraph-image.tsx)", () => {
  const cardFor = async (slug: string, id?: string) => {
    const [image] = await eventCardImages({ params: { slug } });
    return EventCardImage({
      params: Promise.resolve({ slug }),
      id: Promise.resolve(id ?? image.id),
    }) as Promise<Response>;
  };

  async function publishWithPhoto(bytes: Buffer, title = "Neon Static") {
    const draft = await draftEvent(api, organiser, { title });
    const put = await api.send(
      putEventImage,
      new Request(`${SITE_URL}/api/events/${draft.eventId}/image`, {
        method: "PUT",
        headers: { authorization: `Bearer ${organiser.token}` },
        body: new Uint8Array(bytes),
      }),
      { eventId: draft.eventId },
    );
    expect(put.status).toBe(200);
    await setUpPayouts(api, organiser.organiserId);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const { adminApproveEvent } = await import("@/lib/server/handlers/admin");
    await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });
    return draft;
  }

  it("a published event with a WebP or JPEG cover: a 1200 x 630 PNG, with its title as the image's alt", async () => {
    for (const format of ["webp", "jpeg"] as const) {
      await reset();
      api = new TestApi(api.db);
      mode.deps = api.deps;
      admin = await signUpAdmin(api);
      organiser = await approvedOrganiser(api, admin);
      const event = await publishWithPhoto(await photo(format), "Neon Static");
      const [image] = await eventCardImages({ params: { slug: event.slug } });
      expect(image).toMatchObject({ alt: "Neon Static", contentType: "image/png", size: { width: 1200, height: 630 } });
      expect(image.id).not.toBe(BRAND_CARD_ID);

      const res = await cardFor(event.slug);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe(CARD_CACHE);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(Array.from(bytes.subarray(0, 4)), format).toEqual(PNG_SIGNATURE);
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 1200, height: 630 });
    }
  });

  it("a published event without a photo: the orange card, with its own id", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const res = await cardFor(event.slug);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(CARD_CACHE);
    expect(await isPng(res)).toEqual(PNG_SIGNATURE);
  });

  it("its id changes with the photo, so the card's URL does too", async () => {
    const event = await publishWithPhoto(await photo("png"));
    const before = eventCardId((await findPublicEventShare(api.db, event.slug))!);
    // Same inputs, same id.
    expect(eventCardId((await findPublicEventShare(api.db, event.slug))!)).toBe(before);
    const share = (await findPublicEventShare(api.db, event.slug))!;
    expect(eventCardId({ ...share, imageUrl: `${share.imageUrl}1` })).not.toBe(before);
    expect(eventCardId({ ...share, title: "Another Title" })).not.toBe(before);
  });

  it("draft, in review, rejected, unpublished and unknown slugs: the plain brand card, never a title", async () => {
    const draft = await draftEvent(api, organiser, { title: "Secret Draft" });
    const unpublished = await publishedEvent(api, organiser, admin, { title: "Taken Down" });
    const fullCard = await cardFor(unpublished.slug);
    const fullId = (await eventCardImages({ params: { slug: unpublished.slug } }))[0].id;
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: unpublished.eventId }, method: "POST" });
    expect(fullCard.headers.get("cache-control")).toBe(CARD_CACHE);

    for (const slug of [draft.slug, unpublished.slug, "never-existed", "NEON'; --"]) {
      const images = await eventCardImages({ params: { slug } });
      expect(images, slug).toHaveLength(1);
      expect(images[0], slug).toMatchObject({ id: BRAND_CARD_ID, alt: "Sheltüh" });
      expect(JSON.stringify(images)).not.toMatch(/Secret Draft|Taken Down/);
      const res = await cardFor(slug);
      expect(res.status, slug).toBe(200);
      expect(res.headers.get("content-type"), slug).toBe("image/png");
      expect(res.headers.get("cache-control"), slug).toBe(FALLBACK_CARD_CACHE);
    }
    // The old card's id no longer draws the unpublished event.
    const stale = await cardFor(unpublished.slug, fullId);
    expect(stale.headers.get("cache-control")).toBe(FALLBACK_CARD_CACHE);
  });

  it("a database error: the brand card (briefly cached), no 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mode.deps = { ...api.deps, db: failingDb };
      const [image] = await eventCardImages({ params: { slug: "neon-static" } });
      expect(image.id).toBe(BRAND_CARD_ID);
      const res = await cardFor("neon-static");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(FALLBACK_CARD_CACHE);
      expect(JSON.stringify(error.mock.calls)).not.toContain("someone@example.com");
    } finally {
      error.mockRestore();
    }
  });

  it("a cover that can't be decoded: the card without it, not an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A valid JPEG header with nothing after it: accepted as an upload, but not drawable.
      const event = await publishWithPhoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
      const res = await cardFor(event.slug);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe(CARD_CACHE);
    } finally {
      error.mockRestore();
    }
  });
});

describe("the organiser's preview card (app/organisers/[organiserId]/opengraph-image.tsx)", () => {
  const cardFor = async (organiserId: string, id?: string) => {
    const [image] = await organiserCardImages({ params: { organiserId } });
    return OrganiserCardImage({
      params: Promise.resolve({ organiserId }),
      id: Promise.resolve(id ?? image.id),
    }) as Promise<Response>;
  };

  async function addLogo() {
    const res = await api.send(
      putMyOrganiserLogo,
      new Request(`${SITE_URL}/api/test`, {
        method: "PUT",
        headers: { authorization: `Bearer ${organiser.token}` },
        body: new Uint8Array(await photo("webp", 600, 400)),
      }),
    );
    expect(res.status).toBe(200);
  }

  it("an approved organiser, without or with a logo: a PNG named for them, a new id once they add a logo", async () => {
    const [plain] = await organiserCardImages({ params: { organiserId: organiser.organiserId } });
    expect(plain).toMatchObject({ alt: "Static Collective", contentType: "image/png", size: { width: 1200, height: 630 } });
    expect(plain.id).not.toBe(BRAND_CARD_ID);
    const without = await cardFor(organiser.organiserId);
    expect(without.headers.get("content-type")).toBe("image/png");
    expect(without.headers.get("cache-control")).toBe(CARD_CACHE);
    expect(await findPublicOrganiserLogo(api.db, organiser.organiserId)).toBeNull();
    expect((await findPublicOrganiserShare(api.db, organiser.organiserId))?.logoVersion).toBeUndefined();

    await addLogo();
    const share = await findPublicOrganiserShare(api.db, organiser.organiserId);
    expect(share?.logoVersion).toMatch(/^\d+$/);
    expect(organiserCardId(share!)).not.toBe(plain.id);
    const logo = await findPublicOrganiserLogo(api.db, organiser.organiserId);
    expect((await sharp(Buffer.from(logo!)).metadata()).format).toBe("webp");

    const withLogo = await cardFor(organiser.organiserId);
    expect(withLogo.headers.get("cache-control")).toBe(CARD_CACHE);
    const bytes = Buffer.from(await withLogo.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 4))).toEqual(PNG_SIGNATURE);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1200, height: 630 });
  });

  it("pending, unknown or not a uuid: the plain brand card, never the name or the logo", async () => {
    const applicant = await api.signUp();
    const applied = await api.call(applyAsOrganiser, {
      token: applicant.token,
      body: { ...application, displayName: "Pending Secret" },
    });
    for (const id of [applied.body.organiserId as string, crypto.randomUUID(), "not-a-uuid"]) {
      const images = await organiserCardImages({ params: { organiserId: id } });
      expect(images, id).toEqual([expect.objectContaining({ id: BRAND_CARD_ID, alt: "Sheltüh" })]);
      expect(JSON.stringify(images)).not.toContain("Pending Secret");
      expect((await cardFor(id)).headers.get("cache-control"), id).toBe(FALLBACK_CARD_CACHE);
      expect(await findPublicOrganiserLogo(api.db, id)).toBeNull();
    }
  });
});
