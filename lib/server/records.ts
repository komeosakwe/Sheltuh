/**
 * SQL for reading each record type, and the mappers from snake_case rows to
 * the camelCase API shapes in lib/api/types.ts. Nulls become undefined so
 * they drop out of JSON responses, matching the optional fields.
 */
import type {
  EventRecord,
  IssuedTicket,
  ModerationLogEntry,
  OrderRecord,
  OrganiserRecord,
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
