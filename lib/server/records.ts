/**
 * SQL for reading each record type, and the mappers from snake_case rows to
 * the camelCase API shapes in lib/api/types.ts. Nulls become undefined so
 * they drop out of JSON responses, matching the optional fields.
 */
import type { Db } from "./db";
import type {
  AdminEmailJob,
  AdminPaymentException,
  AdminMemberProfile,
  AdminEventRecord,
  AdminInviteRecord,
  AdminOrganiserRecord,
  AdminReport,
  BlockRecord,
  ConversationSummary,
  CustomerOrder,
  EventRecord,
  EventSeating,
  GoingAttendee,
  IssuedTicket,
  MemberProfile,
  MessageRecord,
  ModerationLogEntry,
  OrderRecord,
  OrganiserEditEntry,
  OrganiserLogField,
  OrganiserRecord,
  ProfileContentField,
  ProfileRecord,
  PublicEvent,
  PublicOrganiserProfile,
  TicketSeat,
  TicketTypeInput,
} from "./types";
import { REMAINING_SHOWN_AT_MOST, type PublicTicketType } from "@/lib/api/public-events";
import {
  SHELTUH_TEAM_ACTOR,
  type AdminOrganiserLinkRecord,
  type EventClip,
  type VenueLocation,
} from "@/lib/api/types";
import { isFeaturedVideo, type FeaturedVideo } from "@/lib/api/featured-video";
import { ticketProviderName, type TicketingMode } from "@/lib/ticketing";
import { DEFAULT_REFUND_POLICY, type RefundPolicy } from "@/lib/refund-policy";
import { PLATFORM_TIME_ZONE, type AustralianTimeZone, type StateCode } from "@/lib/time-zones";
import { maskEmail } from "./email-address";
import { orderReference } from "./order-reference";
import { socialLinks } from "./organiser-input";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

function opt<T>(value: unknown): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}

// ---------------------------------------------------------------------------
// Organisers
// ---------------------------------------------------------------------------

/**
 * SQL: the organiser `organiserIdSql`'s logo version (milliseconds since the
 * epoch of its last change, as text), or null with no logo. It goes in the
 * logo's URL, so a new logo is a new URL. private.organiser_logos' primary key.
 */
function organiserLogoVersionOf(organiserIdSql: string): string {
  return `(select floor(extract(epoch from lg.updated_at) * 1000)::bigint::text
             from private.organiser_logos lg where lg.organiser_id = ${organiserIdSql})`;
}

/**
 * An organiser logo's URLs. `v` only busts caches: the route serves the
 * current logo whatever it says (public once the organiser is approved).
 */
export function organiserLogoUrls(organiserId: string, version: string): { logoUrl: string; logoThumbUrl: string } {
  const base = `/api/organisers/${organiserId}/logo`;
  const v = encodeURIComponent(version);
  return { logoUrl: `${base}?v=${v}`, logoThumbUrl: `${base}?size=thumb&v=${v}` };
}

/** The `logoUrl` field for a row with `id` and `logo_version`: absent with no logo. */
function logoUrlOf(row: Row): { logoUrl?: string } {
  const version = opt<string>(row.logo_version);
  return version === undefined ? {} : { logoUrl: organiserLogoUrls(row.id as string, version).logoUrl };
}

const ORGANISER_COLUMNS = `o.id, o.owner_user_id, o.display_name, o.contact_email, o.description,
         o.categories::text[] as categories, o.website_url,
         o.instagram_handle, o.tiktok_handle, o.facebook_page, o.x_handle, o.status::text as status,
         o.rejection_reason, o.reviewed_by, o.reviewed_at, o.stripe_account_id,
         o.payouts_enabled, o.event_review_required, o.created_at, o.updated_at, o.featured_video_provider,
         o.featured_video_id, ${organiserLogoVersionOf("o.id")} as logo_version`;

export const ORGANISER_SELECT = `
  select ${ORGANISER_COLUMNS}
  from public.organisers o`;

/** Log entries shown per organiser in the admin queue. */
export const ADMIN_ORGANISER_EDIT_LIMIT = 20;

/**
 * The admin queue's organiser: every column plus the newest
 * ADMIN_ORGANISER_EDIT_LIMIT entries of private.organiser_profile_edits, in
 * the same query (organiser_profile_edits_organiser_idx), so a page is one
 * query, not one per organiser. Admin only.
 */
export const ADMIN_ORGANISER_SELECT = `
  select ${ORGANISER_COLUMNS},
         coalesce((
           select json_agg(json_build_object('kind', x.kind, 'at', x.edited_at, 'changes', x.changed_fields,
                                             'reason', x.reason, 'staff', x.staff) order by x.id desc)
           from (select pe.id, pe.kind, pe.edited_at, pe.changed_fields, pe.reason,
                        -- Made by someone other than the organiser's own account: an admin.
                        pe.actor_id is distinct from o.owner_user_id as staff
                   from private.organiser_profile_edits pe
                  where pe.organiser_id = o.id
                  order by pe.id desc
                  limit ${ADMIN_ORGANISER_EDIT_LIMIT}) x
         ), '[]'::json) as recent_edits
  from public.organisers o`;

/** organisers column → API field, for the log's changed_fields keys. */
const EDIT_FIELDS: Record<string, OrganiserLogField> = {
  description: "description",
  website_url: "websiteUrl",
  instagram_handle: "instagramHandle",
  tiktok_handle: "tiktokHandle",
  facebook_page: "facebookPage",
  x_handle: "xHandle",
  featured_video: "featuredVideo",
  logo: "logo",
  status: "status",
};

function toEditValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toOrganiserEdit(entry: {
  kind: OrganiserEditEntry["kind"];
  at: string;
  changes: Record<string, { old?: unknown; new?: unknown }>;
  reason: string | null;
  staff?: boolean;
}): OrganiserEditEntry {
  const changes: OrganiserEditEntry["changes"] = {};
  for (const [column, change] of Object.entries(entry.changes)) {
    const field = EDIT_FIELDS[column];
    if (field) changes[field] = { old: toEditValue(change.old), new: toEditValue(change.new) };
  }
  return {
    kind: entry.kind,
    at: iso(entry.at),
    changes,
    reason: opt(entry.reason),
    // A takedown is always an admin's; only an edit needs saying who made it.
    ...(entry.kind === "profile_edit" && entry.staff === true ? { byStaff: true } : {}),
  };
}

/** The stored featured video (organisers.featured_video_provider / _id), or undefined. */
function featuredVideoOf(row: Row): FeaturedVideo | undefined {
  const video = { provider: row.featured_video_provider, id: row.featured_video_id };
  return isFeaturedVideo(video) ? video : undefined;
}

