import type { RefundPolicy } from "@/lib/refund-policy";
import type { TicketingMode } from "@/lib/ticketing";
import type { EventCategory, EventClip, FeePolicy } from "@/lib/types";
import type { FeaturedVideo } from "./featured-video";
import type { PublicEvent } from "./public-events";
import type { SeatMapTemplate, TicketSeat } from "@/lib/seating/template";

export type { FeaturedVideo, FeaturedVideoProvider } from "./featured-video";
export type { EventClip } from "@/lib/types";

export type { TicketingMode } from "@/lib/ticketing";
export type { RefundPolicy } from "@/lib/refund-policy";
export type { SeatKind, SeatMapTemplate, TicketSeat } from "@/lib/seating/template";

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
  /** Social handles, stored without a leading '@'. Public as links on the organiser's profile. */
  instagramHandle?: string;
  tiktokHandle?: string;
  /** The page's username, as in facebook.com/<page>. */
  facebookPage?: string;
  xHandle?: string;
  status: OrganiserStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  stripeAccountId?: string;
  payoutsEnabled?: boolean;
  /**
   * The organiser's featured video (YouTube or Vimeo), stored as provider and
   * id only. Unset when there's none. Public on their profile once approved.
   */
  featuredVideo?: FeaturedVideo;
  /**
   * The organiser's logo (512 px square WebP), when they've uploaded one:
   * `/api/organisers/{organiserId}/logo?v={version}`. Public once approved
   * (otherwise only an admin, or the owner, with a bearer token); the thumbnail
   * (96 px) is the same URL with `size=thumb`. Versioned, so it caches safely.
   */
  logoUrl?: string;
}

/** A field an organiser-log entry can record a change to (`status` only for a takedown). */
export type OrganiserEditField =
  | "description"
  | "websiteUrl"
  | "instagramHandle"
  | "tiktokHandle"
  | "facebookPage"
  | "xHandle"
  | "status";

/**
 * Every field the organiser log can name: OrganiserEditField plus
 * `featuredVideo`, whose values are "youtube:{id}" / "vimeo:{id}", and
 * `logo`, whose values are the logo's version (milliseconds since the epoch
 * of the upload, as a decimal string; null: none).
 */
export type OrganiserLogField = OrganiserEditField | "featuredVideo" | "logo";

/** One field's value before and after; null means it was (or became) unset. */
export interface OrganiserEditChange {
  old: string | null;
  new: string | null;
}

/**
 * One entry of an organiser's append-only change log (admin only).
 * `profile_edit`: the approved organiser changed their public profile
 * (no review). `suspended`: an admin took them down, with `reason`.
 * `invite_accepted`: the organiser's account accepted an admin's invite,
 * which created the organiser, approved.
 */
export interface OrganiserEditEntry {
  /** `invite_accepted`: the organiser was created by an accepted admin invite (`changes.status`: null → approved). */
  kind: "profile_edit" | "suspended" | "invite_accepted";
  at: string;
  /** Only the fields that changed. */
  changes: Partial<Record<OrganiserLogField, OrganiserEditChange>>;
  /**
   * The admin's reason: for `suspended`, and for a `profile_edit` made by an
   * admin (`byStaff`, e.g. removing the featured video).
   */
  reason?: string;
  /** A `profile_edit` made by Sheltüh staff (an admin), not the organiser. */
  byStaff?: boolean;
}

/** The admin queue's view of an organiser: the full record plus its newest log entries. */
export interface AdminOrganiserRecord extends OrganiserRecord {
  /** Newest first, at most 20. */
  recentEdits: OrganiserEditEntry[];
}

/** POST /api/admin/organisers/{id}/suspend. */
export interface SuspendOrganiserResult {
  organiser: AdminOrganiserRecord;
  /** Published events moved back to draft (no longer visible or bookable). */
  eventsUnpublished: number;
  /** Events that were waiting for review, now rejected. */
  submissionsRejected: number;
}

/** https URLs the server builds from an organiser's handles; only the ones they've set. */
export interface OrganiserSocialLinks {
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  x?: string;
}

/**
 * GET /api/organisers/{organiserId}/profile: an approved organiser's public
 * profile. Never their contact email, account, Stripe or review details.
 */
export interface PublicOrganiserProfile {
  organiserId: string;
  displayName: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
  socialLinks: OrganiserSocialLinks;
  /** "YYYY-MM" (Melbourne): the month the organiser joined. */
  memberSince: string;
  /** Always sent (null when there's none); optional so older fixtures stay valid. */
  featuredVideo?: FeaturedVideo | null;
  /**
   * Members following the organiser, only once it's 10 or more
   * (FOLLOWER_COUNT_THRESHOLD); null below that. Always sent; optional so
   * older fixtures stay valid.
   */
  followerCount?: number | null;
  /** Published events that have ended ("Events hosted"). Always sent; optional so older fixtures stay valid. */
  eventsHosted?: number;
  /** The organiser's logo (512 px; public, versioned), only when they have one. See OrganiserRecord.logoUrl. */
  logoUrl?: string;
  /** Published events that haven't ended, soonest first. */
  upcomingEvents: PublicEvent[];
  /** Published events that have ended, most recent first. Together with upcomingEvents, at most 24. */
  recentEvents: PublicEvent[];
}

export type EventStatus = "draft" | "pending_review" | "published" | "rejected";

export interface TicketTypeInput {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  feePolicy: FeePolicy;
  /**
   * For a seated tier (`seated`), the number of its seats that aren't
   * blocked: set by the seat map, whatever an edit sends.
   */
  quantityAvailable: number;
  /**
   * Sent (as true) only for a tier with seats on the event's seat map
   * (docs/architecture.md, "Reserved seating"): it's sold only by choosing
   * seats (POST …/checkout `seats`), never as a quantity. Absent otherwise,
   * so a general admission event's payload is unchanged. Ignored in edits.
   */
  seated?: true;
}

/** An event's seat map, as event records carry it (absent: general admission only). */
export interface EventSeating {
  /** The map's version: GET /events/{id}/seat-map?v={version}. Never reused. */
  version: number;
  seatCount: number;
}

/** One changed field of a `ticketing_changed` log entry: its value before and after. */
export interface TicketingFieldChange<T> {
  old: T | null;
  new: T | null;
}

/** What an admin's ticketing change changed: only the fields that did. */
export interface TicketingChanges {
  ticketingMode?: TicketingFieldChange<TicketingMode>;
  externalTicketUrl?: TicketingFieldChange<string>;
  externalFree?: TicketingFieldChange<boolean>;
}

/**
 * What an admin's edit changed (`edited`): only the fields that did. Dates
 * are ISO instants with an offset; ticket types are the whole list before
 * and after. `image` is "set" while there's a photo, null otherwise (set →
 * set is a replaced photo). `clip` is the clip's version (the `v` of its
 * URL, milliseconds as a string), null for none; `clipDescription` its text.
 */
