import { MAX_TRACKING_LINKS_PER_EVENT, type TrackingLink } from "@/lib/api/types";
import { requireCaller } from "../auth";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { createdPrivate, HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { generateTrackingCode } from "../tracking-codes";
import type { EventRecord } from "../types";
import { fail } from "../validation";
import { ORGANISER_GROSS } from "./analytics";
import { requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";

/**
 * Tracking links (docs/architecture.md, "Organiser analytics"): up to 20
 * labelled codes per event. The organiser shares `/events/{slug}?ref={code}`;
 * views and orders that arrive with a code are counted under it. Approved
 * organisers only, own events only (anyone else's: 404). The code is always
 * made here, never by the client.
 */

/** Label length in characters (code points), mirroring the table's check. */
export const MAX_LINK_LABEL_LENGTH = 40;
const CODE_ATTEMPTS = 5;

/** Control, format (zero-width, bidi), line and paragraph separator characters. */
const UNSAFE_LABEL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function parseLinkLabel(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) fail({ label: "Enter a label." });
  const label = (raw as string).normalize("NFC").trim();
  if ([...label].length > MAX_LINK_LABEL_LENGTH) {
    fail({ label: `Keep it to ${MAX_LINK_LABEL_LENGTH} characters or fewer.` });
  }
  if (UNSAFE_LABEL_CHARS.test(label)) fail({ label: "Use letters, numbers, spaces and punctuation only." });
  return label;
}

async function ownEvent(req: Request, deps: Deps, eventId: string): Promise<EventRecord> {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  return requireOwnEvent(deps.db, organiser.organiserId, eventId);
}

const linkUrl = (deps: Deps, slug: string, code: string) => `${deps.siteUrl()}/events/${slug}?ref=${code}`;

/** Every link of the event's, newest first, with all-time views and paid orders per code. */
async function listLinks(db: Db, deps: Deps, event: EventRecord): Promise<TrackingLink[]> {
  const rows = await db.query<{
    id: string;
    code: string;
    label: string;
    created_at: string | Date;
    views: string | number;
    orders: number;
    tickets: string | number;
    gross: string | number;
  }>(
    // The event's views and paid orders are each read once and grouped by
    // code (event_view_counts_key; orders_event_paid_created_idx),
    // rather than once per link: a link with neither gets zeros.
    `with views as (
       select v.link_code as code, sum(v.views) as views
         from public.event_view_counts v
        where v.event_id = $1 and v.link_code is not null
        group by v.link_code
     ), sales as (
       select o.tracking_code as code, count(*)::int as orders, sum(${ORGANISER_GROSS}) as gross,
              sum((select coalesce(sum((li ->> 'quantity')::int), 0) from jsonb_array_elements(o.line_items) li)) as tickets
         from public.orders o
        where o.event_id = $1 and o.status = 'paid' and o.tracking_code is not null
        group by o.tracking_code
     )
     select l.id, l.code, l.label, l.created_at,
            coalesce(v.views, 0)::bigint as views,
            coalesce(s.orders, 0) as orders, coalesce(s.tickets, 0)::bigint as tickets, coalesce(s.gross, 0)::bigint as gross
       from public.event_tracking_links l
       left join views v on v.code = l.code
       left join sales s on s.code = l.code
      where l.event_id = $1
      order by l.created_at desc, l.id`,
    [event.eventId],
  );
  return rows.map((r) => ({
    linkId: r.id,
    code: r.code,
    label: r.label,
    url: linkUrl(deps, event.slug, r.code),
    createdAt: new Date(r.created_at).toISOString(),
    views: Number(r.views),
    orders: Number(r.orders),
    ticketsSold: Number(r.tickets),
    grossCents: Number(r.gross),
  }));
}

/** GET /api/organisers/me/events/[eventId]/tracking-links */
export const listTrackingLinks: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const event = await ownEvent(req, deps, eventId);
  return okPrivate({ items: await listLinks(deps.db, deps, event) });
};

/**
 * POST /api/organisers/me/events/[eventId]/tracking-links `{label}` — 201 with
 * the new link. 400 bad label; 409 a label already on this event (any case),
 * or the event already has MAX_TRACKING_LINKS_PER_EVENT links.
 */
export const createTrackingLink: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const event = await requireOwnEvent(deps.db, organiser.organiserId, eventId);
  const label = parseLinkLabel((await readJson(req)).label);

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateTrackingCode();
    const [row] = await deps.db.query<{ result: string; link_id: string | null; link_created_at: string | Date | null }>(
      `select result, link_id, link_created_at from private.create_tracking_link($1, $2, $3, $4, $5)`,
      [event.eventId, organiser.organiserId, code, label, MAX_TRACKING_LINKS_PER_EVENT],
    );
    switch (row.result) {
      case "created": {
        const link: TrackingLink = {
          linkId: row.link_id as string,
          code,
          label,
          url: linkUrl(deps, event.slug, code),
          createdAt: new Date(row.link_created_at as string).toISOString(),
          views: 0,
          orders: 0,
          ticketsSold: 0,
          grossCents: 0,
        };
        return createdPrivate(link);
      }
      case "code_taken":
        continue;
      case "not_found":
        throw new HttpError(404, "Event not found.");
      case "limit":
        throw new HttpError(
          409,
          `This event already has ${MAX_TRACKING_LINKS_PER_EVENT} links, the most it can. Delete one to make another.`,
        );
      case "label_taken":
        throw new HttpError(409, "You already have a link with that label.", {
          label: "You already have a link with that label.",
        });
      default:
        throw new Error(`Unexpected create_tracking_link result: ${row.result}`);
    }
  }
  throw new Error("Could not allocate a unique tracking code.");
};

/**
 * DELETE /api/organisers/me/events/[eventId]/tracking-links/[linkId] — 204,
 * idempotent. The code's counted views and orders stay in the analytics
 * (shown as a deleted link). The event URL with the old `?ref=` still works;
 * the code just isn't counted any more.
 */
export const deleteTrackingLink: Handler<{ eventId: string; linkId: string }> = async (
  req,
  { eventId, linkId },
  deps,
) => {
  const event = await ownEvent(req, deps, eventId);
  if (!isUuid(linkId)) throw new HttpError(404, "Link not found.");
  await deps.db.query(`delete from public.event_tracking_links where id = $1 and event_id = $2`, [linkId, event.eventId]);
  return noContentPrivate();
};
