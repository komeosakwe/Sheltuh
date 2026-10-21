/**
 * SQL for reading each record type, and the mappers from snake_case rows to
 * the camelCase API shapes in lib/api/types.ts. Nulls become undefined so
 * they drop out of JSON responses, matching the optional fields.
 */
import type { Db } from "./db";
import type {
  AdminEmailJob,
  AdminOrganiserRecord,
  AdminReport,
  BlockRecord,
  ConversationSummary,
  CustomerOrder,
  EventRecord,
  GoingAttendee,
  IssuedTicket,
  MessageRecord,
  ModerationLogEntry,
  OrderRecord,
  OrganiserEditEntry,
  OrganiserEditField,
  OrganiserRecord,
  ProfileRecord,
  PublicEvent,
  PublicOrganiserProfile,
  TicketTypeInput,
} from "./types";
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

const ORGANISER_COLUMNS = `o.id, o.owner_user_id, o.display_name, o.contact_email, o.description,
         o.categories::text[] as categories, o.website_url,
         o.instagram_handle, o.tiktok_handle, o.facebook_page, o.x_handle, o.status::text as status,
         o.rejection_reason, o.reviewed_by, o.reviewed_at, o.stripe_account_id,
         o.payouts_enabled, o.created_at, o.updated_at`;

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
                                             'reason', x.reason) order by x.id desc)
           from (select pe.id, pe.kind, pe.edited_at, pe.changed_fields, pe.reason
                   from private.organiser_profile_edits pe
                  where pe.organiser_id = o.id
                  order by pe.id desc
                  limit ${ADMIN_ORGANISER_EDIT_LIMIT}) x
         ), '[]'::json) as recent_edits
  from public.organisers o`;

/** organisers column → API field, for the log's changed_fields keys. */
const EDIT_FIELDS: Record<string, OrganiserEditField> = {
  description: "description",
  website_url: "websiteUrl",
  instagram_handle: "instagramHandle",
  tiktok_handle: "tiktokHandle",
  facebook_page: "facebookPage",
  x_handle: "xHandle",
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
}): OrganiserEditEntry {
  const changes: OrganiserEditEntry["changes"] = {};
  for (const [column, change] of Object.entries(entry.changes)) {
    const field = EDIT_FIELDS[column];
    if (field) changes[field] = { old: toEditValue(change.old), new: toEditValue(change.new) };
  }
  return { kind: entry.kind, at: iso(entry.at), changes, reason: opt(entry.reason) };
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
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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
         to_char(o.created_at at time zone 'Australia/Melbourne', 'YYYY-MM') as member_since
  from public.organisers o`;

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
    upcomingEvents,
    recentEvents,
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const EVENT_SELECT = `
  select e.id, e.organiser_id, e.slug, e.title, e.description, e.category::text as category,
         e.venue_name, e.venue_address, e.suburb, e.starts_at, e.ends_at,
         e.status::text as status, e.rejection_reason, e.created_at, e.updated_at,
         o.display_name as organiser_name,
         (select '/api/events/' || e.id::text || '/image?v=' || floor(extract(epoch from i.updated_at))::bigint::text
            from public.event_images i where i.event_id = e.id) as image_url,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object(
                    'id', t.id, 'name', t.name, 'description', t.description,
                    'priceCents', t.price_cents, 'feePolicy', t.fee_policy,
                    'quantityAvailable', t.quantity_available)) order by t.position)
           from public.ticket_types t where t.event_id = e.id
         ), '[]'::json) as ticket_types,
         coalesce((
           select json_agg(json_strip_nulls(json_build_object(
                    'action', l.action, 'by', coalesce(l.actor_id::text, 'system'),
                    'at', l.created_at, 'reason', l.reason)) order by l.id)
           from public.event_moderation_log l where l.event_id = e.id
         ), '[]'::json) as moderation_log
  from public.events e
  join public.organisers o on o.id = e.organiser_id`;

