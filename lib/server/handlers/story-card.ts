import { isApiConfigured } from "@/lib/api/client";
import { getEventBySlug } from "@/lib/data";
import {
  demoCardNow,
  isStoryCardFormat,
  STORY_CARD_FORMATS,
  storyCardFileName,
  storyCardFreshSeconds,
  storyCardTag,
  storyCardText,
  storyCardVersion,
  type StoryCardEventFields,
  type StoryCardFormat,
} from "@/lib/story-card";
import { rateLimitSecret, takeClientLimit, type KeyedLimit } from "../client-limits";
import { errorJson, HttpError, retryAfterHeader, tooManyRequests, windowSeconds } from "../http";
import { parseIfNoneMatch } from "../if-none-match";
import { errorMessageForLog, route, type Handler } from "../route";
import { findPublicEventCover } from "../share-metadata";
import { readDemoPhoto, type PhotoFocus } from "../share-card-data";
import { findStoryCardEvent } from "../story-card-data";
import { drawStoryCard, inStoryCardSlot, type StoryCardRequest } from "../story-card-render";

/**
 * GET /events/{slug}/story-card?format=story|square: the "I’m going." story card as a JPEG
 * (docs/design/story-card.md; docs/architecture.md, "Story card"). A page-level route, like the
 * .ics file: the demo build may not call /api/*, and the path has no image extension, so the
 * service worker (public/sw.js) never keeps a copy with a stale tag.
 *
 * Public for each published event that hasn't ended (owner decision, 24 Nov: the card holds only
 * public event fields, so it isn't gated to ticket holders; only the UI that offers it is). It
 * reads no token or cookie, so every caller gets the same bytes, and the CDN may share them until
 * the tag can next change (at most an hour). Everything else is one 404.
 *
 *   400  `format` missing or not story/square, or any other query parameter, as the handler sees
 *        the query. That's after Next has normalised it (server-utils.js normalizeCdnUrl: parsed
 *        and re-formatted, so percent-escapes are decoded, an empty trailing `&` is gone and
 *        `nxtP…` keys are dropped). So `?x=1` is refused, but other spellings of the canonical
 *        URL (`?format=story&`, `?format=st%6Fry`, `?format=story&nxtPa=1`, an escaped slug)
 *        still reach the handler as the canonical one and get a card: each is its own CDN key,
 *        so each is drawn once more. Accepted: more keys means more draws, still capped by the
 *        per-client limit and the instance's render slots (docs/architecture.md, "Story card").
 *   404  malformed or unknown slug, not published (draft, in review, rejected, unpublished),
 *        ended: the same body for all
 *   304  If-None-Match names the current version: before any photo is read, any rate-limit hit
 *        is taken, or anything is drawn
 *   429  over STORY_CARD_RATE_LIMIT renders from this client (live only; fails open like the others)
 *   503  the instance's render slots are full (Retry-After). The slot is taken before the
 *        rate-limit write and the photo read, so a refused flood does no database work beyond
 *        the visibility read
 *   500  the drawing failed (logged without details)
 */

const NOT_FOUND = "Event not found.";

/** Renders per client (its keyed IP address), per fixed window: a card is about a second of CPU. Only real renders count, never a 304. */
export const STORY_CARD_RATE_LIMIT: KeyedLimit = { bucket: "story_cards", hits: 20, window: "10 minutes" };

const RATE_LIMITED = "You've made a lot of story cards. Try again in a few minutes.";

/**
 * The Retry-After of the 503 when the render slots are full: a full queue (2 drawing, 6 waiting,
 * about a second each) clears in seconds, so half a minute leaves room without sending people
 * away for long.
 */
export const STORY_CARD_BUSY_RETRY_SECONDS = 30;

/** The only query this address takes. */
const badQuery = () =>
  new HttpError(400, "Choose a card format.", { format: `Use ?format=${STORY_CARD_FORMATS.join(" or ?format=")}, and nothing else.` });

