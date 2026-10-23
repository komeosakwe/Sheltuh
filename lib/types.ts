import type { TicketingMode } from "./ticketing";

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
  /** ISO 8601 datetime, wall-clock time in Australia/Melbourne. */
  startsAt: string;
  endsAt?: string;
  organiserName: string;
  poster: EventPoster;
  /** Optional event photo/poster (path under /public or absolute URL). Falls back to `poster` art when absent or failing to load. */
  imageUrl?: string;
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
  /** External events only: a known ticketing site's name, or null for "the organiser's site". */
  externalProvider?: string | null;
  /**
   * Reserved seating: the event has a seat map (its seated tiers carry
   * `seated`). Absent for a general admission event. Tickets for a seated
   * event are chosen on /events/{slug}/seats.
   */
  seating?: EventSeatingRef;
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
