import type { RefundPolicy } from "./refund-policy";
import type { TicketingMode } from "./ticketing";
import type { AustralianTimeZone, StateCode } from "./time-zones";

export type EventCategory =
  | "live-music"
  | "art"
  | "workshop"
  | "pop-up"
  | "theatre";

export const EVENT_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "live-music", label: "Live music" },
  { value: "art", label: "Art" },
  { value: "workshop", label: "Workshop" },
  { value: "pop-up", label: "Pop-up" },
  { value: "theatre", label: "Theatre" },
];

/**
 * Who absorbs the booking fee for a paid ticket. Free tickets never carry a fee,
 * regardless of this setting.
 */
export type FeePolicy = "buyer-pays" | "organiser-absorbs";

/** Decorative pattern rendered by components/EventArt.tsx. */
export type PosterPattern =
  | "burst"
  | "rings"
  | "grid"
  | "stripes"
  | "waves"
  | "confetti"
  | "curtain"
  | "halftone";

/** Local CSS/SVG poster artwork for an event — no remote image dependency. */
export interface EventPoster {
  pattern: PosterPattern;
  background: string;
  primary: string;
  secondary: string;
}

export interface TicketType {
  id: string;
  name: string;
  description?: string;
  /** Face value in integer cents. 0 means a free ticket. */
  priceCents: number;
  feePolicy: FeePolicy;
  /** The capacity, not what's left (see `remaining`). */
  quantityAvailable: number;
  /**
   * None left: every ticket of this type is sold. From the API (live) or the
   * sample data (demo); absent means on sale.
   */
  soldOut?: boolean;
  /**
   * Tickets left, only when the API says so (10 or fewer; 0 when sold out).
   * Absent when more are left: never inferred from `quantityAvailable`.
   */
  remaining?: number;
  /**
   * A tier with seats on the event's seat map (reserved seating): sold only
   * by choosing seats on /events/{slug}/seats, never as a quantity. Absent
   * for general admission.
   */
  seated?: true;
}

/** An event's seat map (reserved seating): its version, for GET /events/{id}/seat-map?v={version}. */
export interface EventSeatingRef {
  version: number;
}

/** Decimal degrees, WGS84. */
export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * An event's short silent video (docs/design/event-clips.md): shown only
 * when someone presses Play on the event's image. Absent when the event has
 * none, so an event without a clip has the same payload as before.
 */
export interface EventClip {
  /**
   * Same-origin and versioned: `/api/events/{eventId}/clip?v={ms}`. It
   * redirects (302) to a short-lived signed Storage URL, for published
   * events only; use it as the `<video>` src.
   */
  url: string;
  /** At most 15.5 s (shown rounded to whole seconds, at most 15). */
  durationMs: number;
  /** As shown, in pixels (a phone's rotated portrait clip is already turned): sets the video box's shape. */
  width: number;
  height: number;
  /** The clip's text alternative (1–300 characters), shown with it. */
  description: string;
}

export interface SheltuhEvent {
  id: string;
  /**
   * Only present for live events. Demo sample events have no real backend
   * to check out against, so this stays undefined for them — which is how
   * the ticket selector tells the two apart.
   */
  organiserId?: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  suburb: string;
  venueName: string;
  venueAddress: string;
  /**
   * Approximate real-world position of the venue, when known. Not present
   * for every event — see lib/geo.ts's suburb-centroid fallback for events
   * (e.g. from the live API) that don't have a geocoded venue location yet.
   */
  coordinates?: Coordinates;
  /**
   * The venue's Google Maps place id, when the organiser linked the venue to
   * one: the Google Maps link routes to that place (lib/maps.ts). Only the
   * id is kept. Google's own coordinates for it are never stored or used
   * (Google Maps Platform terms: not on a non-Google map, not cached).
   */
  venuePlaceId?: string;
  /**
   * True when `coordinates` is the organiser's own pin on the venue, placed
   * on our map ("Check the pin", components/dashboard/VenuePinMap.tsx), not
   * an estimate. The map links route to the pin only then (lib/maps.ts).
   */
  venuePinned?: boolean;
  /**
   * The event's state or territory (lib/time-zones.ts STATE_CODES). Absent
   * means `VIC`. Only needed to label the zone: the ACT's "Canberra time".
   */
  state?: StateCode;
  /**
   * The IANA zone the event's times are in, and shown in (lib/format.ts
   * formatters take it last; eventTimeZone gives the default). Absent means
   * Australia/Melbourne (every demo sample event).
   */
  timeZone?: AustralianTimeZone;
  /**
   * ISO 8601 instant (UTC, or with an offset): the moment the event starts,
   * not a wall-clock time. Show it in `timeZone`.
   */
  startsAt: string;
  /** ISO 8601 instant, as `startsAt`. */
  endsAt?: string;
  organiserName: string;
  /**
   * The organiser's logo thumbnail (96 px square, public, versioned), only on
   * a live event whose organiser has a logo and is approved. Absent in the
   * demo and otherwise: the event page shows their initials instead.
   */
  organiserLogoThumbUrl?: string;
  poster: EventPoster;
  /** Optional event photo/poster (path under /public or absolute URL). Falls back to `poster` art when absent or failing to load. */
  imageUrl?: string;
  /** Live events only, and only with a clip: its short silent video (a Play button over the image). */
  clip?: EventClip;
  /** Always empty for an external event (tickets sold on another site). */
  ticketTypes: TicketType[];
  /**
   * Every ticket type is sold out (never for an external event, or one with no
   * ticket types). While it hasn't ended, people can join its waitlist.
   */
  soldOut?: boolean;
  /**
   * Where tickets are sold: `sheltuh` (here; absent means this too) or
   * `external` (on another site, at `externalTicketUrl`: no Sheltüh checkout,
   * booking fee, Who's Going or check-in, and no price shown).
   */
  ticketingMode?: TicketingMode;
  /** External events only: the ticket page. */
  externalTicketUrl?: string;
  /** External events only: the organiser says entry is free. */
  externalFree?: boolean;
  /**
   * External, paid events only: the organiser's "price from" in whole AUD
   * cents. Set by the organiser (never by us), so it carries no booking fee.
   * Absent: no price shown.
   */
  externalPriceFromCents?: number;
  /** External events only: a known ticketing site's name, or null for "the organiser's site". */
  externalProvider?: string | null;
  /**
   * Reserved seating: the event has a seat map (its seated tiers carry
   * `seated`). Absent for a general admission event. Tickets for a seated
   * event are chosen on /events/{slug}/seats.
   */
  seating?: EventSeatingRef;
  /**
   * The refund policy for tickets sold on Sheltüh (lib/refund-policy.ts).
   * Absent means `no_change_of_mind` (DEFAULT_REFUND_POLICY): every demo
   * sample event, and an external event, whose ticketing site's own terms
   * apply (never shown for one).
   */
  refundPolicy?: RefundPolicy;
  /** `days_before` only: refunds up to this many days (1–30) before the event starts. */
  refundDays?: number;
  /**
   * Optional organiser-supplied context — shown on the details page only
   * when present. Never inferred or invented: the live API doesn't collect
   * these yet, so live events simply omit them rather than getting guessed
   * text. See lib/sample-events.ts for how the demo data fills them in.
   */
  audience?: string;
  whatToExpect?: string;
  ageRestriction?: string;
  accessibility?: string;
}