/** The card's format from the query: exactly one `format`, story or square, and no other parameter (400 otherwise). */
export function storyCardFormat(url: string): StoryCardFormat {
  const params = new URL(url).searchParams;
  const keys = [...params.keys()];
  const value = params.get("format");
  if (keys.length !== 1 || keys[0] !== "format" || !isStoryCardFormat(value)) throw badQuery();
  return value;
}

/**
 * A 200's (and a 304's) Cache-Control: the browser asks again every time (`max-age=0`, answered by
 * the CDN with a 304 while its copy is fresh), the CDN keeps it `seconds` (storyCardFreshSeconds:
 * at most an hour, never past the next tag change). No stale-while-revalidate: a stale copy
 * could show yesterday's tag.
 */
export function storyCardCacheControl(seconds: number): string {
  return `public, max-age=0, s-maxage=${Math.max(1, Math.floor(seconds))}`;
}

/** The event a card is drawn for: its public fields, its photo's version and focus, and where its bytes come from. */
interface CardSource {
  slug: string;
  fields: StoryCardEventFields;
  imageVersion: string | null;
  focus: PhotoFocus;
  /** The photo's bytes and focus; called only for a photo (`imageVersion`) and only when a card is drawn. */
  readPhoto: () => Promise<{ bytes: Uint8Array; focus: PhotoFocus } | null>;
  /** True when a photo that was there has gone (the event was unpublished between the reads): a 404, not a card without it. */
  photoRequired: boolean;
}

export interface StoryCardOptions {
  /** The clock (tests). */
  now?: () => Date;
  /** Draws the card, inside the route's render slot (default drawStoryCard; tests: a stand-in that doesn't render). */
  make?: (request: StoryCardRequest) => Promise<Buffer>;
}

/** The slug as it may appear in a header's file name: slugs are `[a-z0-9-]` already; anything else is replaced, never quoted. */
const headerSlug = (slug: string) => slug.replace(/[^a-z0-9-]/g, "-");

/**
 * The card's response for `source` at `cardNow` (the demo's clock differs from the real one;
 * `started` is the real clock's reading `cardNow` was taken from): the 404 for an ended event,
 * the 304, then a render slot and, inside it, `beforeRender` (the rate limit), the photo and the drawing.
 */
async function cardResponse(
  req: Request,
  format: StoryCardFormat,
  source: CardSource,
  { cardNow, started, clock }: { cardNow: Date; started: number; clock: () => Date },
  draw: (request: StoryCardRequest) => Promise<Buffer>,
  beforeRender: () => Promise<void>,
): Promise<Response> {
  const tag = storyCardTag(source.fields, cardNow);
  if (tag === null) throw new HttpError(404, NOT_FOUND);
  const text = storyCardText(source.fields);
  const version = storyCardVersion({ format, text, tag, imageVersion: source.imageVersion, focus: source.focus });
  const fresh = storyCardFreshSeconds(source.fields, cardNow);

  // Time spent here comes off the CDN window, so a card drawn across a tag change (midnight, the
  // start) is never kept past it.
  const headers = () => {
    const spent = Math.ceil(Math.max(0, clock().getTime() - started) / 1000);
    return {
      "content-type": "image/jpeg",
      "cache-control": storyCardCacheControl(fresh - spent),
      etag: `"${version}"`,
      "content-disposition": `inline; filename="${storyCardFileName(headerSlug(source.slug), format)}"`,
      "x-content-type-options": "nosniff",
      // Shared by people on social media, not a page to find in image search.
      "x-robots-tag": "noindex",
    };
  };

  const claim = parseIfNoneMatch(req.headers.get("if-none-match"));
  if (claim === "*" || claim.includes(version)) return new Response(null, { status: 304, headers: headers() });

  // A render slot first, then the database work (the rate-limit write, the photo read) and the
  // drawing inside it: a flood refused because the slots are full costs the database nothing more
  // than the visibility read above.
  let jpeg: Buffer;
  try {
    jpeg = await inStoryCardSlot(async () => {
      await beforeRender();
      let photo: StoryCardRequest["photo"] = null;
      if (source.imageVersion !== null) {
        photo = await source.readPhoto();
        if (!photo && source.photoRequired) throw new HttpError(404, NOT_FOUND);
      }
      return draw({ format, text, tag, photo });
    });
  } catch (err) {
    // The render slots are full: say when to come back (runHandler adds Retry-After only to a 429).
    if (err instanceof HttpError && err.statusCode === 503) {
      throw new HttpError(503, err.message, undefined, undefined, retryAfterHeader(STORY_CARD_BUSY_RETRY_SECONDS));
    }
    throw err;
  }
  return new Response(new Uint8Array(jpeg), { status: 200, headers: headers() });
}

