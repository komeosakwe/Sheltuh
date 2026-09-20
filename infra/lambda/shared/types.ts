export type EventCategory = "live-music" | "art" | "workshop" | "pop-up" | "theatre";

export const EVENT_CATEGORIES: EventCategory[] = [
  "live-music",
  "art",
  "workshop",
  "pop-up",
  "theatre",
];

export type FeePolicy = "buyer-pays" | "organiser-absorbs";

export interface TicketTypeInput {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  feePolicy: FeePolicy;
  quantityAvailable: number;
}

export type OrganiserStatus = "pending" | "approved" | "rejected";

export interface OrganiserRecord {
  ownerUserId: string;
  organiserId: string;
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
  status: OrganiserStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Stripe Connect Express account id, once onboarding has started. */
  stripeAccountId?: string;
  /**
   * Mirrors the Connect account's `charges_enabled && payouts_enabled` as of
   * the last status refresh (organisers/connectStatus.ts) — a paid event
   * can't be sold until this is true, since there's nowhere for the money
   * to go.
   */
  payoutsEnabled?: boolean;
}

export type EventStatus = "draft" | "pending_review" | "published" | "rejected";

export interface ModerationLogEntry {
  action: "submitted" | "approved" | "rejected" | "unpublished";
  by: string;
  at: string;
  reason?: string;
}

export interface EventRecord {
  organiserId: string;
  eventId: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  organiserName: string;
  ticketTypes: TicketTypeInput[];
  status: EventStatus;
  rejectionReason?: string;
  moderationLog: ModerationLogEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields the public feed is allowed to expose. Never spread a raw EventRecord
 * into a public response. `organiserId` is not sensitive (it's just an id,
 * already embedded in every ticket-type id's provenance) and the checkout
 * route needs it — /events/{organiserId}/{eventId}/checkout mirrors the same
 * composite key every other event route already uses.
 */
export type PublicEvent = Pick<
  EventRecord,
  | "organiserId"
  | "eventId"
  | "slug"
  | "title"
  | "description"
  | "category"
  | "venueName"
  | "venueAddress"
  | "suburb"
  | "startsAt"
  | "endsAt"
  | "organiserName"
  | "ticketTypes"
>;

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

/** Fields the applicant's own "my application" view is allowed to see — no reviewer identity. */
export type OwnOrganiserView = Omit<OrganiserRecord, "reviewedBy">;

export function toOwnOrganiserView(record: OrganiserRecord): OwnOrganiserView {
  const { reviewedBy: _reviewedBy, ...rest } = record;
  return rest;
}

// ---------------------------------------------------------------------------
// Orders / payments
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  /** Payment succeeded but inventory ran out between checkout and webhook — needs a manual refund. See orders/webhook.ts. */
  | "oversold_refund_required";

export interface OrderLineItem {
  ticketTypeId: string;
  ticketTypeName: string;
  unitPriceCents: number;
  feePolicy: FeePolicy;
  quantity: number;
}

export interface IssuedTicket {
  ticketCode: string;
  ticketTypeId: string;
  ticketTypeName: string;
}

export interface OrderRecord {
  orderId: string;
  organiserId: string;
  eventId: string;
  eventTitle: string;
  /** Collected by Stripe Checkout itself — this app never requires a Sheltüh account to buy a ticket. */
  buyerEmail?: string;
  lineItems: OrderLineItem[];
  subtotalCents: number;
  buyerFeeCents: number;
  totalCents: number;
  /** What the platform keeps — mirrors Stripe's application_fee_amount on the PaymentIntent. */
  applicationFeeCents: number;
  status: OrderStatus;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  tickets: IssuedTicket[];
  createdAt: string;
  updatedAt: string;
}

/** Per (event, ticket type) sold counter — separate from EventRecord so the decrement can be a single atomic conditional update, not a nested-list update on the event item. */
export interface TicketInventoryRecord {
  eventId: string;
  ticketTypeId: string;
  quantityAvailable: number;
  quantitySold: number;
}