export interface EventEditChanges {
  title?: TicketingFieldChange<string>;
  description?: TicketingFieldChange<string>;
  category?: TicketingFieldChange<EventCategory>;
  venueName?: TicketingFieldChange<string>;
  venueAddress?: TicketingFieldChange<string>;
  suburb?: TicketingFieldChange<string>;
  startsAt?: TicketingFieldChange<string>;
  endsAt?: TicketingFieldChange<string>;
  ticketTypes?: TicketingFieldChange<TicketTypeInput[]>;
  image?: TicketingFieldChange<"set">;
  /** An admin replaced or removed the seat map (or switched the event to external ticketing, removing it). */
  seatMap?: TicketingFieldChange<EventSeating>;
  /** An admin added, replaced or removed the clip (its versions). */
  clip?: TicketingFieldChange<string>;
  /** An admin changed the clip's description. */
  clipDescription?: TicketingFieldChange<string>;
  /** An admin changed the refund policy (lib/refund-policy.ts). */
  refundPolicy?: TicketingFieldChange<RefundPolicy>;
  /** An admin changed the refund policy's days (null for `no_change_of_mind`). */
  refundDays?: TicketingFieldChange<number>;
}

/** ModerationLogEntry.by for an admin's entry in an organiser's view: never the admin's account id. */
export const SHELTUH_TEAM_ACTOR = "Sheltüh team";