/** For rows of ADMIN_ORGANISER_SELECT. */
export function toAdminOrganiser(row: Row): AdminOrganiserRecord {
  const edits = row.recent_edits as Parameters<typeof toOrganiserEdit>[0][];
  return { ...toOrganiser(row), recentEdits: edits.map(toOrganiserEdit) };
}

export function toOrganiser(row: Row): OrganiserRecord {
  return {
    organiserId: row.id as string,
    ownerUserId: opt(row.owner_user_id),
    displayName: row.display_name as string,
    contactEmail: row.contact_email as string,
    description: row.description as string,
    categories: row.categories as OrganiserRecord["categories"],
    websiteUrl: opt(row.website_url),
    instagramHandle: opt(row.instagram_handle),
    tiktokHandle: opt(row.tiktok_handle),
    facebookPage: opt(row.facebook_page),
    xHandle: opt(row.x_handle),
    status: row.status as OrganiserRecord["status"],
    rejectionReason: opt(row.rejection_reason),
    reviewedBy: opt(row.reviewed_by),
    reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : undefined,
    stripeAccountId: opt(row.stripe_account_id),
    payoutsEnabled: row.payouts_enabled as boolean,
    eventReviewRequired: row.event_review_required === true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    featuredVideo: featuredVideoOf(row),
    ...logoUrlOf(row),
  };
}

/** The applicant's own view of their application — no reviewer identity. */
export function toOwnOrganiserView(record: OrganiserRecord): OrganiserRecord {
  const view = { ...record };
  delete view.reviewedBy;
  return view;
}

/**
 * An organiser's public profile. Only the columns the public may see: no
 * contact email, owner, Stripe, payout or review columns are even read. Not
 * exported: the only way to use it is findPublicOrganiserRow, which always
 * adds the approved-only filter.
 */
const PUBLIC_ORGANISER_SELECT = `
  select o.id, o.display_name, o.description, o.categories::text[] as categories, o.website_url,
         o.instagram_handle, o.tiktok_handle, o.facebook_page, o.x_handle,
         o.featured_video_provider, o.featured_video_id,
         ${organiserLogoVersionOf("o.id")} as logo_version,
         to_char(o.created_at at time zone 'Australia/Melbourne', 'YYYY-MM') as member_since,
         -- organiser_follows_organiser_idx; only shown from FOLLOWER_COUNT_THRESHOLD.
         (select count(*)::int from public.organiser_follows f where f.organiser_id = o.id) as follower_count,
         (select count(*)::int from public.events e
           where e.organiser_id = o.id and e.status = 'published' and e.ends_at <= now()) as events_hosted
  from public.organisers o`;

/**
 * Below this many followers the public profile shows no count (null), like
 * Who's Going's small numbers: a handful of followers is easy to tie to people.
 */
export const FOLLOWER_COUNT_THRESHOLD = 10;

/** The public columns of an approved organiser (for toPublicOrganiserProfile); undefined for anything else. */
export async function findPublicOrganiserRow(db: Db, organiserId: string): Promise<Row | undefined> {
  const [row] = await db.query(`${PUBLIC_ORGANISER_SELECT} where o.id = $1 and o.status = 'approved'`, [organiserId]);
  return row;
}

