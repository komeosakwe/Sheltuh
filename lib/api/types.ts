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
  /** Unset if the blocked member has since deleted their profile. */
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