export interface ModerationLogEntry {
  /**
   * `ticketing_changed`: an admin changed the event's ticketing (PATCH
   * /admin/events/{id}/ticketing, or the ticketing part of PATCH
   * /admin/events/{id}). `created`: an admin created the event (POST
   * /admin/events). `edited`: an admin changed anything else, its photo
   * included. `curated`: an admin changed the event's trending boost or
   * exclusion; never in an event's `moderationLog` (admins see those entries
   * through GET /admin/events/{id}/curation).
   */
  action:
    | "submitted"
    | "approved"
    | "rejected"
    | "unpublished"
    | "ticketing_changed"
    | "created"
    | "edited"
    | "curated";
  /**
   * Who acted: an account id, or `"system"`. In the organiser's own view of
   * their event, every actor other than the organiser's account (an admin)
   * is SHELTUH_TEAM_ACTOR instead: admins' ids are only shown to admins.
   */
  by: string;
  at: string;
  reason?: string;
  /** For `ticketing_changed` and `edited` only: the old and new value of each field that changed. */
  changes?: TicketingChanges & EventEditChanges;
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
  /**
   * The event's clip, only when it has one (absent otherwise). Its `url`
   * plays only once the event is published; before that, the owner or an
   * admin previews it with GET /events/{id}/clip/preview (lib/api/clips.ts).
   */
  clip?: EventClip;
  /**
   * The organiser's logo thumbnail (96 px square WebP, public, versioned),
   * only when they have a logo and are approved.
   */
  organiserLogoThumbUrl?: string;
  /** Always empty for an external event. */
  ticketTypes: TicketTypeInput[];
  /**
   * Where tickets are sold: `sheltuh` (here, the default) or `external` (on
   * another site, at `externalTicketUrl`; no Sheltüh checkout, booking fee,
   * Who's Going or check-in). Always sent by the API; optional so older
   * fixtures stay valid (absent means `sheltuh`).
   */
  ticketingMode?: TicketingMode;
  /** External events only: the ticket page, as stored (the URL parser's form: lower-case host, punycode). */
  externalTicketUrl?: string;
  /** External events only: the organiser says entry is free. Always sent (false for Sheltüh-ticketed events). */
  externalFree?: boolean;
  /**
   * External events only: the ticketing site's name for "Get tickets on
   * {provider}" (lib/ticketing.ts, ticketProviderName), or null for a site
   * that isn't on the known list, which the UI calls "the organiser's site".
   * Always sent; null for Sheltüh-ticketed events.
   */
  externalProvider?: string | null;
  /**
   * The event has been approved at least once, so the organiser can no longer
   * change `ticketingMode` or `externalTicketUrl` (a PATCH that tries is a
   * 409); only an admin can. Always sent.
   */
  ticketingLocked?: boolean;
  /**
   * The event's refund policy (lib/refund-policy.ts: refundPolicySummary
   * says it): `no_change_of_mind` (the default) or `days_before`. Always sent
   * by the API; optional so older fixtures stay valid (absent means
   * `no_change_of_mind`). The organiser can change it only while the event is
   * a draft or rejected; once it has pending or paid orders (an unpublished
   * event, or an admin's edit of any event), only to a more generous one
   * (lib/refund-policy.ts, tightensRefundPolicy): ApiError 409 `code:
   * "refund_policy_tightened"` otherwise.
   */
  refundPolicy?: RefundPolicy;
  /** `days_before` only: refunds up to this many days (1–30) before the event starts. Absent otherwise. */
  refundDays?: number;
  /**
   * The event's seat map, when it has one. The organiser can change the map
   * only while `ticketingLocked` is false (never approved) and the event is a
   * draft or rejected; after that only an admin, while it has no orders.
   */
  seating?: EventSeating;
  status: EventStatus;
  rejectionReason?: string;
  moderationLog: ModerationLogEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * PATCH /api/admin/events/{eventId}/ticketing (admin): sets an event's
 * ticketing whatever its status, logged as `ticketing_changed` with `reason`.
 */
export interface AdminSetEventTicketingInput {
  ticketingMode: TicketingMode;
  /** Required for `external`; must be absent, null or empty for `sheltuh`. */
  externalTicketUrl?: string | null;
  /** `external` only (default false); must be absent or false for `sheltuh`. */
  externalFree?: boolean;
  /** 1–500 characters, shown in the event's moderation log (the organiser sees it). */
  reason: string;
}

/** An event as the admin authoring routes return it (GET, POST and PATCH /admin/events…). */
export interface AdminEventRecord extends EventRecord {
  /**
   * The organiser has no owner account: it can only have free Sheltüh
   * tickets or external ticketing, and only admins check its events in.
   */
  organiserPlatformManaged: boolean;
  /**
   * The event's trending curation (set through PUT
   * /admin/events/{eventId}/curation, whose GET also has the log). An event
   * an admin never curated: boost 1, excluded false.
   */
  curation: AdminEventCurationState;
}

/** An event's trending curation as AdminEventRecord carries it. */
export interface AdminEventCurationState {
  /** Multiplies the event's trending score: 0.5 to 2, default 1. */
  boost: number;
  /** Kept out of trending whatever its score. */
  excluded: boolean;
}

/**
 * POST /api/admin/organisers: a platform-managed organiser (no owner
 * account), approved straight away. The fields and their rules are an
 * organiser application's.
 */
export interface AdminCreateOrganiserInput {
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  /** https:// only. */
  websiteUrl?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  facebookPage?: string | null;
  xHandle?: string | null;
  /** A YouTube or Vimeo link (see lib/api/featured-video.ts); null or "" for none. */
  featuredVideoUrl?: string | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * `oversold_refund_required`: paid, but the tickets sold out first (or the
 * event was unpublished) — refund not yet confirmed. `refunded`: Stripe has
 * accepted that refund, or a paid order was refunded in full afterwards (e.g.
 * from the Stripe dashboard), voiding its tickets. A partial refund leaves an
 * order `paid`.
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
  /** The ticket's seat, for a seated order (lib/seating/format.ts says it). */
  seat?: TicketSeat;
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
  /** What the buyer paid: subtotal, buyer-paid fees and any Support Sheltüh. */
  totalCents: number;
  /** The booking fee (the platform's, whoever paid it). Never includes Support Sheltüh. */
  applicationFeeCents: number;
  /** Support Sheltüh (lib/support.ts), all of it the platform's: only when the buyer added some. */
  supportCents?: number;
  status: OrderStatus;
  /** Unset for free orders, which never touch Stripe. */
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  /** A seated order's seats (ids on the event's seat map); absent for general admission. */
  seatIds?: string[];
  tickets: IssuedTicket[];
  createdAt: string;
  updatedAt: string;
}

/** Most tickets one free order can have (POST …/checkout is a 400 beyond it). */
export const MAX_FREE_TICKETS_PER_ORDER = 4;

/**
 * POST /api/events/{eventId}/checkout.
 * - 201 `{url}`: go there. For a paid order (with `orderId`) it's our own
 *   payment page, `/checkout/pay?order={orderId}` (relative), which mounts
 *   Stripe's embedded form (getOrderPayment); for a free order by a signed-in
 *   member booking with their own (verified) account email, the confirmation
 *   page.
 * - 202 `{status: "confirmation_sent"}`: a free order by anyone else. A link
 *   to confirm it has been emailed to the address given (valid for
 *   `expiresInHours`); nothing is issued or held until it's confirmed.
 * - 503: card payments aren't configured on this deploy (paid orders only;
 *   nothing was created or held).
 */
export type CheckoutResult =
  | {
      url: string;
      /**
       * A seated paid checkout only: when the seats' hold ends (ISO 8601).
       * Stripe's form closes a few minutes before (SEAT_HOLD.stripeMinutes).
       */
      holdExpiresAt?: string;
      /**
       * A paid (Stripe) checkout only, seated or not: the pending order's id
       * (`ord_` + 32 hex). Only this client gets it (it's also in `url` and in
       * Stripe's return URL); keep it for the session only and pass it to
       * cancelPendingOrder when the buyer goes Back from the payment page.
       * It's the order's credential: never log it or put it anywhere shared.
       */
      orderId?: string;
    }
  | { status: "confirmation_sent"; expiresInHours: number };

/** POST /api/orders/confirm `{token}` (from the emailed link's fragment): 200 with the confirmation page's URL. */
export interface ConfirmFreeOrderResult {
  url: string;
}

// ---------------------------------------------------------------------------
// Waitlist (docs/architecture.md, "Waitlist")
// ---------------------------------------------------------------------------

/**
 * POST /api/events/{eventId}/waitlist `{email?}`.
 * - `joined` (201 new, 200 already on the list: `alreadyJoined`): a signed-in
 *   member with a verified email joining with that email (sent, or left out).
 *   `maskedEmail` is that address masked (`m***@example.com`).
 * - `confirmation_sent` (202): anyone else. A link was emailed to confirm,
 *   valid for `expiresInHours`. The same answer whether or not the address is
 *   new, already on the list, or has had links recently: it says nothing
 *   about the address.
 */
export type JoinWaitlistResult =
  | { status: "joined"; maskedEmail: string; alreadyJoined: boolean }
  | { status: "confirmation_sent"; expiresInHours: number };

/** GET /api/events/{eventId}/waitlist/status (signed in): whether the caller is on the event's waitlist. */
export interface WaitlistStatus {
  joined: boolean;
  /** The address on the list, masked; only when `joined`. */
  maskedEmail?: string;
}

/**
 * POST /api/waitlist/confirm `{token}` (from the emailed link's fragment):
 * on the list (also when it already was). `ticketsAvailable`: tickets are on
 * sale right now (someone may have freed some since the event sold out), so
 * the page can link straight to them.
 */
export interface ConfirmWaitlistResult {
  status: "joined";
  eventTitle: string;
  eventSlug: string;
  ticketsAvailable: boolean;
}

/** POST /api/waitlist/leave `{token}` (from a notification email's leave link's fragment). Idempotent. */
export interface LeaveWaitlistResult {
  status: "left";
  /** The event's title, while the event exists. */
  eventTitle?: string;
}

/**
 * GET /api/orders/by-session/{orderId}: what the buyer's confirmation page
 * needs, and nothing more. The order id in the URL is the only credential, so
 * this never carries the order, event or organiser ids, the fee split, Stripe
 * ids, line items, the order's own timestamps, the venue's street address or
 * the full email address. A pending order is `{ status: "pending" }` only.
 */
export interface CustomerOrder {
  status: Exclude<OrderStatus, "pending">;
  /**
   * Set only when `status` is `oversold_refund_required` or `refunded`:
   * - `"oversold"`: the payment arrived after the tickets sold out or the
   *   event was unpublished, so no tickets were ever issued; it's refunded
   *   (or being refunded) in full.
   * - `"refunded"`: the order was paid and its tickets issued, then refunded
   *   in full (e.g. by the organiser or Sheltüh from Stripe). Its tickets are
   *   void and no longer returned.
   */
  refundReason?: "oversold" | "refunded";
  /** Short reference for support, e.g. "#7C1F2E0A" (the same one as in the ticket email). */
  reference: string;
  /** The event's title when the order was placed. */
  eventTitle: string;
  /** The event's current slug, for linking back to /events/{eventSlug}. Unset if the event is gone. */
  eventSlug?: string;
  /**
   * Only for a `paid` order: whether the event is still published. `false`
   * when it's been unpublished, sent back to draft or review, rejected or
   * removed: its date and venue are then left out, and the tickets say it's
   * no longer listed. Unset for any other status (and from an older API,
   * where a missing value means listed).
   */
  eventListed?: boolean;
  /**
   * The event's current start and end (ISO instants), venue name and suburb,
   * as shown on its public page, for the tickets. Only for a `paid` order
   * whose event is published (`eventListed`); unset otherwise (and from an
   * older API).
   */
  eventStartsAt?: string;
  eventEndsAt?: string;
  venueName?: string;
  suburb?: string;
  /**
   * The event's current refund policy (lib/refund-policy.ts), with
   * `refundDays` for `days_before`. Like the date and venue: only for a
   * `paid` order whose event is published (`eventListed`).
   */
  refundPolicy?: RefundPolicy;
  refundDays?: number;
  /** The buyer's address, masked: "m***@example.com". Unset if none is on record. */
  maskedEmail?: string;
  subtotalCents: number;
  /** Booking fees the buyer paid (not any the organiser absorbed). */
  buyerFeeCents: number;
  /**
   * What the buyer added for Support Sheltüh (lib/support.ts: SUPPORT_LABEL),
   * shown as its own line. Only when they added some; unset otherwise (and
   * from an older API).
   */
  supportCents?: number;
  /** What the buyer paid, all-inclusive: subtotal, buyer-paid fees and any Support Sheltüh. */
  totalCents: number;
  /**
   * Only for a `paid` order; empty for every other status (a refunded order's
   * tickets are void). In the ticket email's order (ticket type, then code).
   */
  tickets: CustomerTicket[];
  /**
   * Which wallets the tickets can be added to (`/api/orders/by-session/{id}/wallet/{google|apple}?ticket={n}`),
   * from the server's own configuration: a wallet is on only once its credentials are set. Only for a `paid`
   * order whose event is published (`eventListed`) and that has tickets; unset otherwise (and from an older
   * API): show no wallet buttons then.
   */
  wallet?: WalletAvailability;
}

/** Which wallet passes the server can make (CustomerOrder.wallet). */
export interface WalletAvailability {
  google: boolean;
  apple: boolean;
}

export interface CustomerTicket {
  /** The ticket's code (`7KQM-2HXD`): its QR carries `SH1:` plus this, and the door can type it in. */
  ticketCode: string;
  ticketTypeName: string;
  /** Its seat, for a reserved-seating event; unset for general admission. */
  seat?: TicketSeat;
  /**
   * When the ticket was checked in at the door (ISO instant), or null if it
   * hasn't been (or its check-in was undone). Optional only for responses
   * from an older API, which didn't send it: treat a missing one as null.
   */
  checkedInAt?: string | null;
}

export type CustomerOrderLookup = CustomerOrder | { status: "pending" };

/** One line of OrderPaymentSummary. Amounts are the buyer's (booking fee included when they pay it; lib/fees.ts). */
export interface OrderPaymentLine {
  ticketTypeName: string;
  quantity: number;
  /** One ticket, all-inclusive: 0 for a free line. */
  unitTotalCents: number;
  /** `quantity` tickets, all-inclusive. */
  lineTotalCents: number;
  /**
   * Whether this line's amounts include a booking fee the buyer pays: its
   * ticket type is buyer-pays and paid. False for a free line or one whose
   * organiser absorbs the fee, whatever the order's other lines do.
   */
  buyerPaysFee: boolean;
  /** A seated tier's seats in this order, in map order; unset for general admission. */
  seats?: TicketSeat[];
}

/**
 * What the payment page shows beside Stripe's form, priced by the server
 * from the order (never by the client). No ids, fee split, email or Stripe
 * ids.
 */
export interface OrderPaymentSummary {
  /** The event's title when the order was placed. */
  eventTitle: string;
  /** The event's current slug (unset if the event is gone): /events/{slug}, or /events/{slug}/seats when `seated`. */
  eventSlug?: string;
  /** The event's current start and end (ISO instants), venue name and suburb: only while it's published. */
  eventStartsAt?: string;
  eventEndsAt?: string;
  venueName?: string;
  suburb?: string;
  /** A reserved-seating order (it holds seats until the hold ends). */
  seated: boolean;
  /**
   * The event's current refund policy, to show before paying with
   * REFUND_ACL_STATEMENT (lib/refund-policy.ts: refundPolicySummary). It can
   * only have become more generous since the order was made (an event with
   * pending orders can't be tightened). Always sent by the API; optional for
   * older responses (absent: say nothing about the policy).
   */
  refundPolicy?: RefundPolicy;
  /** `days_before` only (1–30). */
  refundDays?: number;
  /** In the order's line order. */
  lines: OrderPaymentLine[];
  subtotalCents: number;
  /** Booking fees the buyer pays (not any the organiser absorbs). */
  buyerFeeCents: number;
  /**
   * Support Sheltüh the buyer chose at checkout (lib/support.ts: SUPPORT_LABEL),
   * its own line in the summary and in Stripe's form. Only when there is some;
   * unset otherwise (and from an older API).
   */
  supportCents?: number;
  /** What the buyer pays, all-inclusive (Support Sheltüh included): the same amount as Stripe's form. */
  totalCents: number;
}

/**
 * GET /api/orders/by-session/{orderId}/payment: the payment page's view of a
 * card checkout (the order id is the only credential; `private, no-store`;
 * reading it changes nothing).
 * - `open`: Stripe's form can be mounted with `clientSecret` (Stripe.js
 *   embedded checkout) until `expiresAt` (ISO; for a seated order, before
 *   its seats' hold ends). Re-fetch once it passes. The secret is for
 *   Stripe.js only: never log or store it.
 * - `processing`: Stripe has the payment; go to /checkout/success. `delayed`:
 *   a payment method that takes time to clear (the tickets follow by email).
 * - `done`: settled (paid, or refunded); go to /checkout/success.
 * - `closed`: the checkout expired or was cancelled, or the event can no
 *   longer be booked (unpublished, or ended); nothing was charged.
 * - `sold_out`: the tickets (or some of the seats) went to someone else
 *   while it was open; nothing was charged.
 * ApiError 404 unknown, malformed, or not a card checkout; 409 still being
 * set up (try again in a moment); 429 asked too often in the last minute
 * (by this connection, or for this order: try again in a minute).
 */
export type OrderPaymentLookup =
  | ({ status: "open"; clientSecret: string; expiresAt: string } & OrderPaymentSummary)
  | { status: "processing"; delayed: boolean }
  | { status: "done" }
  | { status: "closed" | "sold_out"; eventTitle: string; eventSlug?: string; seated: boolean };

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

/** Every kind of outbox job (private.email_outbox's kind check). */
export type EmailOutboxKind =
  | "ticket_email"
  | "waitlist_available"
  | "organiser_new_events"
  | "event_review"
  | "organiser_review"
  | "ops_alert";

export const EMAIL_OUTBOX_KINDS: readonly EmailOutboxKind[] = [
  "ticket_email",
  "waitlist_available",
  "organiser_new_events",
  "event_review",
  "organiser_review",
  "ops_alert",
];

/** One kind's (or every kind's) outbox counts in EmailOutboxHealth. Sent jobs aren't counted. */
export interface EmailOutboxHealthCounts {
  /** Waiting for a worker right now. */
  due: number;
  /** Due (or leased by a worker that died) for longer than `overdueAfterMinutes`: no run has picked them up. */
  overdue: number;
  /** How long the oldest overdue job has been waiting. Unset when none is overdue. */
  oldestOverdueSeconds?: number;
  /** A retry (or a follower email) scheduled for later. */
  waiting: number;
  /** Being sent right now. */
  sending: number;
  /** Leased by a worker that never finished: taken again by the next run. */
  expiredLeases: number;
  /** Gave up after the last attempt, or couldn't be sent at all: the dead letters. */
  failed: number;
  failedLast7Days: number;
}

/**
 * GET /api/admin/emails/health. Whether the email outbox is being worked
 * (docs/architecture.md, "Payment flow"). Counts and times only: never an
 * address, an order or a token.
 */
export interface EmailOutboxHealth {
  checkedAt: string;
  overdueAfterMinutes: number;
  /** The last run of GET /api/cron/email-outbox that finished, from any scheduler. Unset: none recorded yet. */
  lastCronRun?: { finishedAt: string; claimed: number; sent: number; retrying: number; failed: number };
  /** CRON_SECRET is set. Without it the cron route refuses every call and nothing is retried. */
  cronSecretConfigured: boolean;
  totals: EmailOutboxHealthCounts;
  /** Every kind, in EMAIL_OUTBOX_KINDS order (zeros included). */
  byKind: (EmailOutboxHealthCounts & { kind: EmailOutboxKind })[];
}

// ---------------------------------------------------------------------------
// Payment exceptions (admin)
// ---------------------------------------------------------------------------

/**
 * - `refund_not_completed`: Stripe reported a refund failed, canceled or
 *   requires_action. With `urgent`, the order was already voided (its tickets
 *   are void) but the buyer hasn't been repaid: re-refund in the Stripe
 *   dashboard.
 * - `partial_refund`: a paid order was partly refunded; its tickets stand.
 * - `manual_refund_required`: an automatic refund couldn't be requested (no
 *   payment on record): refund it in the Stripe dashboard.
 * - `amount_mismatch`: Stripe reported a paid Checkout Session whose amount
 *   or currency isn't the order's stored total in AUD. No tickets were
 *   issued, the order was marked `failed` and the payment refunded in full
 *   automatically: check the refund and the payment in the Stripe
 *   dashboard. Always `urgent`.
 */
export type PaymentExceptionKind = "refund_not_completed" | "partial_refund" | "manual_refund_required" | "amount_mismatch";

export type PaymentExceptionStatus = "open" | "resolved";

export const PAYMENT_EXCEPTION_STATUSES: readonly PaymentExceptionStatus[] = ["open", "resolved"];

/**
 * GET /api/admin/payment-exceptions. Something about a payment that needs a
 * person (docs/architecture.md, "Refunds made in Stripe"). Nothing is
 * restored or refunded again because of one (an `amount_mismatch` payment's
 * automatic refund is requested as it opens): an admin acts in the Stripe
 * dashboard, then resolves it with a note. The order is shown by its short reference
 * only, never its id; no buyer data.
 */
export interface AdminPaymentException {
  /** POST /api/admin/payment-exceptions/{exceptionId}/resolve. */
  exceptionId: string;
  kind: PaymentExceptionKind;
  status: PaymentExceptionStatus;
  /**
   * Needs a person first: a `refund_not_completed` whose order was voided (the
   * buyer has neither tickets nor their money), or any `amount_mismatch`.
   */
  urgent: boolean;
  /** Unset while the payment isn't matched to an order yet. */
  orderReference?: string;
  orderStatus?: OrderStatus;
  eventTitle?: string;
  /** To find the payment (and refund) in the Stripe dashboard. */
  paymentIntentId?: string;
  refundId?: string;
  /** The latest Stripe event that changed it. */
  stripeEventId?: string;
  /** Amounts and statuses only. */
  details: PaymentExceptionDetails;
  /** When an ops alert was last queued (unset: none, e.g. over the daily cap). */
  alertedAt?: string;
  /** When it was opened, or last reopened. */
  openedAt: string;
  createdAt: string;
  resolvedAt?: string;
  /** `auto`: Stripe reported the refund succeeded (or the order was then refunded in full). */
  resolution?: "auto" | "admin";
  /** The resolving admin's account id. */
  resolvedBy?: string;
  resolutionNote?: string;
}

export interface PaymentExceptionDetails {
  refundStatus?: string;
  refundAmountCents?: number;
  amountRefundedCents?: number;
  totalCents?: number;
  /**
   * The order's Support Sheltüh amount (in totalCents and in the application
   * fee; 0 for none), to split a dashboard refund (docs/supabase-setup.md,
   * "Refunding a paid order"). Unset on exceptions opened before it was recorded.
   */
  supportCents?: number;
  /** `amount_mismatch`: what Stripe's session says was charged (amount_total), in `currency`'s minor unit. */
  amountChargedCents?: number;
  /** `amount_mismatch`: the session's currency, lower case as Stripe sends it ("aud"). */
  currency?: string;
  /**
   * A `partial_refund` resolved by a tickets-only refund (at least the total
   * less the support refunded, so the order was voided): the Support Sheltüh
   * amount kept.
   */
  supportKeptCents?: number;
  /** The order's status when the exception was last updated. */
  orderStatus?: string;
  /** `sheltuh`: our automatic refund; `stripe`: one made in the Stripe dashboard. */
  source?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Admin summary
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/summary: what's waiting for an admin, as counts only (no
 * titles, names or addresses). Times are ISO 8601; null when nothing is
 * waiting.
 */
export interface AdminSummary {
  /** Open member reports (GET /admin/reports?status=open). `oldestAt`: when the oldest was filed. */
  reportsOpen: { count: number; oldestAt: string | null };
  /**
   * Events waiting for review (GET /admin/events?status=pending_review).
   * `soonestStartsAt` and `startingSoon` only count those that haven't
   * ended: the soonest start, and how many start within `startingSoonHours`
   * (72) from now, in progress included.
   */
  eventsPending: { count: number; soonestStartsAt: string | null; startingSoon: number; startingSoonHours: number };
  /**
   * Organiser applications waiting for review (GET /admin/organisers?status=pending).
   * `oldestAt`: the oldest one's last update (its submission or resubmission).
   */
  organisersPending: { count: number; oldestAt: string | null };
  /** Ticket emails that gave up and need a resend (GET /admin/emails?status=failed). */
  emailsFailed: { count: number };
  /** Ticket emails waiting for another attempt after at least one failed (in GET /admin/emails?status=pending). */
  emailsRetrying: { count: number };
  /**
   * Published, Sheltüh-ticketed events of platform-managed organisers (the
   * ones only admins check in) that haven't ended and start within
   * `windowHours` (24) from now.
   */
  doorEvents: { count: number; windowHours: number };
}

// ---------------------------------------------------------------------------
// Who's Going
// ---------------------------------------------------------------------------

/** The caller's own social profile (GET/PUT/PATCH /api/profiles/me). */
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
  // The fields below are always sent; optional so older fixtures stay valid.
  /** Opaque id of the member profile page (/members/{profileId}). New if the profile is deleted and recreated. */
  profileId?: string;
  /** Opted in to a member profile other verified members can open (default false). */
  profileVisible?: boolean;
  /** Up to 200 characters, plain text. */
  bio?: string;
  /** Instagram username, without '@'. */
  instagramHandle?: string;
  hasAvatar?: boolean;
  /** The 512 px photo (needs the bearer token: fetch it, don't put it in an <img src>). Versioned. */
  avatarUrl?: string;
  /** The 96 px thumbnail. */
  avatarThumbUrl?: string;
}

