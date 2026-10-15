import type { EventCategory, FeePolicy } from "@/lib/types";
import type { PublicEvent } from "./public-events";

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

/** Most tickets one free order can have (POST …/checkout is a 400 beyond it). */
export const MAX_FREE_TICKETS_PER_ORDER = 4;

/**
 * POST /api/events/{eventId}/checkout.
 * - 201 `{url}`: go there. Stripe's checkout for a paid order; the
 *   confirmation page for a free order by a signed-in member booking with
 *   their own (verified) account email.
 * - 202 `{status: "confirmation_sent"}`: a free order by anyone else. A link
 *   to confirm it has been emailed to the address given (valid for
 *   `expiresInHours`); nothing is issued or held until it's confirmed.
 */
export type CheckoutResult = { url: string } | { status: "confirmation_sent"; expiresInHours: number };

/** POST /api/orders/confirm `{token}` (from the emailed link's fragment): 200 with the confirmation page's URL. */
export interface ConfirmFreeOrderResult {
  url: string;
}

/**
 * GET /api/orders/by-session/{orderId}: what the buyer's confirmation page
 * needs, and nothing more. The order id in the URL is the only credential, so
 * this never carries the order, event or organiser ids, the fee split, Stripe
 * ids, line items, timestamps or the full email address. A pending order is
 * `{ status: "pending" }` only.
 */
export interface CustomerOrder {
  status: Exclude<OrderStatus, "pending">;
  /** Short reference for support, e.g. "#7C1F2E0A" (the same one as in the ticket email). */
  reference: string;
  /** The event's title when the order was placed. */
  eventTitle: string;
  /** The event's current slug, for linking back to /events/{eventSlug}. Unset if the event is gone. */
  eventSlug?: string;
  /** The buyer's address, masked: "m***@example.com". Unset if none is on record. */
  maskedEmail?: string;
  subtotalCents: number;
  /** Booking fees the buyer paid (not any the organiser absorbed). */
  buyerFeeCents: number;
  totalCents: number;
  tickets: { ticketCode: string; ticketTypeName: string }[];
}

export type CustomerOrderLookup = CustomerOrder | { status: "pending" };

// ---------------------------------------------------------------------------
// Ticket email outbox (admin)
// ---------------------------------------------------------------------------

/**
 * `pending`: waiting for its next attempt. `sending`: a worker has it now.
 * `sent`: delivered to the mail server. `failed`: gave up after 6 attempts
 * (or the order can't be emailed); an admin can resend it.
 */
export type EmailJobStatus = "pending" | "sending" | "sent" | "failed";

export const EMAIL_JOB_STATUSES: readonly EmailJobStatus[] = ["failed", "pending", "sending", "sent"];

/**
 * GET /api/admin/emails. One ticket email. Never carries the buyer's full
 * address or the order id (the order page's credential): the order is shown
 * by its short reference only.
 */
