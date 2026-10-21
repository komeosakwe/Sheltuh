import { VIEW_SOURCES, type ViewSource } from "@/lib/api/types";
import { HttpError, noContentPrivate, readJson } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { parseTrackingCode } from "../tracking-codes";

/**
 * POST /api/events/[eventId]/view — counts one page view (public, no
 * account). Privacy first: nothing about the visitor is read or stored (no
 * cookie, IP, user id or token; the user agent is only checked for bots and
 * never kept). The view lands in a daily aggregate counter.
 *
 * Quiet by design: 204 whether it was counted or not (bot, prefetch, not a
 * same-origin JSON request, body too large, over the event's per-minute cap,
 * a database error); 404 only for an event that isn't published.
 */

/**
 * Views counted per event per window; beyond it they're dropped. Keyed on the
 * event, not on anyone: it bounds how fast any client (or many) can inflate
 * one event's numbers, far above a real event page's traffic.
 */
export const VIEW_RATE_LIMIT = { hits: 300, window: "1 minute" } as const;

/** `{source, code}` is a few dozen bytes; anything much bigger isn't a real beacon. */
export const MAX_VIEW_BODY_BYTES = 1024;

/**
 * Obvious automated clients: crawlers, link-preview fetchers, monitors,
 * headless browsers and HTTP libraries. Not a defence against a determined
 * faker (the per-event cap is), just keeps the honest bots out of the counts.
 */
const BOT_USER_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|archiver|preview|facebookexternalhit|embedly|whatsapp|vkshare|pinterest|monitor|pingdom|uptime|lighthouse|pagespeed|headless|phantomjs|puppeteer|playwright|selenium|curl|wget|python|java\/|okhttp|go-http-client|node-fetch|undici|axios|httpclient|libwww|scrapy|postman|insomnia/i;

export function isLikelyBot(req: Request): boolean {
  const ua = req.headers.get("user-agent")?.trim() ?? "";
  if (!ua || BOT_USER_AGENT.test(ua)) return true;
  // Speculative loads (prefetch/prerender) aren't someone looking at the page.
  const purpose = `${req.headers.get("sec-purpose") ?? ""} ${req.headers.get("purpose") ?? ""} ${req.headers.get("x-purpose") ?? ""}`;
  return /prefetch|prerender|preview/i.test(purpose);
}

/**
 * Only the app's own beacon counts: a same-origin `fetch` with a JSON body
 * (lib/api/analytics.ts). Anything else, such as a cross-site form post or
 * `navigator.sendBeacon` (text/plain), is ignored. Browsers always send
 * Content-Type and, on fetches, Sec-Fetch-Site, which pages can't forge; a
 * missing Sec-Fetch-Site (older browsers, non-browser clients) is let
 * through, since the per-event cap bounds those anyway.
 */
export function isOwnBeacon(req: Request): boolean {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return false;
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

/** The body's source bucket: missing means a direct visit; anything not on the list is "other". */
function parseSource(raw: unknown): ViewSource {
  if (raw === undefined || raw === null || raw === "") return "direct";
  return typeof raw === "string" && (VIEW_SOURCES as readonly string[]).includes(raw) ? (raw as ViewSource) : "other";
}

export const recordEventView: Handler<{ eventId: string }> = async (req, { eventId }, { db }) => {
  if (isLikelyBot(req) || !isOwnBeacon(req)) return noContentPrivate();
  if (!isUuid(eventId)) throw new HttpError(404, "Event not found.");

  let body: Record<string, unknown>;
  try {
    body = await readJson(req, MAX_VIEW_BODY_BYTES);
  } catch {
    // Too large: not a real beacon. Ignored, quietly.
    return noContentPrivate();
  }

  let result: string;
  try {
    [{ result }] = await db.query<{ result: string }>(`select private.record_view($1, $2, $3, $4, $5::interval) as result`, [
      eventId,
      parseSource(body.source),
      parseTrackingCode(body.code),
      VIEW_RATE_LIMIT.hits,
      VIEW_RATE_LIMIT.window,
    ]);
  } catch (err) {
    // A lost view isn't worth an error page. Never log the request itself.
    console.error("Recording a view failed:", err instanceof Error ? err.message : "unknown error");
    return noContentPrivate();
  }
  if (result === "not_found") throw new HttpError(404, "Event not found.");
  return noContentPrivate();
};