export function toEvent(row: Row): EventRecord {
  const log = row.moderation_log as ModerationLogEntry[];
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
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    organiserName: row.organiser_name as string,
    imageUrl: opt(row.image_url),
    ticketTypes: row.ticket_types as TicketTypeInput[],
    status: row.status as EventRecord["status"],
    rejectionReason: opt(row.rejection_reason),
    moderationLog: log.map((entry) => ({ ...entry, at: iso(entry.at) })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The only event fields the public (unauthenticated) routes may expose. */
export function toPublicEvent(event: EventRecord): PublicEvent {
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
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const ORDER_SELECT = `
  select o.id, o.event_id, o.organiser_id, o.event_title, o.buyer_email, o.line_items,
         o.subtotal_cents, o.buyer_fee_cents, o.total_cents, o.application_fee_cents,
         o.status::text as status, o.stripe_checkout_session_id, o.stripe_payment_intent_id,
         o.created_at, o.updated_at,
         (select e.slug from public.events e where e.id = o.event_id) as event_slug,
         coalesce((
           select json_agg(json_build_object(
                    'ticketCode', t.code, 'ticketTypeId', t.ticket_type_id,
                    'ticketTypeName', t.ticket_type_name) order by t.ticket_type_id, t.code)
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
    status: row.status as OrderRecord["status"],
    stripeCheckoutSessionId: opt(row.stripe_checkout_session_id),
    stripePaymentIntentId: opt(row.stripe_payment_intent_id),
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
 * isn't paid. `tickets_issued` tells a paid-then-refunded order (it had
 * tickets) from one refunded because it couldn't be fulfilled (it never did).
 * Reads the event by primary key and the tickets by tickets_order_idx.
 */
export const CUSTOMER_ORDER_SELECT = `
  select o.id, o.status::text as status, o.event_title, o.buyer_email,
         o.subtotal_cents, o.buyer_fee_cents, o.total_cents,
         e.slug as event_slug, e.starts_at as event_starts_at, e.ends_at as event_ends_at,
         e.venue_name as event_venue_name, e.suburb as event_suburb,
         coalesce((
           select json_agg(json_build_object('ticketCode', t.code, 'ticketTypeName', t.ticket_type_name,
                                             'checkedInAt', t.checked_in_at)
                           order by t.ticket_type_id, t.code)
           from public.tickets t where t.order_id = o.id and o.status = 'paid'
         ), '[]'::json) as tickets,
         exists (select 1 from public.tickets t where t.order_id = o.id) as tickets_issued
  from public.orders o
  left join public.events e on e.id = o.event_id`;

/** Why a refunded (or refund-pending) order was refunded; undefined for any other status. */
function refundReason(status: CustomerOrder["status"], ticketsIssued: boolean): CustomerOrder["refundReason"] {
  if (status === "oversold_refund_required") return "oversold";
  if (status === "refunded") return ticketsIssued ? "refunded" : "oversold";
  return undefined;
}

type CustomerTicketRow = { ticketCode: string; ticketTypeName: string; checkedInAt: string | null };

export function toCustomerOrder(row: Row): CustomerOrder {
  const email = opt<string>(row.buyer_email);
  const status = row.status as CustomerOrder["status"];
  const paid = status === "paid";
  // Belt and braces with the SQL: never a code for an order that isn't paid.
  const tickets = paid
    ? (row.tickets as CustomerTicketRow[]).map((t) => ({
        ticketCode: t.ticketCode,
        ticketTypeName: t.ticketTypeName,
        checkedInAt: t.checkedInAt ? iso(t.checkedInAt) : null,
      }))
    : [];
  return {
    status,
    refundReason: refundReason(status, row.tickets_issued === true),
    reference: orderReference(row.id as string),
    eventTitle: row.event_title as string,
    eventSlug: opt(row.event_slug),
    // What the tickets show: only while they're valid.
    eventStartsAt: paid && row.event_starts_at ? iso(row.event_starts_at) : undefined,
    eventEndsAt: paid && row.event_ends_at ? iso(row.event_ends_at) : undefined,
    venueName: paid ? opt(row.event_venue_name) : undefined,
    suburb: paid ? opt(row.event_suburb) : undefined,
    maskedEmail: email ? maskEmail(email) : undefined,
    subtotalCents: row.subtotal_cents as number,
    buyerFeeCents: row.buyer_fee_cents as number,
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

// ---------------------------------------------------------------------------
// Profiles and Who's Going
// ---------------------------------------------------------------------------

/**
 * For `select … from public.profiles` (unaliased) and `insert/update
 * public.profiles … returning`. Suspension lives in private.social_suspensions
 * (profiles.social_suspended_at is deprecated and ignored).
 */
export const PROFILE_COLUMNS = `display_name, created_at, updated_at,
  exists (select 1 from private.social_suspensions s where s.user_id = profiles.user_id) as suspended`;

export function toProfile(row: Row): ProfileRecord {
  return {
    displayName: row.display_name as string,
    suspended: row.suspended === true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Only ever the opaque per-event id and the display name: never a user id, email or ticket. */
export function toGoingAttendee(row: Row): GoingAttendee {
  return {
    attendeeId: row.id as string,
    displayName: row.display_name as string,
    isYou: row.is_you === true,
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
         e.title as event_title, r.message_body, r.context, r.resolved_at, r.resolution_note
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
  };
}