export interface AdminEmailJob {
  /** Opaque. POST /api/admin/emails/{jobId}/resend. */
  jobId: string;
  kind: "ticket_email";
  status: EmailJobStatus;
  /** Attempts made since it was queued (or last resent). */
  attempts: number;
  /** When the next attempt is due (pending only). */
  nextAttemptAt?: string;
  /** Why the last attempt failed, with any address removed. */
  lastError?: string;
  createdAt: string;
  sentAt?: string;
  lastResendAt?: string;
  orderReference: string;
  orderStatus: OrderStatus;
  eventTitle: string;
  /** "m***@example.com". */
  maskedEmail?: string;
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

// ---------------------------------------------------------------------------
// Messages (Who's Going, increment 2)
// ---------------------------------------------------------------------------

/**
 * A conversation as the caller sees it:
 * - `request_sent`: the caller's first message is waiting for a reply. They
 *   can't send another until the other member replies. (A declined request
 *   still looks like this to its sender: declining is silent.)
 * - `request_received`: someone sent the caller a request. Replying accepts
 *   it; declining hides it.
 * - `active`: accepted; both can message.
 */
export type ConversationStatus = "request_sent" | "request_received" | "active";

/** One entry in GET /api/conversations. Never carries a user id or email. */
export interface ConversationSummary {
  /** Opaque. The only handle on the conversation (and on the other member). */
  conversationId: string;
  /** The other member's current display name. */
  otherDisplayName: string;
  status: ConversationStatus;
  /** The event both members were going to when the request was sent. Omitted once that event is unpublished or deleted. */
  event?: { title: string; slug: string };
  /** The newest message: up to 140 characters of it, and who sent it. */
  lastMessage: { preview: string; sentAt: string; fromYou: boolean };
  /** The other member has sent something the caller hasn't marked read. */
  unread: boolean;
}

export interface MessageRecord {
  /** Opaque, increasing within a conversation. Pass as `after` / `before` / `lastReadMessageId`. */
  messageId: string;
  /** Plain text: render as text, never as HTML. */
  body: string;
  sentAt: string;
  fromYou: boolean;
}

/** GET /api/conversations/{conversationId}/messages. `items` are oldest first. */
export interface MessagePage {
  conversation: ConversationSummary;
  items: MessageRecord[];
  /**
   * More messages exist beyond this page: newer ones when `after` was given,
   * older ones otherwise (the default page is the newest 50).
   */
  hasMore: boolean;
}

/** POST /api/conversations. `attendeeId` comes from the Who's Going list. */
export interface StartConversationInput {
  attendeeId: string;
  /** 1–1000 characters, plain text, no links. */
  body: string;
}

/** POST /api/conversations/{conversationId}/messages. */
export interface SendMessageInput {
  /** 1–1000 characters, plain text. */
  body: string;
}

/** GET /api/conversations/unread: conversations with something unread. */
export interface UnreadCount {
  count: number;
}

/** POST /api/blocks: exactly one of the two. */
export type BlockInput = { conversationId: string } | { attendeeId: string };

/** GET/POST /api/blocks. */
export interface BlockRecord {
  /** Opaque; DELETE /api/blocks/{blockId} unblocks. */
  blockId: string;
  /**
   * The blocked member's display name when they were blocked (a snapshot:
   * it doesn't follow later renames and survives their profile being
   * deleted). Unset if they had no profile then.
   */
  displayName?: string;
  createdAt: string;
}

export type ReportReason = "harassment" | "spam" | "inappropriate" | "impersonation" | "other";

/**
 * POST /api/reports: about a conversation (optionally one message in it,
 * which must be from the other member), or about a member on a Who's Going
 * list (by attendeeId). Exactly one of conversationId / attendeeId.
 */
export interface ReportInput {
  conversationId?: string;
  attendeeId?: string;
  messageId?: string;
  reason: ReportReason;
  /** Optional, up to 1000 characters. */
  details?: string;
}

export interface ReportReceipt {
  reportId: string;
  createdAt: string;
}

export type ReportStatus = "open" | "actioned" | "dismissed";

/** GET /api/admin/reports. Display names only: never a user id or email. */
export interface AdminReport {
  reportId: string;
  status: ReportStatus;
  reason: ReportReason;
  details?: string;
  createdAt: string;
  /** The reported member's display name when the report was made. */
  reportedDisplayName?: string;
  /** False once the reported member deleted their account. */
  reportedAccountExists: boolean;
  /** The reported member is currently suspended from social features. */
  reportedSuspended: boolean;
  eventTitle?: string;
  /** Copy of the reported message, kept even after it's deleted. */
  messageBody?: string;
  /** Copies of the last messages in the conversation up to the report (oldest first). */
  context: { from: "reporter" | "reported"; body: string; sentAt: string }[];
  resolvedAt?: string;
  resolutionNote?: string;
}

/** POST /api/admin/reports/{reportId}/resolve. `suspend` also suspends the reported member. */
export interface ResolveReportInput {
  action: "dismiss" | "suspend";
  /** Optional, up to 1000 characters; admin-only. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

/** Most events one account can favourite (PUT …/favourite is a 409 beyond it). */
export const MAX_FAVOURITES = 500;

/**
 * One entry in GET /api/favourites: the feed's public event shape, plus when
 * the caller favourited it. Only published events are listed (a favourite of
 * an event that's since been unpublished is kept, but hidden until it's
 * published again). Past events stay listed.
 */
export type FavouriteEvent = PublicEvent & {
  /** When the caller favourited it (the list is newest favourite first). */
  favouritedAt: string;
};

/** GET /api/favourites/ids: ids of the caller's favourited published events, newest favourite first (at most 500). */
export interface FavouriteIds {
  eventIds: string[];
}

/** PUT/DELETE /api/events/{eventId}/favourite. */
export interface FavouriteState {
  eventId: string;
  favourited: boolean;
}

// ---------------------------------------------------------------------------
// Organiser analytics (stages A and B)
// ---------------------------------------------------------------------------

/**
 * Where a page view came from, as bucketed by the browser before it's sent.
 * Nothing finer is stored (no referrer URL, no IP, no cookie, no visitor id).
 * `tracking` is set by the server when the view carried one of the event's
 * own tracking-link codes.
 */
export type ViewSource =
  | "direct"
  | "search"
  | "instagram"
  | "facebook"
  | "x"
  | "tiktok"
  | "email"
  | "eventbrite"
  | "other"
  | "tracking";

export const VIEW_SOURCES: readonly ViewSource[] = [
  "direct",
  "search",
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "email",
  "eventbrite",
  "other",
  "tracking",
];

/** POST /api/events/{eventId}/view (public). Both optional; anything unrecognised is ignored. */
export interface RecordViewInput {
  source?: ViewSource;
  /** A tracking-link code from the page URL (`?ref=`). Unknown codes are ignored. */
  code?: string;
}

/** Inclusive Australia/Melbourne calendar dates, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

/** Money in integer cents. `netCents` = `grossCents` − `feesCents`. */
export interface MoneyTotals {
  /** What buyers paid, booking fees they paid included. */
  grossCents: number;
  /** Sheltüh's booking fees (lib/fees.ts), whether the buyer paid them or the organiser absorbed them. */
  feesCents: number;
  /** The organiser's share: what Stripe pays out to them. */
  netCents: number;
}

/**
 * Counts and money for a period. Only `paid` orders count (free orders are
 * A$0 paid orders); pending, failed, refunded and refund-pending ones don't.
 * An order counts on the Melbourne day it was placed.
 */
export interface AnalyticsTotals extends MoneyTotals {
  /** Page views counted in the period (views before `viewsTrackedSince` weren't counted). */
  views: number;
  orders: number;
  ticketsSold: number;
  /**
   * orders ÷ views, unrounded. Null when there were no views, when part of
   * the period is before views were counted, or when `viewsUnreliable` (the
   * ratio would be misleading). Can exceed 1: views are capped per minute and
   * bots/blocked beacons aren't counted.
   */
  conversionRate: number | null;
  /**
   * On at least one day in the period the per-minute view cap was reached (a
   * burst of traffic, or someone flooding the counter), so some real views
   * may not have been counted: `views` is a lower bound. Always sent by the
   * API; optional so older clients and fixtures without it stay valid.
   */
  viewsUnreliable?: boolean;
}

/** One Melbourne day. `views` is null for days before view counting began. */
export interface AnalyticsDay extends MoneyTotals {
  date: string;
  views: number | null;
  /** The per-minute view cap was reached that day (by any of the organiser's events, in the overview): views are a lower bound. Always sent by the API. */
  viewsUnreliable?: boolean;
  orders: number;
  ticketsSold: number;
}

export interface SourceViews {
  source: ViewSource;
  views: number;
}

export interface TicketTypeSales extends MoneyTotals {
  ticketTypeId: string;
  name: string;
  /** Current price, fee policy and capacity. Unset for a ticket type that no longer exists. */
  priceCents?: number;
  feePolicy?: FeePolicy;
  quantityAvailable?: number;
  /** Tickets of this type in paid orders in the period. */
  ticketsSold: number;
  /** Ticket face value × quantity, before any booking fee. */
  faceValueCents: number;
}

/**
 * One tracking code's numbers. `linkId`/`label` are unset for a code whose
 * link has since been deleted (its counted views and orders are kept).
 */
export interface TrackingLinkStats extends MoneyTotals {
  code: string;
  linkId?: string;
  label?: string;
  views: number;
  orders: number;
  ticketsSold: number;
  /** orders ÷ views; null when views is 0. */
  conversionRate: number | null;
}

export interface AnalyticsEventSummary {
  eventId: string;
  title: string;
  slug: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  venueName: string;
  /** It's been approved at least once (it may since have been unpublished). */
  everPublished: boolean;
}

/** GET /api/organisers/me/events/{eventId}/analytics?from&to&compare. */
export interface EventAnalytics {
  event: AnalyticsEventSummary;
  range: DateRange;
  /** First Melbourne day page views were counted (platform-wide), or null if never. */
  viewsTrackedSince: string | null;
  totals: AnalyticsTotals;
  /** Every day in the range, oldest first, zero-filled. */
  byDay: AnalyticsDay[];
  /** Every source bucket, in VIEW_SOURCES order, zero-filled. */
  bySource: SourceViews[];
  /** Current ticket types in event order (zero-filled), then any that no longer exist but sold in the period. */
  byTicketType: TicketTypeSales[];
  /** Current tracking links (newest first, zero-filled), then codes of deleted links with activity. */
  trackingLinks: TrackingLinkStats[];
  /** With `compare=prevPeriod`: the period of the same length ending the day before `range.from`. */
  previous?: { range: DateRange; totals: AnalyticsTotals; byDay: AnalyticsDay[] };
}

export interface AnalyticsOverviewEvent {
  eventId: string;
  title: string;
  slug: string;
  status: EventStatus;
  startsAt: string;
  totals: AnalyticsTotals;
  /** With `compare=prevPeriod`. */
  previous?: AnalyticsTotals;
}

/** GET /api/organisers/me/analytics/overview?from&to&compare. */
export interface AnalyticsOverview {
  range: DateRange;
  viewsTrackedSince: string | null;
  totals: AnalyticsTotals;
  byDay: AnalyticsDay[];
  /**
   * Every one of the organiser's events (any status, activity or not):
   * upcoming soonest first, then past most recent first. At most 500.
   */
  events: AnalyticsOverviewEvent[];
  /** More than 500 events: the rest aren't listed (they're still in `totals`). */
  eventsTruncated: boolean;
  previous?: { range: DateRange; totals: AnalyticsTotals; byDay: AnalyticsDay[] };
}

/** Optional query for the analytics routes. Defaults: an event's whole life (capped), or the last 30 days. */
export interface AnalyticsQuery {
  from?: string;
  to?: string;
  /** Also return the previous period of the same length. */
  compare?: "prevPeriod";
}

/** A shareable link that attributes views and orders to where it was posted. */
export interface TrackingLink {
  linkId: string;
  /** 8 characters from [2-9a-hjkmnp-z]; goes in the event URL as `?ref=`. */
  code: string;
  /** 1–40 characters, unique per event. */
  label: string;
  /** The event page URL carrying the code: `{site}/events/{slug}?ref={code}`. */
  url: string;
  createdAt: string;
  /** All-time numbers for this code (since the link was created). */
  views: number;
  orders: number;
  ticketsSold: number;
  grossCents: number;
}

/** POST /api/organisers/me/events/{eventId}/tracking-links. */
export interface CreateTrackingLinkInput {
  label: string;
}

/** Most tracking links per event. */
export const MAX_TRACKING_LINKS_PER_EVENT = 20;
