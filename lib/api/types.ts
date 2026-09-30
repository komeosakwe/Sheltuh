import type { EventCategory, FeePolicy } from "@/lib/types";

export type OrganiserStatus = "pending" | "approved" | "rejected";

export interface OrganiserRecord {
  /** Unset for a platform-managed organiser that has no account of its own. */
  ownerUserId?: string;
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
  stripeAccountId?: string;
  payoutsEnabled?: boolean;
}

export type EventStatus = "draft" | "pending_review" | "published" | "rejected";

export interface TicketTypeInput {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  feePolicy: FeePolicy;
  quantityAvailable: number;
}

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
  /** Same-origin path of the organiser's photo, if one was uploaded. Versioned (?v=) so it caches safely. */
  imageUrl?: string;
  ticketTypes: TicketTypeInput[];
  status: EventStatus;
  rejectionReason?: string;
  moderationLog: ModerationLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * `oversold_refund_required`: paid, but the tickets sold out first — refund
 * not yet confirmed. `refunded`: Stripe has accepted that refund.
 */
export type OrderStatus = "pending" | "paid" | "failed" | "oversold_refund_required" | "refunded";

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
  /** The event's title when the order was placed. */
  eventTitle: string;
  /** The event's current slug, for linking back to /events/{eventSlug}. */
  eventSlug: string;
  buyerEmail?: string;
  lineItems: OrderLineItem[];
  subtotalCents: number;
  buyerFeeCents: number;
  totalCents: number;
  applicationFeeCents: number;
  status: OrderStatus;
  /** Unset for free orders, which never touch Stripe. */
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  tickets: IssuedTicket[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Who's Going
// ---------------------------------------------------------------------------

/** The caller's own social profile (GET/PUT /api/profiles/me). */
export interface ProfileRecord {
  /** 1–40 characters. Shown to other verified members on events you opt in to. */
  displayName: string;
  /**
   * Suspended by Sheltüh: hidden from every Who's Going list and count, can't
   * opt in, see names, or change (or recreate) the profile.
   */
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileInput {
  displayName: string;
  /** Required (true) when creating a profile; ignored when renaming one. */
  adultConfirmed?: boolean;
}

/** Public: GET /api/events/{eventId}/going. */
export interface GoingSummary {
  /**
   * Members who opted in. 0 when `closed`, and 0 when `countHidden`: below 3
   * (GOING_COUNT_THRESHOLD in lib/server/handlers/going.ts) the real number
   * (0, 1 or 2) isn't revealed.
   */
  count: number;
  /** The event has ended, or Who's Going is switched off for it: show nothing. */
  closed: boolean;
  /** Fewer than 3 are going, so `count` is withheld (sent as 0). Always false when `closed`. */
  countHidden: boolean;
}

/** One entry in GET /api/events/{eventId}/going/attendees (verified members only). */
export interface GoingAttendee {
  /** Opaque, and different on every event for the same person. */
  attendeeId: string;
  displayName: string;
  /** This entry is the caller. */
  isYou: boolean;
}

/** GET/PUT/DELETE /api/events/{eventId}/going/me. */
export interface MyGoingStatus {
  /** The caller has opted in to being shown on this event. */
  going: boolean;
  /**
   * The caller could opt in right now if they have a profile: email verified,
   * a paid (or free) ticket bought with that email, not suspended, and the
   * event still open.
   */
  eligible: boolean;
  hasProfile: boolean;
}
