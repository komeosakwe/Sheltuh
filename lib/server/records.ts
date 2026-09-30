/**
 * SQL for reading each record type, and the mappers from snake_case rows to
 * the camelCase API shapes in lib/api/types.ts. Nulls become undefined so
 * they drop out of JSON responses, matching the optional fields.
 */
import type {
  AdminReport,
  BlockRecord,
  ConversationSummary,
  EventRecord,
  GoingAttendee,
  IssuedTicket,
  MessageRecord,
  ModerationLogEntry,
  OrderRecord,
  OrganiserRecord,
  ProfileRecord,
  PublicEvent,
  TicketTypeInput,
} from "./types";

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

export const ORGANISER_SELECT = `
  select o.id, o.owner_user_id, o.display_name, o.contact_email, o.description,
         o.categories::text[] as categories, o.website_url, o.status::text as status,
         o.rejection_reason, o.reviewed_by, o.reviewed_at, o.stripe_account_id,
         o.payouts_enabled, o.created_at, o.updated_at
  from public.organisers o`;

export function toOrganiser(row: Row): OrganiserRecord {
  return {
    organiserId: row.id as string,
    ownerUserId: opt(row.owner_user_id),
    displayName: row.display_name as string,
    contactEmail: row.contact_email as string,
    description: row.description as string,
    categories: row.categories as OrganiserRecord["categories"],
    websiteUrl: opt(row.website_url),
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
