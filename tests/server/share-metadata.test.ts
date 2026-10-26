import type { Metadata, ResolvingMetadata } from "next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMetadata as eventPageMetadata } from "@/app/events/[slug]/page";
import { generateMetadata as organiserPageMetadata } from "@/app/organisers/[organiserId]/page";
import type { Db } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import { adminRejectEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { runHandler } from "@/lib/server/route";
import { findPublicEventShare, liveEventMetadata, liveOrganiserMetadata } from "@/lib/server/share-metadata";
import {
  EVENT_METADATA_UNAVAILABLE,
  EVENT_NOT_FOUND_METADATA,
  type InheritedShareImages,
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

/** The site's share image, as the root segment's opengraph-image / twitter-image resolve. */
const SITE_OG_IMAGE = { url: `${SITE_URL}/opengraph-image?abc123`, width: 1200, height: 630, alt: "Sheltüh", type: "image/png" };
const SITE_TWITTER_IMAGE = { url: `${SITE_URL}/twitter-image?abc123`, width: 1200, height: 630, alt: "Sheltüh", type: "image/png" };
const FALLBACK: InheritedShareImages = { openGraph: [SITE_OG_IMAGE], twitter: [SITE_TWITTER_IMAGE] };
const parent = Promise.resolve({
  openGraph: { images: [SITE_OG_IMAGE] },
  twitter: { images: [SITE_TWITTER_IMAGE] },
}) as unknown as ResolvingMetadata;

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
const eventMeta = (slug: string, d: () => Pick<Deps, "db" | "siteUrl"> = deps) => liveEventMetadata(slug, FALLBACK, d);

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
        // No cover image: the site's own share image.
        images: [SITE_OG_IMAGE],
      },
      twitter: { card: "summary_large_image", title: "Neon Static — Sheltüh", description, images: [SITE_TWITTER_IMAGE] },
    });
  });

  it("its cover image as an absolute, versioned URL that anyone (a crawler) can fetch", async () => {
    const draft = await draftEvent(api, organiser);
    await withImage(draft.eventId);
    // Its tickets are paid (eventInput), which needs payouts to be submitted.
    await setUpPayouts(api, organiser.organiserId);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const { adminApproveEvent } = await import("@/lib/server/handlers/admin");
    await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });

    const metadata = await eventMeta(draft.slug);
    const og = metadata.openGraph as { images: { url: string; alt: string; type: string }[] };
    expect(og.images).toHaveLength(1);
    const [image] = og.images;
    expect(image.url).toMatch(new RegExp(`^${SITE_URL}/api/events/${draft.eventId}/image\\?v=\\d+$`));
    expect(image).toMatchObject({ alt: "Neon Static", type: "image/png" });
    expect((metadata.twitter as { images: unknown[] }).images).toEqual([image]);

    // The same URL the public event shape gives the page.
    const { getPublicEventBySlug } = await import("@/lib/server/handlers/public-events");
    const shown = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(`${SITE_URL}${shown.body.imageUrl}`).toBe(image.url);

    // Served without a token, publicly cacheable.
    const path = new URL(image.url);
    const res = await runHandler(getEventImage, new Request(path), { eventId: draft.eventId }, api.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
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
  const pageMeta = (slug: string): Promise<Metadata> => eventPageMetadata({ params: Promise.resolve({ slug }) }, parent);

  it("live: the database's published event, with the inherited site image", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const metadata = await pageMeta(event.slug);
    expect(metadata.title).toBe("Neon Static — Sheltüh");
    expect(metadata.alternates).toEqual({ canonical: `${SITE_URL}/events/${event.slug}` });
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}/events/${event.slug}`, images: [SITE_OG_IMAGE] });
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
  const orgMeta = (id: string, d: () => Pick<Deps, "db" | "siteUrl"> = deps) => liveOrganiserMetadata(id, FALLBACK, d);

  it("an approved organiser: name, bio excerpt, canonical and the site image", async () => {
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
        images: [SITE_OG_IMAGE],
      },
      twitter: { card: "summary_large_image", title: "Static Collective — Sheltüh", description, images: [SITE_TWITTER_IMAGE] },
    });
    const viaPage = await organiserPageMetadata(
      { params: Promise.resolve({ organiserId: organiser.organiserId }), searchParams: Promise.resolve({}) },
      parent,
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