export function toPublicOrganiserProfile(
  row: Row,
  upcomingEvents: PublicEvent[],
  recentEvents: PublicEvent[],
): PublicOrganiserProfile {
  return {
    organiserId: row.id as string,
    displayName: row.display_name as string,
    description: row.description as string,
    categories: row.categories as PublicOrganiserProfile["categories"],
    websiteUrl: opt(row.website_url),
    socialLinks: socialLinks({
      instagramHandle: opt(row.instagram_handle),
      tiktokHandle: opt(row.tiktok_handle),
      facebookPage: opt(row.facebook_page),
      xHandle: opt(row.x_handle),
    }),
    memberSince: row.member_since as string,
    featuredVideo: featuredVideoOf(row) ?? null,
    followerCount: (row.follower_count as number) >= FOLLOWER_COUNT_THRESHOLD ? (row.follower_count as number) : null,
    eventsHosted: row.events_hosted as number,
    ...logoUrlOf(row),
    upcomingEvents,
    recentEvents,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const EVENT_COLUMNS = `
         e.id, e.organiser_id, e.slug, e.title, e.description, e.category::text as category,
         e.venue_name, e.venue_address, e.suburb, e.state, e.time_zone, e.starts_at, e.ends_at,
         e.status::text as status, e.rejection_reason, e.created_at, e.updated_at,
         e.ticketing_mode, e.external_ticket_url, e.external_free, e.external_price_from_cents, e.refund_policy, e.refund_days,
         e.location_source, e.venue_place_id, e.venue_lat, e.venue_lng,
         o.display_name as organiser_name,
         -- Only while the organiser is approved: the logo route is a 404 otherwise.
         case when o.status = 'approved' then ${organiserLogoVersionOf("e.organiser_id")} end as organiser_logo_version,
         (select '/api/events/' || e.id::text || '/image?v=' || floor(extract(epoch from i.updated_at))::bigint::text
            from public.event_images i where i.event_id = e.id) as image_url,
         (select json_build_object('x', i.focus_x, 'y', i.focus_y)
            from public.event_images i where i.event_id = e.id and i.focus_x is not null) as image_focus,
         -- The clip (private.event_clips, by primary key), versioned in milliseconds (every write moves it on).
         (select json_build_object('version', floor(extract(epoch from c.updated_at) * 1000)::bigint::text,
                                   'durationMs', c.duration_ms, 'width', c.width, 'height', c.height,
                                   'description', c.description)
            from private.event_clips c where c.event_id = e.id) as clip,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object(
                    'id', t.id, 'name', t.name, 'description', t.description,
                    'priceCents', t.price_cents, 'feePolicy', t.fee_policy,
                    'quantityAvailable', t.quantity_available,
                    -- Only for a seated tier (stripped otherwise: a GA tier's JSON is unchanged).
                    'seated', case when t.seated then true end)) order by t.position)
           from public.ticket_types t where t.event_id = e.id
         ), '[]'::json) as ticket_types,
         (select json_build_object('version', m.version, 'seatCount', m.seat_count)
            from public.event_seat_maps m where m.event_id = e.id) as seating,
         -- What's left per ticket type: the public shape's soldOut / remaining
         -- (toPublicEventFromRow; the public sees at most "10 or fewer"), and
         -- EventRecord.ticketsSold (organiser and admin only, ticketsSoldOf).
         (select json_object_agg(t.id, greatest(t.quantity_available - t.quantity_sold, 0))
            from public.ticket_types t where t.event_id = e.id) as ticket_remaining,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object(
                    'action', l.action, 'by', coalesce(l.actor_id::text, 'system'),
                    -- Someone other than the organiser's owner: Sheltüh staff
                    -- (an admin), whose id the organiser's view doesn't show.
                    'staff', l.actor_id is not null and l.actor_id is distinct from o.owner_user_id,
                    'at', l.created_at, 'reason', l.reason, 'changes', l.details)) order by l.id)
           -- Admin curation of trending ('curated') stays out: editorial, admins
           -- only (GET /admin/events/{id}/curation).
           from public.event_moderation_log l where l.event_id = e.id and l.action <> 'curated'
         ), '[]'::json) as moderation_log`;

const EVENT_FROM = `
  from public.events e
  join public.organisers o on o.id = e.organiser_id`;

export const EVENT_SELECT = `
  select ${EVENT_COLUMNS}${EVENT_FROM}`;

/**
 * EVENT_SELECT with extra columns (SQL over `e` and `o`), for reads that need
 * more than the record, e.g. the trending rank. The result still maps with toEvent.
 */
export const eventSelectWith = (extraColumns: string) => `
  select ${EVENT_COLUMNS},
         ${extraColumns}${EVENT_FROM}`;

/**
 * EVENT_SELECT plus whether the organiser is platform-managed (no owner
 * account), the event's trending curation (private.event_curation: null
 * columns when an admin never curated it) and, for a published event, its
 * latest approval (when, and whether the organiser's own account made it:
 * event_moderation_log_event_idx, newest first). Admin only. Callers append a
 * `where` over `e` / `o`: the curation join is on the table's primary key,
 * at most one row per event, so it never changes the rows or their order.
 */
export const ADMIN_EVENT_SELECT = `
  select ${EVENT_COLUMNS},
         o.owner_user_id is null as organiser_platform_managed,
         ec.boost as curation_boost,
         ec.excluded as curation_excluded,
         case when e.status = 'published' then (
           select json_build_object('at', l.created_at,
                                    'byOrganiser', l.actor_id is not null and l.actor_id = o.owner_user_id)
             from public.event_moderation_log l
            where l.event_id = e.id and l.action = 'approved'
            order by l.id desc
            limit 1) end as last_approval${EVENT_FROM}
  left join private.event_curation ec on ec.event_id = e.id`;

/** The fields a log entry's `changes` can name (ModerationLogEntry.changes). */
const LOG_CHANGE_FIELDS = [
  "ticketingMode",
  "externalTicketUrl",
  "externalFree",
  "externalPriceFromCents",
  "title",
  "description",
  "category",
  "venueName",
  "venueAddress",
  "suburb",
  "state",
  "timeZone",
  "startsAt",
  "endsAt",
  "ticketTypes",
  "image",
  "imageFocus",
  "seatMap",
  "clip",
  "clipDescription",
  "refundPolicy",
  "refundDays",
  "location",
] as const satisfies readonly (keyof NonNullable<ModerationLogEntry["changes"]>)[];

/** One change as stored: json_strip_nulls has dropped a side that was null. */
type StoredChange = { old?: unknown; new?: unknown } | undefined;

/** A log entry as EVENT_COLUMNS reads it. */
type StoredLogEntry = Omit<ModerationLogEntry, "changes"> & { staff?: boolean; changes?: Record<string, StoredChange> };

/**
 * Who a log entry shows as its actor. Admins see account ids; an
 * organiser's view of their own event shows SHELTUH_TEAM_ACTOR for anyone
 * but the organiser's owner (an admin's id is never theirs to know).
 */
type LogAudience = "organiser" | "admin";

/**
 * A moderation log entry from EVENT_SELECT. json_strip_nulls also strips the
 * nulls inside `changes` (an old value that was null, e.g. no link before),
 * so each known field's change is rebuilt with both sides; anything else
 * stored there is dropped.
 */
function toModerationLogEntry(entry: StoredLogEntry, audience: LogAudience): ModerationLogEntry {
  const { changes: stored, staff, ...rest } = entry;
  const result: ModerationLogEntry = { ...rest, at: iso(entry.at) };
  if (staff && audience === "organiser") result.by = SHELTUH_TEAM_ACTOR;
  if (stored) {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const field of LOG_CHANGE_FIELDS) {
      const change = stored[field];
      if (change) changes[field] = { old: change.old ?? null, new: change.new ?? null };
    }
    result.changes = changes;
  }
  return result;
}

/**
 * For rows of EVENT_SELECT, as the event's organiser (or the public, through
 * toPublicEvent) sees it: an admin's log entries show SHELTUH_TEAM_ACTOR, not
 * their account id. Admin routes use toEventForAdmin.
 */
export function toEvent(row: Row): EventRecord {
  return mapEvent(row, "organiser");
}

/** For rows of EVENT_SELECT, in admin routes: log entries keep every actor's account id. */
export function toEventForAdmin(row: Row): EventRecord {
  return mapEvent(row, "admin");
}

/** The `imageFocus` field for a row of EVENT_SELECT: absent without a focus point. */
function imageFocusOf(row: Row): { imageFocus?: { x: number; y: number } } {
  const focus = row.image_focus as { x: number; y: number } | null | undefined;
  return focus ? { imageFocus: { x: focus.x, y: focus.y } } : {};
}

/** The `organiserLogoThumbUrl` field for a row of EVENT_SELECT: absent with no logo (or an organiser not approved). */
function organiserLogoThumbOf(row: Row): { organiserLogoThumbUrl?: string } {
  const version = opt<string>(row.organiser_logo_version);
  return version === undefined
    ? {}
    : { organiserLogoThumbUrl: organiserLogoUrls(row.organiser_id as string, version).logoThumbUrl };
}

/** Tickets sold per ticket type: its capacity less what's left (ticket_remaining; sold never exceeds capacity). Organiser and admin shapes only. */
function ticketsSoldOf(row: Row): Record<string, number> {
  const remaining = (row.ticket_remaining ?? {}) as Record<string, number>;
  const sold: Record<string, number> = {};
  for (const ticket of row.ticket_types as TicketTypeInput[]) {
    sold[ticket.id] = ticket.quantityAvailable - (remaining[ticket.id] ?? ticket.quantityAvailable);
  }
  return sold;
}

/** The `clip` field for a row of EVENT_SELECT: absent with no clip. */
function clipOf(row: Row): { clip?: EventClip } {
  const stored = row.clip as
    | { version: string; durationMs: number; width: number; height: number; description: string }
    | null
    | undefined;
  if (!stored) return {};
  return {
    clip: {
      url: `/api/events/${row.id as string}/clip?v=${stored.version}`,
      durationMs: stored.durationMs,
      width: stored.width,
      height: stored.height,
      description: stored.description,
    },
  };
}

/**
 * `refundPolicy` (always; a row without the column, from before its
 * migration, reads as the default) and `refundDays` (only for `days_before`),
 * from `refund_policy` / `refund_days` columns.
 */
function refundTermsOf(row: Row): { refundPolicy: RefundPolicy; refundDays?: number } {
  const refundPolicy = (opt<string>(row.refund_policy) ?? DEFAULT_REFUND_POLICY) as RefundPolicy;
  return refundPolicy === "days_before" && typeof row.refund_days === "number"
    ? { refundPolicy, refundDays: row.refund_days }
    : { refundPolicy };
}

/**
 * `state` and `timeZone` from `stateColumn` / `zoneColumn` (always set: the
 * columns are not null; a row from before their migration reads as VIC,
 * Melbourne, which is what it meant).
 */
function placeOf(row: Row, stateColumn = "state", zoneColumn = "time_zone"): { state: StateCode; timeZone: AustralianTimeZone } {
  return {
    state: opt<StateCode>(row[stateColumn]) ?? "VIC",
    timeZone: opt<AustralianTimeZone>(row[zoneColumn]) ?? PLATFORM_TIME_ZONE,
  };
}

/**
 * The `location` field from `location_source`, `venue_place_id`, `venue_lat`
 * and `venue_lng`: absent for `legacy` (and a row from before the columns),
 * so those payloads are unchanged. The pin is the organiser's own
 * (events.venue_lat / venue_lng), never Google's.
 */
function locationOf(row: Row): { location?: VenueLocation } {
  const source = row.location_source;
  if (source !== "places" && source !== "manual_pin") return {};
  const lat = row.venue_lat === null || row.venue_lat === undefined ? NaN : Number(row.venue_lat);
  const lng = row.venue_lng === null || row.venue_lng === undefined ? NaN : Number(row.venue_lng);
  const placeId = source === "places" ? opt<string>(row.venue_place_id) : undefined;
  return {
    location: {
      source,
      ...(placeId ? { placeId } : {}),
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { pin: { lat, lng } } : {}),
    },
  };
}