/**
 * PATCH /api/profiles/me. Fields left out are unchanged; null or "" clears
 * `bio` / `instagramHandle`. Needs a verified email and a profile.
 */
export interface ProfilePatchInput {
  displayName?: string;
  profileVisible?: boolean;
  /** Up to 200 characters, plain text (links allowed). */
  bio?: string | null;
  /** Instagram username; a leading '@' is dropped. */
  instagramHandle?: string | null;
}

/**
 * GET /api/profiles/{profileId}: another member's profile, for verified
 * members with a profile that isn't suspended. Never an email or user id.
 */
export interface MemberProfile {
  profileId: string;
  displayName: string;
  bio?: string;
  instagramHandle?: string;
  /** https://www.instagram.com/{handle}/, built by the server. */
  instagramUrl?: string;
  hasAvatar: boolean;
  /** Versioned; fetch with the bearer token. */
  avatarUrl?: string;
  avatarThumbUrl?: string;
  /** It's the caller's own profile. */
  isYou: boolean;
  /**
   * Events whose Who's Going the member has opted in to that are still open
   * (published, not ended), soonest first, at most 24.
   */
  upcomingEvents: PublicEvent[];
  /**
   * A first message can be sent now (POST /api/conversations {profileId,
   * body}): both opted in to the same open event, and no conversation
   * between them ever. Doesn't account for rate limits.
   */
  canMessage: boolean;
  /** Their existing conversation, when the caller can see it. */
  conversationId?: string;
}

