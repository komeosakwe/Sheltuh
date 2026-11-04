import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isApiConfigured } from "@/lib/api/client";
import { getEventBySlug } from "@/lib/data";
import { getSampleOrganiser } from "@/lib/sample-organisers";
import { BRAND_CARD_ID, cardVersion, eventCardDetail, SHARE_CARD_SIZE } from "@/lib/share-card";
import type { EventShareFields, OrganiserShareFields } from "@/lib/share-metadata";
import { getDeps } from "./deps";
import { redactForLog } from "./email-address";
import { isUuid } from "./pagination";
import { findPublicEventCover, findPublicOrganiserLogo, findPublicOrganiserShare, readPublicEventShare } from "./share-metadata";

/**
 * What the link-preview cards draw (lib/server/share-card-render.tsx), read
 * server-side: the fields from the same visibility-gated reads the pages'
 * metadata uses (lib/server/share-metadata.ts: a published event, an
 * approved organiser), and the photo or logo straight from the database (or,
 * in demo mode, from public/), never by fetching this site over HTTP. Satori
 * (next/og) can't draw WebP, and an event photo can be one, so every image
 * is re-encoded here with sharp first.
 *
 * Nothing here throws to its caller for a missing or unreadable thing: an
 * unknown, unpublished or unreadable slug is `null` (the plain brand card),
 * and a photo that can't be read is `null` (the card without it).
 */

const { width: CARD_WIDTH, height: CARD_HEIGHT } = SHARE_CARD_SIZE;

/** Largest decoded image drawn, in pixels (the same cap as uploads: lib/server/avatar.ts). */
const MAX_INPUT_PIXELS = 24_000_000;

/** The logo's side on the card, in pixels, drawn at half this (crisp on high-density previews). */
const LOGO_PX = 320;

function logFailure(what: string, err: unknown) {
  console.error(`${what} preview card unavailable:`, redactForLog(err instanceof Error ? err.message : "unknown error"));
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * A photo as a 1200 × 630 JPEG data URL, covering the card and cropped so the
 * photo's focus point (percent from the left and top, as the site's own
 * object-position: default the middle) stays in view. Null if it can't be decoded.
 */
export async function coverToCardImage(bytes: Uint8Array, focus: { x: number; y: number } | null): Promise<string | null> {
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const { width = 0, height = 0, orientation = 1 } = await image.metadata();
    // EXIF orientations 5-8 are turned a quarter: rotate() swaps the sides.
    const [w, h] = orientation >= 5 ? [height, width] : [width, height];
    if (w < 1 || h < 1) return null;
    const scale = Math.max(CARD_WIDTH / w, CARD_HEIGHT / h);
    const scaledWidth = Math.max(CARD_WIDTH, Math.round(w * scale));
    const scaledHeight = Math.max(CARD_HEIGHT, Math.round(h * scale));
    const fx = Math.min(100, Math.max(0, focus?.x ?? 50)) / 100;
    const fy = Math.min(100, Math.max(0, focus?.y ?? 50)) / 100;
    const jpeg = await image
      .rotate()
      .resize(scaledWidth, scaledHeight, { fit: "fill" })
      .extract({
        left: Math.round(fx * (scaledWidth - CARD_WIDTH)),
        top: Math.round(fy * (scaledHeight - CARD_HEIGHT)),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      })
      .flatten({ background: "#000000" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return dataUrl("image/jpeg", jpeg);
  } catch (err) {
    logFailure("Cover photo", err);
    return null;
  }
}

/** A logo as a square PNG data URL (transparency kept), or null if it can't be decoded. */
export async function logoToCardImage(bytes: Uint8Array): Promise<string | null> {
  try {
    const png = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(LOGO_PX, LOGO_PX, { fit: "cover" })
      .png()
      .toBuffer();
    return dataUrl("image/png", png);
  } catch (err) {
    logFailure("Logo", err);
    return null;
  }
}

/** The demo's sample photos live in public/events/: a path like that and no other is read. */
const DEMO_PHOTO_PATH = /^\/events\/[A-Za-z0-9._-]+$/;

async function readDemoPhoto(imageUrl: string): Promise<Uint8Array | null> {
  if (!DEMO_PHOTO_PATH.test(imageUrl)) return null;
  try {
    return await readFile(path.join(process.cwd(), "public", imageUrl));
  } catch {
    return null;
  }
}

/** The card id that goes with an event: new whenever its title, date, place or photo changes. */
export function eventCardId(event: EventShareFields): string {
  return cardVersion(event.title, eventCardDetail(event), event.imageUrl);
}

/** The card id that goes with an organiser: new whenever their name or logo changes. */
export function organiserCardId(organiser: OrganiserShareFields): string {
  return cardVersion(organiser.displayName, organiser.logoVersion);
}

/**
 * The event a card is for, or null: unknown slug, anything not published
 * (live: the page's own visibility rule; demo: the sample events), or an error
 * (logged without details). Memoised for a render when live.
 */
export async function readEventForCard(slug: string): Promise<EventShareFields | null> {
  try {
    if (!isApiConfigured) return (await getEventBySlug(slug)) ?? null;
    return await readPublicEventShare(getDeps().db, slug);
  } catch (err) {
    logFailure("Event", err);
    return null;
  }
}

/** The event's cover photo drawn for the card, or null (no photo, or not readable). */
export async function readEventCardPhoto(slug: string, event: EventShareFields): Promise<string | null> {
  try {
    if (!isApiConfigured) {
      const bytes = event.imageUrl ? await readDemoPhoto(event.imageUrl) : null;
      return bytes ? await coverToCardImage(bytes, null) : null;
    }
    if (!event.imageUrl) return null;
    const cover = await findPublicEventCover(getDeps().db, slug);
    return cover ? await coverToCardImage(cover.bytes, cover.focus) : null;
  } catch (err) {
    logFailure("Event photo", err);
    return null;
  }
}

/** The organiser a card is for, or null: unknown, not approved, not a uuid, or an error (logged without details). */
export async function readOrganiserForCard(organiserId: string): Promise<OrganiserShareFields | null> {
  try {
    if (!isApiConfigured) {
      const sample = getSampleOrganiser(organiserId);
      return sample ? { organiserId, displayName: sample.profile.displayName, description: sample.profile.description } : null;
    }
    return await findPublicOrganiserShare(getDeps().db, organiserId);
  } catch (err) {
    logFailure("Organiser", err);
    return null;
  }
}

/** The organiser's logo drawn for the card, or null (none, or not readable). Live only: the demo's organisers have none. */
export async function readOrganiserCardLogo(organiser: OrganiserShareFields): Promise<string | null> {
  if (!isApiConfigured || !organiser.logoVersion || !isUuid(organiser.organiserId)) return null;
  try {
    const bytes = await findPublicOrganiserLogo(getDeps().db, organiser.organiserId);
    return bytes ? await logoToCardImage(bytes) : null;
  } catch (err) {
    logFailure("Organiser logo", err);
    return null;
  }
}

/** The one image of a segment with nothing to show: the plain brand card. */
export const BRAND_CARD_IMAGE = {
  id: BRAND_CARD_ID,
  alt: "Sheltüh",
  size: SHARE_CARD_SIZE,
  contentType: "image/png",
} as const;