function mapEvent(row: Row, audience: LogAudience): EventRecord {
  const log = row.moderation_log as StoredLogEntry[];
  const ticketingMode = (row.ticketing_mode ?? "sheltuh") as TicketingMode;
  const externalTicketUrl = ticketingMode === "external" ? opt<string>(row.external_ticket_url) : undefined;
  return {
    organiserId: row.organiser_id as string,
    eventId: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    description: row.description as string,
    category: row.category as EventRecord["category"],
    venueName: row.venue_name as string,
    venueAddress: row.venue_address as string,
    suburb: row.suburb as string,
    ...placeOf(row),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    organiserName: row.organiser_name as string,
    imageUrl: opt(row.image_url),
    ...imageFocusOf(row),
    ...clipOf(row),
    ...organiserLogoThumbOf(row),
    ticketTypes: row.ticket_types as TicketTypeInput[],
    ticketsSold: ticketsSoldOf(row),
    ticketingMode,
    externalTicketUrl,
    externalFree: row.external_free === true,
    ...(externalTicketUrl && typeof row.external_price_from_cents === "number"
      ? { externalPriceFromCents: row.external_price_from_cents }
      : {}),
    externalProvider: externalTicketUrl ? ticketProviderName(externalTicketUrl) : null,
    // Once approved, the ticketing is frozen for the organiser (private.edit_event_draft).
    ticketingLocked: log.some((entry) => entry.action === "approved"),
    ...refundTermsOf(row),
    ...locationOf(row),
    ...(row.seating ? { seating: row.seating as EventSeating } : {}),
    status: row.status as EventRecord["status"],
    rejectionReason: opt(row.rejection_reason),
    moderationLog: log.map((entry) => toModerationLogEntry(entry, audience)),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * For rows of ADMIN_EVENT_SELECT. An event with no curation row has the
 * defaults GET /admin/events/{id}/curation reports: boost 1, not excluded.
 */
export function toAdminEvent(row: Row): AdminEventRecord {
  const approval = row.last_approval as { at: string; byOrganiser: boolean } | null | undefined;
  return {
    ...toEventForAdmin(row),
    organiserPlatformManaged: row.organiser_platform_managed === true,
    curation: {
      boost: row.curation_boost === null || row.curation_boost === undefined ? 1 : Number(row.curation_boost),
      excluded: row.curation_excluded === true,
    },
    ...(approval ? { publishedAt: iso(approval.at), publishedBy: approval.byOrganiser ? "organiser" : "sheltuh" } : {}),
  };
}

/**
 * A public ticket type: whether it's sold out, and how many are left only
 * when that's REMAINING_SHOWN_AT_MOST or fewer (never an exact large stock).
 * A ticket type missing from `remaining` (none read) counts as on sale.
 */
function toPublicTicketType(ticket: TicketTypeInput, remaining: Record<string, number> | null | undefined): PublicTicketType {
  const left = remaining?.[ticket.id];
  if (left === undefined) return { ...ticket, soldOut: false };
  return { ...ticket, soldOut: left <= 0, ...(left <= REMAINING_SHOWN_AT_MOST ? { remaining: Math.max(left, 0) } : {}) };
}

/**
 * The public shape of a row of EVENT_SELECT (or eventSelectWith): the event
 * plus what's left of each ticket type. Every public route maps rows with this.
 */
export function toPublicEventFromRow(row: Row): PublicEvent {
  return toPublicEvent(toEvent(row), row.ticket_remaining as Record<string, number> | null);
}

/**
 * The only event fields the public (unauthenticated) routes may expose.
 * `remaining` (ticket type id → tickets left, as EVENT_SELECT's
 * ticket_remaining reads it) drives `soldOut` and the low-stock `remaining`.
 */
export function toPublicEvent(event: EventRecord, remaining?: Record<string, number> | null): PublicEvent {
  const external = event.ticketingMode === "external";
  const ticketTypes = event.ticketTypes.map((ticket) => toPublicTicketType(ticket, remaining));
  return {
    organiserId: event.organiserId,
    eventId: event.eventId,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    state: event.state ?? "VIC",
    timeZone: event.timeZone ?? PLATFORM_TIME_ZONE,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    // Only with a focus point (not sensitive: where the subject of the public photo is).
    ...(event.imageFocus ? { imageFocus: { x: event.imageFocus.x, y: event.imageFocus.y } } : {}),
    // Only with a clip (and, like every field here, only ever on a published event's public shape).
    ...(event.clip
      ? {
          clip: {
            url: event.clip.url,
            durationMs: event.clip.durationMs,
            width: event.clip.width,
            height: event.clip.height,
            description: event.clip.description,
          },
        }
      : {}),
    // Only with a logo: an event without one keeps its payload unchanged.
    ...(event.organiserLogoThumbUrl ? { organiserLogoThumbUrl: event.organiserLogoThumbUrl } : {}),
    ticketTypes,
    // Every Sheltüh ticket type sold out. No ticket types, or an external event: not sold out (nothing to wait for).
    soldOut: !external && ticketTypes.length > 0 && ticketTypes.every((ticket) => ticket.soldOut === true),
    ticketingMode: event.ticketingMode ?? "sheltuh",
    // Only an external event has a link (toEvent already drops it otherwise).
    ...(event.ticketingMode === "external" && event.externalTicketUrl
      ? { externalTicketUrl: event.externalTicketUrl }
      : {}),
    externalFree: event.externalFree === true,
    ...(external && typeof event.externalPriceFromCents === "number"
      ? { externalPriceFromCents: event.externalPriceFromCents }
      : {}),
    externalProvider: event.externalProvider ?? null,
    refundPolicy: event.refundPolicy ?? DEFAULT_REFUND_POLICY,
    // Only for days_before.
    ...(event.refundPolicy === "days_before" && event.refundDays !== undefined ? { refundDays: event.refundDays } : {}),
    // Only with a venue location: an event without one keeps its payload unchanged.
    ...(event.location
      ? {
          location: {
            source: event.location.source,
            ...(event.location.placeId ? { placeId: event.location.placeId } : {}),
            ...(event.location.pin ? { pin: { lat: event.location.pin.lat, lng: event.location.pin.lng } } : {}),
          },
        }
      : {}),
    // Seated events only: a general admission event's payload is unchanged.
    ...(event.seating ? { seating: { version: event.seating.version } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * A ticket's seat (`t` is public.tickets) as {section, row, seat, kind}, or
 * null (stripped by json_strip_nulls: a GA ticket's JSON is unchanged).
 * tickets_seat_key / event_seats_pkey: one row each.
 */
const TICKET_SEAT_JSON = `(select json_build_object('section', s.section_label, 'row', s.row_label, 'seat', s.seat_label,
                                       'kind', s.kind)
                      from public.event_seats s where s.event_id = t.event_id and s.id = t.seat_id)`;

export const ORDER_SELECT = `
  select o.id, o.event_id, o.organiser_id, o.event_title, o.buyer_email, o.line_items,
         o.subtotal_cents, o.buyer_fee_cents, o.total_cents, o.application_fee_cents, o.support_cents,
         o.status::text as status, o.stripe_checkout_session_id, o.stripe_payment_intent_id,
         o.created_at, o.updated_at, o.seat_ids,
         (select e.slug from public.events e where e.id = o.event_id) as event_slug,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object(
                    'ticketCode', t.code, 'ticketTypeId', t.ticket_type_id,
                    'ticketTypeName', t.ticket_type_name, 'seat', ${TICKET_SEAT_JSON})) order by t.ticket_type_id, t.code)
           from public.tickets t where t.order_id = o.id
         ), '[]'::json) as tickets
  from public.orders o`;

export function toOrder(row: Row): OrderRecord {
  return {
    orderId: row.id as string,
    organiserId: row.organiser_id as string,
    eventId: row.event_id as string,
    eventTitle: row.event_title as string,
    eventSlug: row.event_slug as string,
    buyerEmail: opt(row.buyer_email),
    lineItems: row.line_items as OrderRecord["lineItems"],
    subtotalCents: row.subtotal_cents as number,
    buyerFeeCents: row.buyer_fee_cents as number,
    totalCents: row.total_cents as number,
    applicationFeeCents: row.application_fee_cents as number,
    ...(Number(row.support_cents ?? 0) > 0 ? { supportCents: Number(row.support_cents) } : {}),
    status: row.status as OrderRecord["status"],
    stripeCheckoutSessionId: opt(row.stripe_checkout_session_id),
    stripePaymentIntentId: opt(row.stripe_payment_intent_id),
    ...(Array.isArray(row.seat_ids) ? { seatIds: row.seat_ids as string[] } : {}),
    tickets: row.tickets as IssuedTicket[],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * The buyer's confirmation-page view of an order (`where o.id = $1`). Only the
 * columns CustomerOrder needs: no ids, fee split, Stripe ids or order
 * timestamps. Ticket codes (with each ticket's check-in time) only while the
 * order is paid: a refunded order's tickets are void. The event's current
 * times, venue name and suburb are public event details (never the street
 * address), shown on the tickets; the mapper drops them for any order that
 * isn't paid, and for any event that isn't published (unpublished, back in
 * draft or review, rejected, or gone): those details are no longer public,
 * so the order only says the event is no longer listed (`eventListed`).
 * `tickets_issued` and `amount_refunded_cents` tell a refund made in Stripe
 * (after the tickets were issued, or before the payment was recorded, when
 * none ever were: the amount is then recorded) from one refunded because it
 * couldn't be fulfilled (no tickets, and no amount: only charge.refunded
 * records one). Reads the event by primary key and the tickets by
 * tickets_order_idx.
 */
export const CUSTOMER_ORDER_SELECT = `
  select o.id, o.status::text as status, o.event_title, o.buyer_email,
         o.subtotal_cents, o.buyer_fee_cents, o.total_cents, o.support_cents,
         e.slug as event_slug, e.status::text as event_status,
         e.starts_at as event_starts_at, e.ends_at as event_ends_at,
         e.venue_name as event_venue_name, e.suburb as event_suburb,
         e.state as event_state, e.time_zone as event_time_zone,
         e.refund_policy, e.refund_days,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object('ticketCode', t.code, 'ticketTypeName', t.ticket_type_name,
                                                              'seat', ${TICKET_SEAT_JSON},
                                                              'checkedInAt', t.checked_in_at))
                           order by t.ticket_type_id, t.code)
           from public.tickets t where t.order_id = o.id and o.status = 'paid'
         ), '[]'::json) as tickets,
         exists (select 1 from public.tickets t where t.order_id = o.id) as tickets_issued,
         o.amount_refunded_cents
  from public.orders o
  left join public.events e on e.id = o.event_id`;

/**
 * Why a refunded (or refund-pending) order was refunded; undefined for any
 * other status. `refunded`: refunded in Stripe, whether its tickets had been
 * issued or (refunded before the payment was recorded) never were.
 */
function refundReason(
  status: CustomerOrder["status"],
  ticketsIssued: boolean,
  amountRefundedCents: number,
): CustomerOrder["refundReason"] {
  if (status === "oversold_refund_required") return "oversold";
  if (status === "refunded") return ticketsIssued || amountRefundedCents > 0 ? "refunded" : "oversold";
  return undefined;
}

/** `eventTimeZone` and `eventState`, from a row's `event_time_zone` / `event_state` (placeOf). */
export function eventPlaceOf(row: Row): { eventTimeZone: AustralianTimeZone; eventState: StateCode } {
  const { state, timeZone } = placeOf(row, "event_state", "event_time_zone");
  return { eventTimeZone: timeZone, eventState: state };
}

// json_strip_nulls drops a missing seat (general admission) and a null check-in time.
type CustomerTicketRow = { ticketCode: string; ticketTypeName: string; seat?: TicketSeat; checkedInAt?: string | null };

export function toCustomerOrder(row: Row): CustomerOrder {
  const email = opt<string>(row.buyer_email);
  const status = row.status as CustomerOrder["status"];
  const paid = status === "paid";
  // The event's details are public only while it's published; a missing event (left join) isn't listed either.
  const listed = row.event_status === "published";
  const details = paid && listed;
  // Belt and braces with the SQL: never a code for an order that isn't paid.
  const tickets = paid
    ? (row.tickets as CustomerTicketRow[]).map((t) => ({
        ticketCode: t.ticketCode,
        ticketTypeName: t.ticketTypeName,
        ...(t.seat ? { seat: t.seat } : {}),
        checkedInAt: t.checkedInAt ? iso(t.checkedInAt) : null,
      }))
    : [];
  return {
    status,
    refundReason: refundReason(status, row.tickets_issued === true, Number(row.amount_refunded_cents ?? 0)),
    reference: orderReference(row.id as string),
    eventTitle: row.event_title as string,
    eventSlug: opt(row.event_slug),
    // What the tickets show: only while they're valid, and only while the event is published.
    eventListed: paid ? listed : undefined,
    eventStartsAt: details && row.event_starts_at ? iso(row.event_starts_at) : undefined,
    eventEndsAt: details && row.event_ends_at ? iso(row.event_ends_at) : undefined,
    // The zone (and state, for its label) the times are shown in: sent with them.
    ...(details && row.event_starts_at ? eventPlaceOf(row) : {}),
    venueName: details ? opt(row.event_venue_name) : undefined,
    suburb: details ? opt(row.event_suburb) : undefined,
    ...(details ? refundTermsOf(row) : {}),
    maskedEmail: email ? maskEmail(email) : undefined,
    subtotalCents: row.subtotal_cents as number,
    buyerFeeCents: row.buyer_fee_cents as number,
    // Support Sheltüh, its own line: only when the buyer added some (totalCents includes it).
    ...(Number(row.support_cents ?? 0) > 0 ? { supportCents: Number(row.support_cents) } : {}),
    totalCents: row.total_cents as number,
    tickets,
  };
}

/** Admin view of a ticket-email job; append `where …`. Reads the order only for its reference, title and masked email. */
export const ADMIN_EMAIL_JOB_SELECT = `
  select j.id::text as id, j.kind, j.status, j.attempts, j.next_attempt_at, j.last_error,
         j.created_at, j.sent_at, j.last_resend_at,
         o.id as order_id, o.status::text as order_status, o.event_title, o.buyer_email
    from private.email_outbox j
    join public.orders o on o.id = j.order_id`;

export function toAdminEmailJob(row: Row): AdminEmailJob {
  const email = opt<string>(row.buyer_email);
  const status = row.status as AdminEmailJob["status"];
  return {
    jobId: row.id as string,
    kind: row.kind as AdminEmailJob["kind"],
    status,
    attempts: row.attempts as number,
    nextAttemptAt: status === "pending" ? iso(row.next_attempt_at) : undefined,
    lastError: opt(row.last_error),
    createdAt: iso(row.created_at),
    sentAt: row.sent_at ? iso(row.sent_at) : undefined,
    lastResendAt: row.last_resend_at ? iso(row.last_resend_at) : undefined,
    orderReference: orderReference(row.order_id as string),
    orderStatus: row.order_status as AdminEmailJob["orderStatus"],
    eventTitle: row.event_title as string,
    maskedEmail: email ? maskEmail(email) : undefined,
  };
}

/**
 * Admin view of a payment exception; append `where …`. Reads the order only
 * for its reference, status and title: never the buyer.
 */
export const ADMIN_PAYMENT_EXCEPTION_SELECT = `
  select e.id, e.kind, e.status, e.order_id, e.payment_intent_id, e.refund_id, e.stripe_event_id, e.details,
         e.alerted_at, e.opened_at, e.created_at, e.resolved_at, e.resolution, e.resolved_by, e.resolution_note,
         o.status::text as order_status, o.event_title
    from private.payment_exceptions e
    left join public.orders o on o.id = e.order_id`;

const DETAIL_STRINGS = ["refundStatus", "orderStatus", "source", "reason", "currency"] as const;
const DETAIL_NUMBERS = [
  "refundAmountCents",
  "amountRefundedCents",
  "totalCents",
  "supportCents",
  "amountChargedCents",
  "supportKeptCents",
] as const;

/**
 * An exception that can't wait: a refund that didn't complete for an order
 * already voided (the buyer has neither tickets nor their money), or any
 * payment whose amount or currency wasn't its order's (the money went
 * somewhere it shouldn't have: the automatic refund needs checking). Shared
 * by the admin list and the ops alert email.
 */
export function paymentExceptionUrgent(kind: string, orderStatus: string | null | undefined): boolean {
  return kind === "amount_mismatch" || (kind === "refund_not_completed" && orderStatus === "refunded");
}

/** Only the known amounts and statuses, whatever else the jsonb holds. */
export function paymentExceptionDetails(raw: unknown): AdminPaymentException["details"] {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const details: AdminPaymentException["details"] = {};
  for (const key of DETAIL_STRINGS) {
    const value = source[key];
    if (typeof value === "string" && /^[a-z_]{1,40}$/.test(value)) details[key] = value;
  }
  for (const key of DETAIL_NUMBERS) {
    const value = source[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) details[key] = value;
  }
  return details;
}

export function toAdminPaymentException(row: Row): AdminPaymentException {
  const details = paymentExceptionDetails(row.details);
  const kind = row.kind as AdminPaymentException["kind"];
  const orderStatus = opt<AdminPaymentException["orderStatus"]>(row.order_status);
  return {
    exceptionId: row.id as string,
    kind,
    status: row.status as AdminPaymentException["status"],
    urgent: paymentExceptionUrgent(kind, orderStatus ?? details.orderStatus),
    orderReference: row.order_id ? orderReference(row.order_id as string) : undefined,
    orderStatus,
    eventTitle: opt(row.event_title),
    paymentIntentId: opt(row.payment_intent_id),
    refundId: opt(row.refund_id),
    stripeEventId: opt(row.stripe_event_id),
    details,
    alertedAt: row.alerted_at ? iso(row.alerted_at) : undefined,
    openedAt: iso(row.opened_at),
    createdAt: iso(row.created_at),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined,
    resolution: opt(row.resolution),
    resolvedBy: opt(row.resolved_by),
    resolutionNote: opt(row.resolution_note),
  };
}

// ---------------------------------------------------------------------------
// Account invites
// ---------------------------------------------------------------------------

/**
 * Admin view of an invite; append `where …`. Never the token hash, the
 * organiser's other details or who accepted it. `lapsed`: the link has run
 * out (a pending invite then reads `expired`).
 */
export const ADMIN_INVITE_SELECT = `
  select i.id, i.kind, i.email, i.status, i.expires_at <= now() as lapsed,
         i.organiser_profile ->> 'display_name' as organiser_name, i.invited_by, i.created_at, i.expires_at,
         i.last_sent_at, i.last_send_failed_at, i.send_count, i.accepted_at, i.accepted_organiser_id, i.revoked_at
    from private.account_invites i`;

export function toAdminInvite(row: Row): AdminInviteRecord {
  const stored = row.status as AdminInviteRecord["status"];
  return {
    inviteId: row.id as string,
    kind: row.kind as AdminInviteRecord["kind"],
    email: row.email as string,
    status: stored === "pending" && row.lapsed === true ? "expired" : stored,
    organiserName: opt(row.organiser_name),
    invitedBy: opt(row.invited_by),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    lastSentAt: row.last_sent_at ? iso(row.last_sent_at) : undefined,
    lastSendFailedAt: row.last_send_failed_at ? iso(row.last_send_failed_at) : undefined,
    sendCount: row.send_count as number,
    acceptedAt: row.accepted_at ? iso(row.accepted_at) : undefined,
    acceptedOrganiserId: opt(row.accepted_organiser_id),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : undefined,
  };
}

/**
 * Organiser links as admins see them (docs/architecture.md, "Organiser
 * links"): never the token or its hash. The creator's email and the
 * organiser's current name come from one join each (by primary key).
 */
export const ADMIN_ORGANISER_LINK_SELECT = `
  select l.id, l.status, l.expires_at <= now() as lapsed, l.created_at, l.created_by, cu.email as created_by_email,
         l.expires_at, l.used_at, l.organiser_id, o.display_name as organiser_name, l.cancelled_at
    from private.organiser_invite_links l
    left join auth.users cu on cu.id = l.created_by
    left join public.organisers o on o.id = l.organiser_id`;

export function toAdminOrganiserLink(row: Row): AdminOrganiserLinkRecord {
  const stored = row.status as "active" | "used" | "cancelled";
  return {
    linkId: row.id as string,
    status: stored === "active" && row.lapsed === true ? "expired" : stored,
    createdAt: iso(row.created_at),
    createdBy: opt(row.created_by),
    createdByEmail: opt(row.created_by_email),
    expiresAt: iso(row.expires_at),
    usedAt: row.used_at ? iso(row.used_at) : undefined,
    organiserId: opt(row.organiser_id),
    organiserName: opt(row.organiser_name),
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Profiles and Who's Going
// ---------------------------------------------------------------------------

/**
 * For `select … from public.profiles` (unaliased) and `insert/update
 * public.profiles … returning`. Suspension lives in private.social_suspensions
 * (profiles.social_suspended_at is deprecated and ignored).
 */
export const PROFILE_COLUMNS = `display_name, created_at, updated_at, public_id, profile_visible, bio, instagram_handle,
  exists (select 1 from private.social_suspensions s where s.user_id = profiles.user_id) as suspended,
  ${avatarVersionOf("profiles.user_id")} as avatar_version`;

/**
 * SQL: the photo's version for the member `userIdSql` (milliseconds since
 * the epoch of its last change, as text), or null with no photo. It goes in
 * the photo's URL, so a new photo is a new URL.
 */
export function avatarVersionOf(userIdSql: string): string {
  return `(select floor(extract(epoch from av.updated_at) * 1000)::bigint::text
             from private.profile_avatars av where av.user_id = ${userIdSql})`;
}

/** A member photo's URLs (the route checks who may see it on every request). */
export function avatarUrls(profileId: string, version: string): { avatarUrl: string; avatarThumbUrl: string } {
  const base = `/api/profiles/${profileId}/avatar`;
  const v = encodeURIComponent(version);
  return { avatarUrl: `${base}?v=${v}`, avatarThumbUrl: `${base}?size=thumb&v=${v}` };
}

export function toProfile(row: Row): ProfileRecord {
  const profileId = row.public_id as string;
  const version = opt<string>(row.avatar_version);
  return {
    displayName: row.display_name as string,
    suspended: row.suspended === true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    profileId,
    profileVisible: row.profile_visible === true,
    bio: opt(row.bio),
    instagramHandle: opt(row.instagram_handle),
    hasAvatar: version !== undefined,
    ...(version !== undefined ? avatarUrls(profileId, version) : {}),
  };
}

/**
 * Only ever the opaque per-event id and the display name, plus the member's
 * profile id and photo when (and only when) their profile is visible: never a
 * user id, email or ticket. `profile_id` and `avatar_version` must already be
 * null for a profile that isn't visible (going.ts).
 */
export function toGoingAttendee(row: Row): GoingAttendee {
  const profileId = opt<string>(row.profile_id);
  const version = profileId ? opt<string>(row.avatar_version) : undefined;
  return {
    attendeeId: row.id as string,
    displayName: row.display_name as string,
    isYou: row.is_you === true,
    ...(profileId ? { profileId } : {}),
    hasAvatar: version !== undefined,
    ...(profileId && version !== undefined ? { avatarThumbUrl: avatarUrls(profileId, version).avatarThumbUrl } : {}),
  };
}

/**
 * Another member's profile (GET /api/profiles/{profileId}). `row` holds the
 * profile's public columns only (going.ts / profiles.ts read nothing else).
 */
export function toMemberProfile(
  row: Row,
  upcomingEvents: PublicEvent[],
  messaging: { canMessage: boolean; conversationId?: string },
): MemberProfile {
  const profileId = row.public_id as string;
  const version = opt<string>(row.avatar_version);
  const handle = opt<string>(row.instagram_handle);
  return {
    profileId,
    displayName: row.display_name as string,
    bio: opt(row.bio),
    instagramHandle: handle,
    instagramUrl: handle ? socialLinks({ instagramHandle: handle }).instagram : undefined,
    hasAvatar: version !== undefined,
    ...(version !== undefined ? avatarUrls(profileId, version) : {}),
    isYou: row.is_you === true,
    upcomingEvents,
    canMessage: messaging.canMessage,
    ...(messaging.conversationId ? { conversationId: messaging.conversationId } : {}),
  };
}

/** For `select … from public.profiles p` (admin only): the profile, its photo and newest moderation entries. */
export const ADMIN_PROFILE_SELECT = `
  select p.public_id, p.display_name, p.profile_visible, p.bio, p.instagram_handle,
         ${avatarVersionOf("p.user_id")} as avatar_version,
         exists (select 1 from private.social_suspensions s where s.user_id = p.user_id) as suspended,
         coalesce((
           select json_agg(json_build_object('removed', l.removed, 'reason', l.reason, 'at', l.created_at,
                                             'by', l.admin_id) order by l.id desc)
             from (select * from private.profile_moderation_log l
                    where l.user_id = p.user_id order by l.id desc limit 20) l
         ), '[]'::json) as moderation_log
    from public.profiles p`;

export function toAdminMemberProfile(row: Row): AdminMemberProfile {
  const profileId = row.public_id as string;
  const version = opt<string>(row.avatar_version);
  const log = row.moderation_log as { removed: ProfileContentField[]; reason: string; at: string; by: string | null }[];
  return {
    profileId,
    displayName: row.display_name as string,
    profileVisible: row.profile_visible === true,
    bio: opt(row.bio),
    instagramHandle: opt(row.instagram_handle),
    hasAvatar: version !== undefined,
    ...(version !== undefined ? { avatarUrl: avatarUrls(profileId, version).avatarUrl } : {}),
    suspended: row.suspended === true,
    moderationLog: log.map((entry) => ({
      removed: entry.removed,
      reason: entry.reason,
      at: iso(entry.at),
      ...(entry.by ? { by: entry.by } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** SQL: the member of conversation `c` who isn't viewer `v` (a SQL parameter such as "$1"). */
export const otherMember = (v: string) => `(case when c.user_low = ${v} then c.user_high else c.user_low end)`;

/**
 * SQL: viewer `v` can see conversation `c`. They're in it; they didn't
 * decline it (declining hides it from the recipient only: the sender still
 * sees their request as waiting); neither blocks the other; and the other
 * member isn't suspended. private.send_message applies the same rules.
 */
export const conversationVisibleTo = (v: string) => `((c.user_low = ${v} or c.user_high = ${v})
  and not (c.status = 'declined' and c.initiator_id <> ${v})
  and not exists (select 1 from public.user_blocks b
                   where (b.blocker_id = c.user_low and b.blocked_id = c.user_high)
                      or (b.blocker_id = c.user_high and b.blocked_id = c.user_low))
  and not exists (select 1 from private.social_suspensions s where s.user_id = ${otherMember(v)}))`;

/** SQL: the viewer `v`'s last-read message id on conversation `c`. */
const lastReadBy = (v: string) => `(case when c.user_low = ${v} then c.low_last_read_id else c.high_last_read_id end)`;

/** SQL: conversation `c` has a message from the other member that viewer `v` hasn't read. */
export const hasUnread = (v: string) => `exists (select 1 from public.messages u
  where u.conversation_id = c.id and u.id > ${lastReadBy(v)} and u.sender_id <> ${v})`;

/** Characters of the last message shown in the conversation list. */
export const MESSAGE_PREVIEW_LENGTH = 140;

/**
 * Conversations as viewer `v` sees them; append `where ${conversationVisibleTo(v)} …`.
 * One row per conversation: the other member's name, the event (while it's
 * still published), the newest message and whether anything is unread.
 */
export const conversationSelect = (v: string) => `
  select c.id, c.status, c.initiator_id = ${v} as started_by_you,
         p.display_name as other_display_name,
         e.title as event_title, e.slug as event_slug,
         left(lm.body, ${MESSAGE_PREVIEW_LENGTH}) as last_preview, lm.created_at as last_sent_at,
         lm.sender_id = ${v} as last_from_you,
         ${hasUnread(v)} as unread
    from public.conversations c
    join public.profiles p on p.user_id = ${otherMember(v)}
    left join public.events e on e.id = c.event_id and e.status = 'published'
    join lateral (select m.body, m.created_at, m.sender_id from public.messages m
                   where m.conversation_id = c.id order by m.id desc limit 1) lm on true`;

/** Only the opaque conversation id and display names: never a user id or email. */
export function toConversation(row: Row): ConversationSummary {
  return {
    conversationId: row.id as string,
    otherDisplayName: row.other_display_name as string,
    status: row.status === "accepted" ? "active" : row.started_by_you === true ? "request_sent" : "request_received",
    event: row.event_slug ? { title: row.event_title as string, slug: row.event_slug as string } : undefined,
    lastMessage: {
      preview: row.last_preview as string,
      sentAt: iso(row.last_sent_at),
      fromYou: row.last_from_you === true,
    },
    unread: row.unread === true,
  };
}

/** For `select … from public.messages m`, as viewer `v`. */
export const messageColumns = (v: string) => `m.id::text as id, m.body, m.created_at, m.sender_id = ${v} as from_you`;

export function toMessage(row: Row): MessageRecord {
  return {
    messageId: row.id as string,
    body: row.body as string,
    sentAt: iso(row.created_at),
    fromYou: row.from_you === true,
  };
}

export function toBlock(row: Row): BlockRecord {
  return {
    blockId: row.id as string,
    displayName: opt(row.display_name),
    createdAt: iso(row.created_at),
  };
}

/** Admin view of a report: display names and copies of messages, never a user id or email. */
export const ADMIN_REPORT_SELECT = `
  select r.id, r.status, r.reason, r.details, r.created_at, r.reported_display_name,
         r.reported_user_id is not null as reported_account_exists,
         exists (select 1 from private.social_suspensions s where s.user_id = r.reported_user_id) as reported_suspended,
         e.title as event_title, r.message_body, r.context, r.resolved_at, r.resolution_note,
         r.target_type, r.reported_bio, r.reported_instagram, (r.reported_avatar is not null or r.reported_avatar_sha256 is not null) as has_reported_avatar,
         (select p.public_id from public.profiles p where p.user_id = r.reported_user_id) as reported_profile_id
    from private.user_reports r
    left join public.events e on e.id = r.event_id`;

export function toAdminReport(row: Row): AdminReport {
  const context = row.context as { from: "reporter" | "reported"; body: string; sentAt: string }[];
  return {
    reportId: row.id as string,
    status: row.status as AdminReport["status"],
    reason: row.reason as AdminReport["reason"],
    details: opt(row.details),
    createdAt: iso(row.created_at),
    reportedDisplayName: opt(row.reported_display_name),
    reportedAccountExists: row.reported_account_exists === true,
    reportedSuspended: row.reported_suspended === true,
    eventTitle: opt(row.event_title),
    messageBody: opt(row.message_body),
    context: context.map((m) => ({ from: m.from, body: m.body, sentAt: iso(m.sentAt) })),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined,
    resolutionNote: opt(row.resolution_note),
    targetType: row.target_type as AdminReport["targetType"],
    reportedProfileId: opt(row.reported_profile_id),
    reportedBio: opt(row.reported_bio),
    reportedInstagramHandle: opt(row.reported_instagram),
    ...(row.has_reported_avatar === true ? { reportedAvatarUrl: `/api/admin/reports/${row.id as string}/avatar` } : {}),
  };
}