/** What an admin can remove from a member profile. */
export type ProfileContentField = "avatar" | "bio" | "instagram";

/** POST /api/admin/profiles/{profileId}/remove-content. */
export interface RemoveProfileContentInput {
  fields: ProfileContentField[];
  /** 1–500 characters. Logged (never the content removed). */
  reason: string;
}

export interface ProfileModerationEntry {
  removed: ProfileContentField[];
  reason: string;
  at: string;
  /** The admin's account id; unset if that account was deleted. */
  by?: string;
}

/** GET /api/admin/profiles/{profileId} (and the remove-content response). Admin only. */
export interface AdminMemberProfile {
  profileId: string;
  displayName: string;
  profileVisible: boolean;
  bio?: string;
  instagramHandle?: string;
  hasAvatar: boolean;
  /** Admins may fetch it whatever the profile's visibility. */
  avatarUrl?: string;
  suspended: boolean;
  /** Newest first, at most 20. */
  moderationLog: ProfileModerationEntry[];
  /** Set by remove-content: what that request removed (empty: nothing was there). */
  removed?: ProfileContentField[];
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
  /**
   * Their member profile (GET /api/profiles/{profileId}), only when they've
   * made it visible. Absent: show the name as plain text.
   */
  profileId?: string;
  /** Always sent; true only with a profileId and a photo. Optional so older fixtures stay valid. */
  hasAvatar?: boolean;
  /** The 96 px photo when hasAvatar (fetch with the bearer token); otherwise show initials. */
  avatarThumbUrl?: string;
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

/**
 * POST /api/conversations by member profile: the same rules (both opted in to
 * the same open event); the server picks that event.
 */
export interface StartConversationByProfileInput {
  profileId: string;
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

/** POST /api/blocks: exactly one of these. */
export type BlockInput = { conversationId: string } | { attendeeId: string } | { profileId: string };

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
  /** A member profile (its bio, Instagram handle or photo); exactly one of the three ids. */
  profileId?: string;
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
  /** What was reported. Always sent; optional so older fixtures stay valid. */
  targetType?: "conversation" | "attendee" | "profile";
  /** The reported member's current profile, if they still have one (for GET/remove-content). */
  reportedProfileId?: string;
  /** Profile reports: copies of the bio and Instagram handle when reported. */
  reportedBio?: string;
  reportedInstagramHandle?: string;
  /** Profile reports with a photo: the copy taken when reported (admin only; fetch with the bearer token). */
  reportedAvatarUrl?: string;
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
  /** What buyers paid for the event, booking fees they paid included; never Support Sheltüh (the platform's). */
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
  /** Always sent; optional so older fixtures stay valid (absent means `sheltuh`). */
  ticketingMode?: TicketingMode;
}

/** Clicks on an external event's ticket link on one Melbourne day. */
export interface OutboundClickDay {
  date: string;
  clicks: number;
  /** The event's per-minute click cap was reached that day (any of the organiser's events, in the overview): clicks is a lower bound. */
  unreliable: boolean;
}

/**
 * Clicks on external events' "Get tickets on …" links (POST
 * /api/events/{id}/outbound): aggregate daily counts only, no visitor data.
 * Counted from 22 Oct 2026, when external ticketing was added, so every day
 * an external event could have had a click is covered (no "not counted"
 * days). Sales of external events happen elsewhere and aren't known.
 */
export interface OutboundClickStats {
  total: number;
  /** The cap was reached on at least one day of the period. */
  unreliable: boolean;
  /** Every day in the range, oldest first, zero-filled. */
  byDay: OutboundClickDay[];
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
  /**
   * Door check-ins against tickets sold, all-time (not limited to `range`):
   * tickets in `paid` orders, and how many of them have been checked in.
   * Null when no tickets have been sold. Always sent by the API; optional so
   * older fixtures stay valid. Check-in times are cleared 25 months after the
   * event ends, after which `checkedIn` is 0.
   */
  attendance?: EventAttendance | null;
  /**
   * Ticket-link clicks over `range` for an external event (`previous` also
   * has them, with `compare=prevPeriod`); null for a Sheltüh-ticketed event.
   * Always sent by the API; optional so older fixtures stay valid.
   */
  outboundClicks?: (OutboundClickStats & { previous?: OutboundClickStats }) | null;
  /**
   * People on the event's waitlist right now (confirmed, not left): an
   * aggregate count only. Organisers never see who. 0 for an external event.
   * Always sent by the API; optional so older fixtures stay valid.
   */
  waitlistCount?: number;
}

/** EventAnalytics.attendance. */
export interface EventAttendance {
  checkedIn: number;
  ticketsSold: number;
  /** Every current ticket type, in event order, zero-filled. */
  byTicketType: { ticketTypeId: string; name: string; checkedIn: number; ticketsSold: number }[];
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
  /** Always sent; optional so older fixtures stay valid (absent means `sheltuh`). */
  ticketingMode?: TicketingMode;
  /**
   * External events only: ticket-link clicks in the range (and, with
   * `compare=prevPeriod`, `previous`). Absent for Sheltüh-ticketed events.
   */
  outboundClicks?: { total: number; unreliable: boolean; previous?: { total: number; unreliable: boolean } };
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
  /**
   * Ticket-link clicks across all the organiser's external events (with
   * `previous` for `compare=prevPeriod`); null when they have no external
   * event. Always sent by the API; optional so older fixtures stay valid.
   */
  outboundClicks?: (OutboundClickStats & { previous?: OutboundClickStats }) | null;
  /**
   * Members following the organiser now: the exact number (the public
   * profile only shows it from 10). Always sent; optional so older fixtures stay valid.
   */
  followerCount?: number;
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

// ---------------------------------------------------------------------------
// Check-in at the door (docs/architecture.md, "Check-in")
// ---------------------------------------------------------------------------

/**
 * What a scan means for the person at the door:
 * - `admitted`: let them in (the ticket is now checked in).
 * - `already_checked_in`: this ticket was checked in before, at `checkedInAt`. Re-entry is refused.
 * - `not_admissible`: the ticket is void (its order isn't paid, e.g. refunded).
 * - `other_event`: a ticket for another of the organiser's events (`otherEventTitle`).
 * - `invalid`: not a ticket for any of the organiser's events (or not a ticket code at all).
 */
export type CheckInOutcome = "admitted" | "already_checked_in" | "invalid" | "not_admissible" | "other_event";

/** POST /api/organisers/me/events/{eventId}/check-ins. */
export interface CheckInInput {
  /** What was scanned or typed: `XXXX-XXXX` or `SH1:XXXX-XXXX`, any case, surrounding whitespace ignored. */
  code: string;
  /** A fresh uuid per scan, reused for retries of that scan: a retry gets the original result back. */
  requestId: string;
}

/** About the scanned ticket. Never the buyer's name or email, or the order. */
export interface CheckInTicket {
  ticketTypeName: string;
  /** Its place in its order ("ticket 2 of 3"), in the same order as the ticket email. */
  ticketNumber: number;
  ticketCount: number;
  /** The code's last four characters. */
  codeLast4: string;
  /** The ticket's seat, for a seated event (lib/seating/format.ts says it). */
  seat?: TicketSeat;
}

/**
 * The outcome of a scan (always HTTP 200: any HTTP error means the ticket
 * couldn't be verified, and nothing was marked). An `invalid` result carries
 * nothing else: `{"outcome":"invalid"}`.
 */
export interface CheckInResult {
  outcome: CheckInOutcome;
  /**
   * The admission to pass to undo (an opaque id). `admitted`: this check-in.
   * `already_checked_in`: the ticket's current check-in, so the door can
   * offer undo right away; absent when there's none to undo (e.g. a replayed
   * request whose admission was undone since). Never set for other outcomes.
   */
  checkInId?: string;
  /** Every outcome but `invalid`. */
  ticket?: CheckInTicket;
  /** `admitted`: now. `already_checked_in`: when it was first checked in. ISO 8601. */
  checkedInAt?: string;
  /** `other_event` only. */
  otherEventTitle?: string;
}

/** An undo reason's length, in characters (code points, `Array.from(reason).length`), after trimming. */
export const MIN_UNDO_REASON_LENGTH = 3;
export const MAX_UNDO_REASON_LENGTH = 200;

/** POST /api/organisers/me/events/{eventId}/check-ins/{checkInId}/undo. */
export interface UndoCheckInInput {
  /** Why (MIN_UNDO_REASON_LENGTH–MAX_UNDO_REASON_LENGTH characters). Kept in the check-in log. */
  reason: string;
}

/**
 * - `undone`: the ticket is no longer checked in.
 * - `not_checked_in`: it already wasn't (undone before).
 * - `superseded`: it was undone and checked in again since; undo the newer check-in instead.
 */
export type UndoCheckInOutcome = "undone" | "not_checked_in" | "superseded";

export interface UndoCheckInResult {
  outcome: UndoCheckInOutcome;
  /** `undone` only: the log entry recording the undo. */
  checkInId?: string;
  ticket: { ticketTypeName: string; codeLast4: string };
}

/** One entry in the check-in log, newest first. */
export interface CheckInLogEntry {
  /** An opaque id (a uuid); for an undoable admission, the id undo takes. */
  checkInId: string;
  result: CheckInOutcome | "undone";
  /** ISO 8601. */
  at: string;
  /** Null for `invalid` (the scanned text is never stored). */
  codeLast4: string | null;
  ticketTypeName: string | null;
  /** `other_event` only. */
  otherEventTitle?: string;
  /** `undone` only. */
  reason?: string;
  /**
   * The ticket's seat (lib/seating/format.ts says it), for a ticket of this
   * event that has one; absent for general admission, `invalid` and
   * `other_event` entries, and once a refund has freed the seat.
   */
  seat?: TicketSeat;
  /** An `admitted` entry that is the ticket's current check-in, so it can be undone. */
  undoable: boolean;
}

/** GET /api/organisers/me/events/{eventId}/check-ins. */
export interface CheckInSummary {
  event: { eventId: string; title: string; startsAt: string; endsAt: string };
  /** Tickets of paid orders checked in. */
  checkedIn: number;
  /** Tickets in paid orders. */
  ticketsSold: number;
  /** Sum of the ticket types' quantities on sale. */
  capacity: number;
  /** Every current ticket type, in event order. */
  byTicketType: { ticketTypeId: string; name: string; checkedIn: number; ticketsSold: number; capacity: number }[];
  /** The newest 20 log entries. */
  recent: CheckInLogEntry[];
}

// ---------------------------------------------------------------------------
// Following organisers
// ---------------------------------------------------------------------------

/** GET/POST /api/organisers/{organiserId}/follow (the caller's own follow). */
export interface FollowStatus {
  following: boolean;
  /** Emailed when the organiser publishes a new event (at most one email a day per organiser). False when not following. */
  notifyNewEvents: boolean;
}

/** POST /api/organisers/{organiserId}/follow. */
export interface FollowInput {
  /** Chosen when following (left out: off); sending it again changes it. Must be a boolean if sent. */
  notifyNewEvents?: boolean;
}

/** One entry of GET /api/me/following. */
export interface FollowedOrganiser {
  organiserId: string;
  displayName: string;
  notifyNewEvents: boolean;
  followedAt: string;
}

/** POST /api/follows/unsubscribe {token}: the emailed link's token is the credential. */
export interface UnsubscribeFollowResult {
  status: "unsubscribed";
  /** Still following: only the emails stop. */
  organiserName?: string;
}

// ---------------------------------------------------------------------------
// Reserved seating (docs/architecture.md, "Reserved seating")
// ---------------------------------------------------------------------------

/**
 * Seat holds (docs/SEATING_PLAN.md). The buyer is told `stripeMinutes`
 * (Stripe's page closes then); the seats stay held `holdMinutes`, a buffer for
 * the payment to be confirmed.
 */
export const SEAT_HOLD = { holdMinutes: 35, stripeMinutes: 30 } as const;

/**
 * GET /api/events/{eventId}/seat-map[?v=version]. Public once the event is
 * published (cached for a long time when `v` is the current version); before
 * that, the owning organiser or an admin only (bearer token).
 */
export interface SeatMapRecord {
  eventId: string;
  version: number;
  seatCount: number;
  /** The map, as validated and stored: sections → rows → seats, stage, focus point. */
  template: SeatMapTemplate;
}

/**
 * GET /api/events/{eventId}/seat-availability (published events). `unavailable`
 * is the bitmap (lib/seating/availability.ts) by seat position for map
 * `version`: sold, held and blocked look the same. Cached 5 seconds.
 */
export interface SeatAvailability {
  eventId: string;
  version: number;
  seatCount: number;
  unavailable: string;
}

/** The `seats` part of POST /api/events/{eventId}/checkout. */
export interface CheckoutSeatsInput {
  /** The map version the seats were chosen on (a different one is a 409, fieldErrors.seatMapVersion). */
  mapVersion: number;
  /** 1 to 10 seat ids. General admission lines (`lineItems`) don't count towards the 10. */
  seatIds: string[];
}

/**
 * Extra body fields of a seated checkout's error responses, besides `error`
 * and `fieldErrors`:
 * - 409 (fieldErrors.seats): `seatIds`, the seats that were taken (remove them
 *   and let the buyer choose again).
 * - 409 `seat_map_changed` (fieldErrors.seatMapVersion): the map was replaced; reload it.
 * - 429 (`hold_cap`: too many seats held for the event right now; `rate_limited`:
 *   too many checkouts for it in 10 minutes; `client_rate_limited`: too many
 *   checkouts from this connection in 10 minutes, for this event or in all;
 *   fieldErrors.seats): `seatIds`, the seats asked for (none were held).
 * - 409 from POST /api/orders/confirm when a guest's seats went before they
 *   confirmed (`code: "seats_taken"`): `seats` (their labels) and `eventSlug`.
 */
/**
 * A paid checkout's error `code` (POST /events/{eventId}/checkout; docs/architecture.md, "Checkout idempotency"):
 * - `checkout_in_progress` (409): the same attempt is still being set up; retry after `retryAfterSeconds`
 *   (also the Retry-After header) with the same Idempotency-Key.
 * - `checkout_expired` (409): this attempt's checkout ended (cancelled, failed or its session expired): start a
 *   new checkout (a new key).
 * - `checkout_completed` (409): this attempt's order was paid (its message says whether it was then refunded,
 *   or is being refunded because the tickets sold out first).
 * - `checkout_other_client` (409): the key belongs to a checkout started from another connection; nothing about it
 *   is returned. Start a new checkout (a new key).
 * - `idempotency_key_reused` (422): the key was used for a different basket, buyer or event.
 * - `invalid_idempotency_key` (400): the Idempotency-Key header isn't a random (version 4) UUID.
 * - `client_rate_limited` (429): this client started too many checkouts; `rate_limited` (429, seated only): too
 *   many seat holds for the event (a seated checkout also has `hold_cap`). General admission has no event-wide
 *   refusal: past its threshold the server only alerts.
 * - `payment_provider_unavailable` (503): Stripe didn't answer; retry with the same key.
 */
export type CheckoutErrorCode =
  | "checkout_in_progress"
  | "checkout_expired"
  | "checkout_completed"
  | "checkout_other_client"
  | "idempotency_key_reused"
  | "invalid_idempotency_key"
  | "client_rate_limited"
  | "rate_limited"
  | "payment_provider_unavailable";

export interface SeatErrorDetails {
  /** A seat code, or (seated paid checkout) one of the attempt's own CheckoutErrorCode values. */
  code?: "seats_unavailable" | "hold_cap" | "rate_limited" | "client_rate_limited" | "seat_map_changed" | "seats_taken" | CheckoutErrorCode;
  seatIds?: string[];
  seats?: TicketSeat[];
  eventSlug?: string;
}

/**
 * POST /api/orders/by-session/{orderId}/cancel: the buyer left the payment
 * page (Back from /checkout/pay, or a hosted session's cancel_url,
 * /checkout/cancelled?order={orderId}).
 * - `released`: nothing was charged; the order is cancelled and its seats are
 *   free again (also when that had already happened).
 * - `paid`: it's paid already (show /checkout/success?session_id={orderId}).
 * - `processing`: Stripe already has the payment (or is confirming it); the
 *   confirmation page will show the result.
 */
export interface CancelOrderResult {
  status: "released" | "paid" | "processing";
  /** The event's slug, for "Choose seats again" (unset if the event is gone). */
  eventSlug?: string;
  eventTitle: string;
}

/** PUT /api/admin/events/{eventId}/seat-map. */
export interface AdminSeatMapInput {
  template: SeatMapTemplate;
  /** 1–500 characters, logged (the organiser sees it). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Account invites (docs/architecture.md, "Account invites")
// ---------------------------------------------------------------------------

/** `organiser`: comes with an organiser, approved when accepted. `member`: an account only. */
export type InviteKind = "organiser" | "member";

/**
 * `expired`: the link's 14 days have passed (also before anything has
 * marked it). Only `pending` invites can be accepted or revoked; `pending`
 * and `expired` ones can be resent.
 */
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

/** An invite as admins see it (GET /api/admin/invites). Never the link or its token. */
export interface AdminInviteRecord {
  inviteId: string;
  kind: InviteKind;
  /** As the admin typed it. */
  email: string;
  status: InviteStatus;
  /** An organiser invite's organiser name. */
  organiserName?: string;
  /** The inviting admin's account id (unset once that account is deleted). */
  invitedBy?: string;
  createdAt: string;
  /** When the current link stops working. */
  expiresAt: string;
  /** When the email was last sent (or attempted). */
  lastSentAt?: string;
  /** Set when the last send failed: resend it. */
  lastSendFailedAt?: string;
  /** Emails sent for this invite, the first included. */
  sendCount: number;
  acceptedAt?: string;
  /** The organiser an accepted organiser invite created. */
  acceptedOrganiserId?: string;
  revokedAt?: string;
}

/**
 * POST /api/admin/invites. `consent` must be true: the person asked to be
 * invited (Spam Act 2003). `organiser`: required for an organiser invite
 * (the application's fields and rules, the bio included; fieldErrors are
 * `organiser.<field>`), refused for a member invite.
 */
export interface AdminCreateInviteInput {
  kind: InviteKind;
  email: string;
  consent: true;
  organiser?: AdminCreateOrganiserInput;
}

/** POST /api/admin/invites (201) and …/{inviteId}/resend (200). `emailSent: false`: saved, but the email failed; resend it. */
export interface AdminInviteSendResult {
  invite: AdminInviteRecord;
  emailSent: boolean;
}

/** POST /api/invites/view {token}: what the invite page shows before anything is pressed. */
export interface InviteView {
  kind: InviteKind;
  /** "m***@example.com": the invite's address. */
  maskedEmail: string;
  organiserName?: string;
  expiresAt: string;
  /**
   * `existing`: the address already has a confirmed account, so the person
   * signs in instead of creating one. `unconfirmed`: it has only an account
   * that was never confirmed (perhaps registered by someone else). "Create
   * account" still works when `passwordSetup` is true (the server replaces
   * that account); otherwise, or when account-link answers 503, send them to
   * the password reset (`/forgot-password`), never the ordinary sign-up:
   * resetting confirms the address and replaces whatever password it had.
   * `new`: no account yet.
   */
  account: "new" | "existing" | "unconfirmed";
  /**
   * Whether "Create account" with a password works here (the server can
   * issue the sign-up token). false: send them to the ordinary sign-up
   * (`/signup?next=/invite`), or the password reset for `unconfirmed`;
   * acceptance works the same once they're verified.
   */
  passwordSetup: boolean;
}

/** POST /api/invites/account-link {token}: the sign-up token's hash, for `verifyOtp({token_hash, type: "invite"})`. */
export interface InviteAccountLink {
  tokenHash: string;
}

/** GET /api/invites/me: the pending invite for the caller's verified email. */
export interface MyInvite {
  inviteId: string;
  kind: InviteKind;
  organiserName?: string;
  expiresAt: string;
}

/** POST /api/invites/accept {inviteId}. `organiserId`: the organiser created (organiser invites). */
export interface AcceptInviteResult {
  kind: InviteKind;
  organiserId?: string;
}