/**
 * Live mode: a published event (findStoryCardEvent), drawn at the real clock. Its photo is read
 * from the database only for a card that's drawn (findPublicEventCover: the same published rule).
 * Each draw takes one hit on the client's STORY_CARD_RATE_LIMIT.
 */
export function storyCardHandler(options: StoryCardOptions = {}): Handler<{ slug: string }> {
  const clock = options.now ?? (() => new Date());
  const make = options.make ?? drawStoryCard;
  return async (req, { slug }, deps) => {
    const format = storyCardFormat(req.url);
    const event = await findStoryCardEvent(deps.db, slug);
    if (!event) throw new HttpError(404, NOT_FOUND);
    const source: CardSource = {
      slug: event.slug,
      fields: event,
      imageVersion: event.imageVersion,
      focus: event.focus,
      readPhoto: () => findPublicEventCover(deps.db, event.slug),
      photoRequired: true,
    };
    const now = clock();
    return cardResponse(req, format, source, { cardNow: now, started: now.getTime(), clock }, make, async () => {
      const secret = rateLimitSecret(deps, "the story card rate limit was skipped");
      if (!(await takeClientLimit(req, deps, secret, STORY_CARD_RATE_LIMIT, "A story card"))) {
        throw tooManyRequests(RATE_LIMITED, windowSeconds(STORY_CARD_RATE_LIMIT.window));
      }
    });
  };
}

export const getStoryCard = storyCardHandler();

/**
 * Demo mode (no Supabase): the sample events, their photos from public/events/ (readDemoPhoto),
 * drawn at the demo clock (demoCardNow: 3 days before the start, so the past samples still have a
 * card, "In 3 days"). No database, so no rate limit; the render slots still apply.
 */
export function demoStoryCard(options: StoryCardOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const make = options.make ?? drawStoryCard;
  return async (req: Request, { slug }: { slug: string }): Promise<Response> => {
    try {
      const format = storyCardFormat(req.url);
      const event = await getEventBySlug(slug);
      if (!event) throw new HttpError(404, NOT_FOUND);
      const imageUrl = event.imageUrl ?? null;
      const focus = event.imageFocus ?? null;
      const source: CardSource = {
        slug: event.slug,
        fields: event,
        // The sample photo's path is its version: the samples never change while a demo runs.
        imageVersion: imageUrl,
        focus,
        readPhoto: async () => {
          const bytes = imageUrl ? await readDemoPhoto(imageUrl) : null;
          return bytes ? { bytes, focus } : null;
        },
        photoRequired: false,
      };
      const now = clock();
      const timing = { cardNow: demoCardNow(event, now), started: now.getTime(), clock };
      return await cardResponse(req, format, source, timing, make, async () => {});
    } catch (err) {
      if (err instanceof HttpError) return errorJson(err.statusCode, { error: err.message, fieldErrors: err.fieldErrors }, err.headers);
      console.error("Demo story card failed:", errorMessageForLog(err));
      return errorJson(500, { error: "Something went wrong." });
    }
  };
}

export const getDemoStoryCard = demoStoryCard();

const liveStoryCard = route(getStoryCard);

/** The route export (app/events/[slug]/story-card/route.ts): demo or live, as the event page decides. */
export async function storyCardRoute(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!isApiConfigured) return getDemoStoryCard(req, await ctx.params);
  return liveStoryCard(req, ctx);
}
